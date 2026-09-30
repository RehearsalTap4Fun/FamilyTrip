// 玩法说明里的具体钟点改成模糊时段（清晨、上午、正午、下午、傍晚、夜晚）：
// 「17:30 以后看日落」和行程排的时刻容易打架，说「傍晚看日落」，几点去由用户自己调。
export type Period = '清晨' | '上午' | '正午' | '下午' | '傍晚' | '夜晚'

export function periodOf(min: number): Period {
  const h = ((Math.floor(min / 60) % 24) + 24) % 24
  if (h >= 5 && h < 8) return '清晨'
  if (h >= 8 && h < 11) return '上午'
  if (h >= 11 && h < 14) return '正午'
  if (h >= 14 && h < 17) return '下午'
  if (h >= 17 && h < 19) return '傍晚'
  return '夜晚'
}

const CN: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
const cnNum = (s: string): number => {
  if (/^\d+$/.test(s)) return Number(s)
  if (s === '十') return 10
  const [a, b] = s.split('十')
  if (b === undefined) return CN[a] ?? NaN
  return (a ? CN[a] : 1) * 10 + (b ? CN[b] : 0)
}

const PREFIX = '(早上|早晨|清晨|凌晨|上午|中午|正午|午后|下午|傍晚|晚上|夜里|夜间|晚)'
const NUM = '(\\d{1,2}|[零一二两三四五六七八九十]{1,3})'
// 一个钟点：17:30、9 点、早上九点半、下午3点20
const CLOCK = `(?:${PREFIX}\\s*)?(?:(\\d{1,2})\\s*[:：]\\s*(\\d{2})|${NUM}\\s*点(?:半|钟|\\s*\\d{1,2}\\s*分?)?)`
const RANGE = new RegExp(`${CLOCK}\\s*(?:[-–—~～至到]|前后到)\\s*${CLOCK}`, 'g')
const ONE = new RegExp(`${CLOCK}\\s*(以后|之后|后|以前|之前|前|左右|起|开始)?`, 'g')

const toMin = (pre: string | undefined, hh: string | undefined, mm: string | undefined, cn: string | undefined): number => {
  let h = hh != null ? Number(hh) : cnNum(cn ?? '')
  if (!Number.isFinite(h)) return NaN
  if (pre && /下午|傍晚|晚上|夜里|夜间|晚|午后/.test(pre) && h < 12) h += 12
  if (pre && /中午|正午/.test(pre) && h < 6) h += 12
  return h * 60 + (mm ? Number(mm) : 0)
}

/** 把文字里的具体钟点换成模糊时段；没有钟点原样返回 */
export function fuzzTime(text: string): string
export function fuzzTime(text: string | undefined): string | undefined
export function fuzzTime(text: string | undefined): string | undefined {
  if (!text) return text
  let out = text.replace(RANGE, (m, p1, h1, m1, c1, p2, h2, m2, c2) => {
    const a = toMin(p1, h1, m1, c1), b = toMin(p2 ?? p1, h2, m2, c2)
    if (!Number.isFinite(a) || !Number.isFinite(b)) return m
    const pa = periodOf(a), pb = periodOf(b < a ? b + 12 * 60 : b)
    return pa === pb ? pa : `${pa}到${pb}`
  })
  out = out.replace(ONE, (m, pre, hh, mm, cn, suf) => {
    const t = toMin(pre, hh, mm, cn)
    if (!Number.isFinite(t) || t >= 24 * 60) return m
    const p = periodOf(t)
    return suf && /前/.test(suf) ? `${p}早些` : suf && /开始|起/.test(suf) ? `${p}${suf}` : p
  })
  // 「傍晚以后看日落」这类换完多出来的字、重复的时段词收一收
  return out.replace(/(清晨|上午|正午|下午|傍晚|夜晚)\s*(以后|之后)/g, '$1').replace(/(早上|上午|下午|晚上|傍晚)(清晨|上午|正午|下午|傍晚|夜晚)/g, '$2').replace(/\s{2,}/g, ' ').trim()
}
