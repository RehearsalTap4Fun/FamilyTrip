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
  // 单个钟点先换成带标记的「时段 + 分钟」，下面按句子再看：同一句里两个钟点落进同一个时段
  // （「11:30 到店，避开 12 点午市排队」都成了正午），早的那个说「正午早些」，晚的那个后面接着名词就把时段词省掉（「避开午市排队」）
  out = out.replace(ONE, (m, pre, hh, mm, cn, suf) => {
    const t = toMin(pre, hh, mm, cn)
    if (!Number.isFinite(t) || t >= 24 * 60) return m
    const tail = suf && /前/.test(suf) ? '早些' : suf && /开始|起/.test(suf) ? suf : suf && /后/.test(suf) ? 'AFTER' : ''
    return `\u0001${periodOf(t)}\u0002${t}\u0002${tail}\u0003`
  })
  out = out.split(/(?<=[。！？；\n])/).map(sentence => {
    const marks = [...sentence.matchAll(/\u0001(.+?)\u0002(\d+)\u0002(.*?)\u0003/g)].map(x => ({ p: x[1], t: Number(x[2]) }))
    let k = -1
    return sentence.replace(/\u0001(.+?)\u0002(\d+)\u0002(.*?)\u0003(.?)/g, (_m, p: string, ts: string, tail: string, next: string) => {
      k++
      const t = Number(ts)
      const same = marks.filter(x => x.p === p)
      const tl = tail === 'AFTER' ? '' : tail
      if (same.length < 2) return p + tl + next
      const first = marks.findIndex(x => x.p === p) === k
      if (first) return p + (tl || (t < Math.max(...same.map(x => x.t)) ? '早些' : '')) + next
      // 后面那个：原文说「几点后」的写「稍晚」；紧跟着名词就省掉时段词（连前面的空格），否则照写
      if (tail === 'AFTER') return '\u0004稍晚' + next
      return (/[\u4e00-\u9fa5]/.test(next) ? '\u0004' : p + tl) + next
    })
  }).join('').replace(/\s*\u0004/g, '')
  // 「傍晚以后看日落」这类换完多出来的字、重复的时段词收一收
  return out.replace(/(清晨|上午|正午|下午|傍晚|夜晚)\s*(以后|之后)/g, '$1')
    // 时段词和后面的词重了（「正午午市」「夜晚夜市」「清晨早市」）：留后面的
    .replace(/正午(?=午市|午饭|午餐|中午)|夜晚(?=夜市|夜景|夜游|晚上)|清晨(?=早市|早饭|早餐|早上)|傍晚(?=晚市|晚饭|晚餐)/g, '').replace(/(早上|上午|下午|晚上|傍晚)(清晨|上午|正午|下午|傍晚|夜晚)/g, '$2').replace(/\s{2,}/g, ' ').trim()
}
