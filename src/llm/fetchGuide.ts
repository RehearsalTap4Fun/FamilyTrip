// 按用户贴的攻略链接取正文：浏览器直接取会被跨域拦，走我们自己服务器上的代取服务（server/fetch-server.mjs）。
// 部署在线上时同站调用；本地开发时调线上那一份（服务端允许 localhost:5321 跨域）。

const REMOTE = 'https://47.109.97.108/trip/api/fetch'

export interface FetchedGuide { url: string; host: string; title: string; text: string; partial: boolean }

export class FetchGuideError extends Error {}

export function fetchApi(): string {
  return typeof location !== 'undefined' && location.hostname === '47.109.97.108' ? new URL('./api/fetch', location.href).toString() : REMOTE
}

/** 一段文字里的第一个链接（分享文案常常是「标题 + 链接 + 复制打开小红书」） */
export function findUrl(text: string): string | null {
  return /https?:\/\/[^\s，。、"'<>）)]+/i.exec(text)?.[0] ?? null
}

export async function fetchGuide(url: string, fetchImpl: typeof fetch = fetch): Promise<FetchedGuide> {
  let res: Response
  try { res = await fetchImpl(`${fetchApi()}?url=${encodeURIComponent(url)}`) } catch { throw new FetchGuideError('连不上取正文的服务，检查一下网络；也可以直接把正文复制过来') }
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new FetchGuideError(j.error ?? `取正文失败（${res.status}）`)
  return j as FetchedGuide
}
