// 联网搜攻略（智谱网络搜索 API）：推荐方案前先到网上搜一轮，把最相关的十来篇攻略摘要交给大模型参考，方案附原帖链接。
// 2026-09-29 实测：search_pro_sogou 以携程海外版 / 新浪旅游 / 头条的用户游记为主、摘要最长（≈900 字），
// search_pro_quark 能补到一些小红书风格的笔记；search_std 与 search_pro 结果一模一样、内容农场多，不用。
import type { Trip } from '@core/types'
import { STYLES } from '@core/trips'

export interface WebRef { title: string; url: string; site: string; content: string; date?: string }

export class SearchError extends Error {}

const API = 'https://open.bigmodel.cn/api/paas/v4/web_search'
export const ENGINES = ['search_pro_sogou', 'search_pro_quark'] as const
/** 每次搜索的价格（元），面板上显示大概花了多少 */
export const ENGINE_PRICE: Record<(typeof ENGINES)[number], number> = { search_pro_sogou: 0.05, search_pro_quark: 0.05 }

const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^(www|m|you|gs|k|3g|travel)\./, '') } catch { return '' } }

/** 旅行攻略站、大媒体的旅游频道：排在前面 */
const GOOD = /(trip\.com|ctrip\.com|mafengwo\.cn|qunar\.com|qyer\.com|zhihu\.com|sina\.c(n|om\.cn)|toutiao\.com|sohu\.com|163\.com|qq\.com|page\.sm\.cn|xiaohongshu\.com|dianping\.com)$/
/** 实测里出现过的内容农场、问答搬运：直接丢掉 */
const BAD = /(hjiayou\.com|0411hd\.com|zbnews\.net|jqcom\.cn|qqx\.com|jirou\.com|shunyuantang-cn\.com|ynlyxl\.com|wenwen\.sogou\.com|zhidao\.baidu\.com)$/

export async function zhipuSearch(query: string, key: string, engine: (typeof ENGINES)[number], fetchImpl: typeof fetch = fetch): Promise<WebRef[]> {
  let res: Response
  try {
    res = await fetchImpl(API, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ search_query: query.slice(0, 70), search_engine: engine, search_intent: false, count: 15, content_size: 'medium' }),
    })
  } catch { throw new SearchError('连不上智谱搜索，检查一下网络') }
  const j = await res.json().catch(() => ({}))
  if (res.status === 401) throw new SearchError('智谱 API Key 无效：到「同行」页检查一下，要复制完整（中间有个点）')
  if (!res.ok) throw new SearchError(`智谱搜索返回错误（${res.status}）${j?.error?.message ? '：' + j.error.message : ''}`)
  return (j.search_result ?? []).map((r: { title?: string; link?: string; content?: string; media?: string; publish_date?: string }) => ({
    title: (r.title ?? '').trim(), url: r.link ?? '', site: r.media || hostOf(r.link ?? ''), content: (r.content ?? '').trim(), ...(r.publish_date ? { date: r.publish_date } : {}),
  })).filter((r: WebRef) => r.url && r.content)
}

/** 按地区、天数、同行人的特点和玩法拼两组搜索词 */
export function searchQueries(trip: Trip, region: string): string[] {
  const roles = new Set(trip.party.members.map(m => m.role))
  const who = [roles.has('elder') && roles.has('kid') ? '带老人小孩' : roles.has('kid') ? '亲子' : roles.has('elder') ? '带老人' : '', trip.party.pets.length ? '带狗' : ''].filter(Boolean).join(' ')
  const mode = trip.party.mode === 'selfDrive' ? '自驾' : trip.party.mode === 'transit' ? '' : '跟团'
  const style = trip.plan?.styles?.[0] ? STYLES[trip.plan.styles[0]].label : ''
  return [
    `${region} ${trip.days.length}天 ${who} ${mode} 攻略`.replace(/\s+/g, ' ').trim(),
    `${region} ${style || who} 游记 行程`.replace(/\s+/g, ' ').trim(),
  ]
}

/** 合并去重、丢内容农场、攻略站和提到地区的排前面，取前 n 篇，摘要截短 */
export function pickRefs(lists: WebRef[][], region: string, n = 10): WebRef[] {
  const seen = new Set<string>()
  const all: { r: WebRef; score: number }[] = []
  const words = region.replace(/(周边|附近|一带)$/, '').split(/[\s,，、]+/).filter(Boolean)
  for (const list of lists) {
    list.forEach((r, i) => {
      const host = hostOf(r.url)
      const key = r.url.replace(/[?#].*$/, '')
      if (!host || BAD.test(host) || seen.has(key) || seen.has(r.title)) return
      seen.add(key); seen.add(r.title)
      const score = (GOOD.test(host) ? 3 : 0) + (words.some(w => (r.title + r.content).includes(w)) ? 2 : 0) + Math.min(r.content.length, 900) / 900 - i * 0.05
      all.push({ r: { ...r, content: r.content.replace(/<\/?em>/g, '').slice(0, 600) }, score })
    })
  }
  return all.sort((a, b) => b.score - a.score).slice(0, n).map(x => x.r)
}

/** 搜一轮：两组搜索词 × 两个引擎，并发发出去；有一路失败不要紧，全失败才报错 */
export async function searchGuides(trip: Trip, region: string, key: string, fetchImpl: typeof fetch = fetch): Promise<{ refs: WebRef[]; cost: number }> {
  const qs = searchQueries(trip, region)
  const jobs = qs.flatMap(q => ENGINES.map(e => ({ q, e })))
  const got = await Promise.allSettled(jobs.map(({ q, e }) => zhipuSearch(q, key, e, fetchImpl)))
  const ok = got.filter((g): g is PromiseFulfilledResult<WebRef[]> => g.status === 'fulfilled').map(g => g.value)
  if (!ok.length) {
    const first = got.find((g): g is PromiseRejectedResult => g.status === 'rejected')
    throw first?.reason instanceof SearchError ? first.reason : new SearchError('智谱搜索失败')
  }
  return { refs: pickRefs(ok, region), cost: jobs.reduce((a, j) => a + ENGINE_PRICE[j.e], 0) }
}
