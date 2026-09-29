// 最佳时段：看夜景、夜市、灯光秀、日落的要晚上去，看日出、赶早市、趁早人少的要一早去。
// 大模型推荐、读攻略时会给（bestTime）；没给就从说明文字里认。
export type BestTime = 'morning' | 'evening'

const EVENING = /夜景|夜市|夜游|夜晚|晚上|夜里|入夜|灯光|亮灯|灯亮|灯火|灯会|灯笼|篝火|打跳|日落|夕阳|落日|晚霞|傍晚|星空|观星|演出.{0,4}晚|晚场/
const MORNING = /日出|早市|清晨|一早|早上|趁早|赶早|晨雾|云海.{0,4}早/

/** 从说明文字里认最佳时段；认不出返回 undefined（白天都行） */
export function inferBestTime(text?: string | null): BestTime | undefined {
  if (!text) return undefined
  // 「白天人多、晚上更好看」这种两个都提到的：以晚上为准（夜景是去的理由）
  if (EVENING.test(text)) return 'evening'
  if (MORNING.test(text)) return 'morning'
  return undefined
}

/** 模型给的（morning / day / evening）优先，没给再从文字里认 */
export function bestTimeOf(given: string | null | undefined, ...texts: (string | null | undefined)[]): BestTime | undefined {
  if (given === 'morning' || given === 'evening') return given
  if (given === 'day') return undefined
  for (const t of texts) { const b = inferBestTime(t); if (b) return b }
  return undefined
}

// 玩多久：没给时长的按景点大小估，不一律按一个数（都江堰景区、熊猫基地要大半天，一座桥、一条街一小时就够）
const SIZE: [RegExp, number][] = [
  [/迪士尼|环球影城|欢乐谷|方特|长隆|乐园|游乐园|海洋世界|海洋王国/, 360],
  [/景区|风景区|风景名胜区|国家公园|森林公园|地质公园|湿地公园|自然保护区|大峡谷|峡谷|草原|雪山|冰川|长城|故宫|大熊猫|熊猫基地|熊猫苑|动物园|野生动物|植物园/, 180],
  [/博物院|博物馆|美术馆|科技馆|纪念馆|古镇|古城|老街区|水乡|山$|山公园|湖$|古寺群|石窟|遗址公园|度假区/, 150],
  [/公园|园林|园$|寺|庙|宫|观$|祠|陵|塔|楼|阁|故居|书院|海滩|沙滩|湾$/, 90],
  [/桥$|街$|巷$|路$|广场|码头|牌坊|门$|碑|雕塑|观景台|夜市/, 60],
]

/** 按名字（和说明）估要玩多久；认不出返回 undefined（用节奏默认值） */
export function inferDurationMin(name: string, why?: string | null, bestTime?: BestTime): number | undefined {
  const n = name.replace(/[（(].*?[)）]/g, '').trim()
  for (const [re, min] of SIZE) if (re.test(n)) return bestTime === 'evening' ? Math.min(min, 90) : min
  if (why && /大半天|一整天|全天/.test(why)) return 240
  if (why && /半天/.test(why)) return 180
  return bestTime === 'evening' ? 60 : undefined
}
