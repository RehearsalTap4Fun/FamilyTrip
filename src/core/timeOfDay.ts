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
