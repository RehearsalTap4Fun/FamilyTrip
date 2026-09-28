// 同路 · 攻略正文代取：只替用户取他自己贴进来的攻略链接，只认几个攻略平台，取回来抽成纯文字。
// 浏览器直接取这些网页会被跨域拦住，所以放在服务器上。不存任何内容、不记链接。
// 部署：/opt/trip/fetch-server.mjs，systemd trip-fetch，nginx /trip/api/ → 127.0.0.1:18795（见 scripts/）。
// 用法：GET /fetch?url=<攻略链接>  →  { url, host, title, text, partial }
import http from 'node:http'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.PORT || 18795)
const ORIGINS = new Set(['https://47.109.97.108', 'http://47.109.97.108', 'http://localhost:5321', 'http://127.0.0.1:5321'])
/** 只认这些攻略平台（含子域名）。短链接跳转的每一跳都要在这里面 */
export const HOSTS = ['xiaohongshu.com', 'xhslink.com', 'mafengwo.cn', 'ctrip.com', 'qyer.com', 'douyin.com', 'iesdouyin.com', 'mp.weixin.qq.com', 'zhihu.com', 'dianping.com']
const MAX_BYTES = 3 * 1024 * 1024
const TIMEOUT_MS = 12000
const MAX_TEXT = 20000
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

export function allowed(u) {
  let url
  try { url = new URL(u) } catch { return false }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  const h = url.hostname.toLowerCase()
  return HOSTS.some(d => h === d || h.endsWith('.' + d))
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', mdash: '—', hellip: '…', middot: '·' }
const decode = s => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m }
  return ENT[e.toLowerCase()] ?? m
})

/** HTML 片段转成分行的纯文字 */
function htmlToText(html) {
  return decode(html
    .replace(/<(script|style|noscript|svg|iframe|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|section|article|tr|blockquote)>/gi, '\n')
    .replace(/<\/?(a|span|b|strong|em|i|font)\b[^>]*>/gi, '')
    .replace(/<[^>]+>/g, ' '))
    .split('\n').map(l => l.replace(/[ \t 　]+/g, ' ').trim()).filter(l => l.length >= 2)
    .join('\n')
}

