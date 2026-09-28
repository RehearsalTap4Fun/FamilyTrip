// 规则 → 当天是哪几位同行者触发的。界面上限制牌下面挂的名字、「为什么」展开里的主语都从这里来。
import { kidBand, type DayParty } from './party'

export function whoFor(ruleId: string, p: DayParty): string[] {
  const names = (xs: { name: string }[]) => xs.map(x => x.name)
  const m = p.members
  switch (ruleId) {
    case 'drive1':
    case 'drive2':
      return names(m.filter(x => x.driver && x.role !== 'kid'))
    case 'elder':
      return names(m.filter(x => x.role === 'elder'))
    case 'elder75':
      return names(m.filter(x => x.role === 'elder' && (x.age ?? 0) >= 75))
    case 'mobSlow':
      return names(m.filter(x => x.mobility === 'slow'))
    case 'mobCane':
      return names(m.filter(x => x.mobility === 'cane'))
    case 'mobWheel':
      return names(m.filter(x => x.mobility === 'wheelchair'))
    case 'infant':
    case 'toddler':
    case 'preschool':
    case 'school':
      return names(m.filter(x => x.role === 'kid' && kidBand(x.age) === ruleId))
    case 'pet':
      return names(p.pets)
    case 'petLarge':
      return names(p.pets.filter(x => x.size === 'large'))
    case 'base':
      return names(m.filter(x => x.role === 'adult'))
    default:
      return []
  }
}

/** 多条规则的触发者合并去重，保持出现顺序 */
export function whoForAll(ruleIds: string[], p: DayParty): string[] {
  const out: string[] = []
  for (const id of ruleIds) for (const n of whoFor(id, p)) if (!out.includes(n)) out.push(n)
  return out
}
