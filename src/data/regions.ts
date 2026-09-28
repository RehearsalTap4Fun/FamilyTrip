// 行政区划名称：只收示例和常去的地方，足迹页（M2）接高德后改为按需查询。
export const REGION_NAME: Record<string, string> = {
  '530000': '云南省',
  '530100': '昆明市',
  '530700': '丽江市',
  '532900': '大理白族自治州',
}

export function regionName(code: string | undefined): string | undefined {
  return code ? REGION_NAME[code] : undefined
}