const meta = (html, name) => {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`, 'i')
  const m = re.exec(html)
  return m ? decode(m[1] ?? m[2] ?? '').trim() : ''
}

/** 小红书：笔记正文在页面自带的初始数据里（window.__INITIAL_STATE__），找最长的 title + desc */
function xhsNote(html) {
  const m = /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*<\/script>/.exec(html)
  if (!m) return null
  let data
  try { data = JSON.parse(m[1].replace(/\bundefined\b/g, 'null')) } catch { return null }
  let best = null
  const walk = (o, depth) => {
    if (!o || typeof o !== 'object' || depth > 12) return
    if (typeof o.desc === 'string' && o.desc.length > (best?.desc.length ?? 0)) best = { title: typeof o.title === 'string' ? o.title : '', desc: o.desc }
    for (const v of Object.values(o)) walk(v, depth + 1)
  }
  walk(data, 0)
  return best
}

const CONTENT_START = /class=["'][^"']*\b(yj_content|ctd_content|_j_content_box|note-content|rich_media_content|article-content|RichText|travel-content)\b/i
const CONTENT_END = /<(footer)\b|class=["'][^"']*\b(footer|comment|ctd_comments|related|recommend)\b/i

/** 从网页里抽攻略正文。各平台有正文专区的先取专区，否则整页去掉导航脚本后取文字 */
export function extractText(html, url) {
  const host = new URL(url).hostname
  const title = meta(html, 'og:title') || decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').trim()
  const desc = meta(html, 'og:description') || meta(html, 'description')
  let body = ''
  if (host.includes('xiaohongshu') || host.includes('xhslink')) {
    const n = xhsNote(html)
    if (n) body = [n.title, n.desc].filter(Boolean).join('\n')
  }
  if (!body && host.includes('weixin')) {
    const m = /<div[^>]+id=["']js_content["'][^>]*>([\s\S]*?)<\/div>\s*<script/i.exec(html)
    if (m) body = htmlToText(m[1])
  }
  if (!body) {
    // 各平台的正文专区：从标记处截到页脚 / 评论区（携程 yj_content、公众号 rich_media_content、马蜂窝 _j_content_box……）
    const mk = CONTENT_START.exec(html)
    if (mk) {
      const seg = html.slice(mk.index, mk.index + 150000)
      const end = CONTENT_END.exec(seg)
      body = htmlToText(seg.slice(0, end ? end.index : undefined).replace(/^[^>]*>/, ''))
    }
  }
  if (!body || body.length < 200) {
    const main = /<article[\s\S]*?<\/article>/i.exec(html)?.[0] ?? /<body[\s\S]*<\/body>/i.exec(html)?.[0] ?? html
    body = htmlToText(main.replace(/<(header|footer|nav|aside)[\s\S]*?<\/\1>/gi, ' '))
  }
  if (desc && !body.includes(desc.slice(0, 20))) body = desc + '\n' + body
  const text = body.slice(0, MAX_TEXT)
  // 正文太短多半是要登录才能看全文、或内容在视频里
  return { title, text, partial: text.replace(/\s/g, '').length < 300 }
}

async function fetchPage(start) {
  let url = start
  for (let hop = 0; hop < 6; hop++) {
    if (!allowed(url)) throw Object.assign(new Error('只支持小红书、马蜂窝、携程、穷游、抖音、公众号、知乎、大众点评的链接'), { status: 400 })
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    let res
    try {
      res = await fetch(url, { redirect: 'manual', signal: ctrl.signal, headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9', Accept: 'text/html,application/xhtml+xml' } })
    } catch { clearTimeout(timer); throw Object.assign(new Error('那个网站没响应，稍后再试，或者直接复制正文'), { status: 502 }) }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      clearTimeout(timer)
      url = new URL(res.headers.get('location'), url).toString()
      continue
    }
    if (!res.ok) { clearTimeout(timer); throw Object.assign(new Error(`网站返回 ${res.status}，可能要登录才能看，直接复制正文吧`), { status: 502 }) }
    const reader = res.body.getReader()
    const chunks = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > MAX_BYTES) { ctrl.abort(); break }
      chunks.push(value)
    }
    clearTimeout(timer)
    const buf = Buffer.concat(chunks)
    const cs = /charset=([\w-]+)/i.exec(res.headers.get('content-type') ?? '')?.[1] ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(buf.subarray(0, 2048).toString('latin1'))?.[1] ?? 'utf-8'
    let html
    try { html = new TextDecoder(cs).decode(buf) } catch { html = buf.toString('utf8') }
    return { url, html }
  }
  throw Object.assign(new Error('跳转太多次了'), { status: 502 })
}

// 每个 IP 每分钟最多 20 次
const hits = new Map()
const limited = ip => {
  const now = Date.now()
  const list = (hits.get(ip) ?? []).filter(t => now - t < 60000)
  list.push(now)
  hits.set(ip, list)
  if (hits.size > 5000) hits.clear()
  return list.length > 20
}

function send(res, status, body, origin) {
  const h = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  if (origin && ORIGINS.has(origin)) { h['Access-Control-Allow-Origin'] = origin; h.Vary = 'Origin' }
  res.writeHead(status, h)
  res.end(JSON.stringify(body))
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const origin = req.headers.origin
    if (req.method === 'OPTIONS') return send(res, 204, {}, origin)
    const u = new URL(req.url, 'http://x')
    if (req.method !== 'GET' || u.pathname !== '/fetch') return send(res, 404, { error: 'not found' }, origin)
    const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '')
    if (limited(ip)) return send(res, 429, { error: '取得太频繁了，等一分钟再试' }, origin)
    const target = u.searchParams.get('url') ?? ''
    try {
      const page = await fetchPage(target)
      const out = extractText(page.html, page.url)
      send(res, 200, { url: page.url, host: new URL(page.url).hostname, ...out }, origin)
    } catch (e) {
      send(res, e.status ?? 500, { error: e.message ?? '取正文失败' }, origin)
    }
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer().listen(PORT, '127.0.0.1', () => console.log(`trip-fetch on 127.0.0.1:${PORT}`))
}
