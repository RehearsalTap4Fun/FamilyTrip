import { describe, expect, it } from 'vitest'
import { fuzzTime, periodOf } from '@core/fuzzyTime'

describe('怎么玩里的钟点换成模糊时段', () => {
  it('时段边界：清晨、上午、正午、下午、傍晚、夜晚', () => {
    expect([6, 9, 12, 15, 18, 20, 2].map(h => periodOf(h * 60))).toEqual(['清晨', '上午', '正午', '下午', '傍晚', '夜晚', '夜晚'])
  })

  it('各种写法都换掉，别的数字不动', () => {
    expect(fuzzTime('17:30 以后看日落')).toBe('傍晚看日落')
    expect(fuzzTime('早上 9 点前人少')).toBe('上午早些人少')
    expect(fuzzTime('下午3点后看熊猫爬树玩闹')).toBe('下午看熊猫爬树玩闹')
    expect(fuzzTime('早上八点杨柳河街看洗菜')).toBe('上午杨柳河街看洗菜')
    expect(fuzzTime('晚上七点半亮灯')).toBe('夜晚亮灯')
    expect(fuzzTime('演出 20:00 开始')).toBe('演出 夜晚开始')
    expect(fuzzTime('19:30–21:00 灯光秀')).toBe('夜晚 灯光秀')
    expect(fuzzTime('9:00-11:00 人少')).toBe('上午到正午 人少')
    expect(fuzzTime('门票 80 元，3 条路线，上午去最好')).toBe('门票 80 元，3 条路线，上午去最好')
    expect(fuzzTime(undefined)).toBeUndefined()
  })

  it('同一句两个钟点落进同一个时段：早的说「早些」，晚的省掉时段词；时段词和后面重了只留后面的', () => {
    expect(fuzzTime('11:30 到店，避开 12 点午市排队')).toBe('正午早些到店，避开午市排队')
    expect(fuzzTime('中午12点午市人多')).toBe('午市人多')
    expect(fuzzTime('晚上8点逛夜市')).toBe('夜晚逛夜市')
    expect(fuzzTime('晚上8点夜市最热闹')).toBe('夜市最热闹')
    expect(fuzzTime('9 点开门，10 点后旅行团多')).toBe('上午早些开门，稍晚旅行团多')
    // 不同句子各算各的
    expect(fuzzTime('17:30 看日落。18:00 回住处')).toBe('傍晚看日落。傍晚回住处')
  })
})
