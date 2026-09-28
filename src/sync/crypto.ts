// 同步码与端到端加密（与饮食日记同一套做法，盐不同，两边的同步码互不相通）。浏览器在 HTTP 页面里不开放 WebCrypto 的 subtle，因此用纯 JS 实现（noble，经审计、零依赖）。
import { gcm } from '@noble/ciphers/aes.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { pbkdf2 } from '@noble/hashes/pbkdf2.js'
import { bytesToHex, randomBytes, utf8ToBytes } from '@noble/hashes/utils.js'

/** 去掉易混的 0 O 1 I，32 个字符；24 位约 120 bit 熵 */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
const GROUPS = 6
const GROUP_LEN = 4

export function generateSyncCode(): string {
  const bytes = randomBytes(GROUPS * GROUP_LEN)
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    if (i > 0 && i % GROUP_LEN === 0) out += '-'
    out += ALPHABET[bytes[i] % ALPHABET.length]
  }
  return out
}

/** 手抄容错：转大写、去空格与连字符、0→O 与 1→I 之类的误写纠正为字母表内字符 */
export function normalizeSyncCode(input: string): string | null {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/0/g, 'O').replace(/1/g, 'I').replace(/O/g, 'Q').replace(/I/g, 'J')
  // 上面把 O/I 映射成字母表里存在的 Q/J 只是为了不直接报错；真正的码不会含 O I 0 1，所以映射后仍需逐字校验
  if (raw.length !== GROUPS * GROUP_LEN) return null
  for (const ch of raw) if (!ALPHABET.includes(ch)) return null
  return raw.match(/.{4}/g)!.join('-')
}

export interface SyncKeys {
  /** AES-256-GCM 密钥 */
  key: Uint8Array
  /** 服务器上的存储键（64 位十六进制），由派生材料再哈希得到，不可反推同步码 */
  id: string
}

const keyCache = new Map<string, SyncKeys>()

/** 同一种码两种用途：account 是自己多台设备之间的同步码，share 是单趟行程给同行好友的分享码。盐不同，id 与密钥互不相通 */
export type KeyPurpose = 'account' | 'share'
const SALT: Record<KeyPurpose, string> = { account: 'tonglu-sync-v1', share: 'tonglu-share-v1' }

/** PBKDF2-SHA256 派生 64 字节：前 32 字节做密钥，后 32 字节哈希后做存储 id */
export function deriveKeys(code: string, purpose: KeyPurpose = 'account'): SyncKeys {
  const norm = normalizeSyncCode(code)
  if (!norm) throw new Error('码的格式不对')
  const ck = purpose + ':' + norm
  const hit = keyCache.get(ck)
  if (hit) return hit
  const material = pbkdf2(sha256, utf8ToBytes(norm), utf8ToBytes(SALT[purpose]), { c: 60000, dkLen: 64 })
  const keys: SyncKeys = { key: material.slice(0, 32), id: bytesToHex(sha256(material.slice(32))) }
  keyCache.set(ck, keys)
  return keys
}

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
function fromBase64(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

/** 整包 JSON → base64(nonce 12 字节 + 密文)；格式前缀 "v1." 便于以后升级 */
export function encryptJson(keys: SyncKeys, obj: unknown): string {
  const nonce = randomBytes(12)
  const ct = gcm(keys.key, nonce).encrypt(utf8ToBytes(JSON.stringify(obj)))
  const packed = new Uint8Array(nonce.length + ct.length)
  packed.set(nonce, 0)
  packed.set(ct, nonce.length)
  return 'v1.' + toBase64(packed)
}

export function decryptJson<T = unknown>(keys: SyncKeys, blob: string): T {
  if (!blob.startsWith('v1.')) throw new Error('未知的加密格式')
  const packed = fromBase64(blob.slice(3))
  const nonce = packed.subarray(0, 12)
  const pt = gcm(keys.key, nonce).decrypt(packed.subarray(12))
  return JSON.parse(new TextDecoder().decode(pt)) as T
}
