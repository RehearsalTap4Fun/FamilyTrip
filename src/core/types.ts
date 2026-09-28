// 领域模型。网页版与小程序共用，这里不允许出现任何 DOM / Taro 依赖。

export type TravelMode = 'selfDrive' | 'tour' | 'transit'

/** 行动能力：决定步行上限与台阶、无障碍需求 */
export type Mobility = 'normal' | 'slow' | 'cane' | 'wheelchair'

export type Role = 'adult' | 'elder' | 'kid'

/** 行程日序号区间，含两端，从 0 起。缺省表示全程同行 */
export interface DayRange { from: number; to: number }

export interface Member {
  id: string
  name: string
  role: Role
  /** 小孩必填（按年龄分档）；老人可选，≥75 岁会再收紧一档 */
  age?: number
  mobility?: Mobility
  /** 能开车的成人 */
  driver?: boolean
  /** 动态人数：中途加入或先走的人只在这几天计入 */
  days?: DayRange
}

export type PetSize = 'small' | 'medium' | 'large'

export interface Pet {
  id: string
  name: string
  kind: 'dog' | 'cat' | 'other'
  size: PetSize
  days?: DayRange
}

export interface Party {
  mode: TravelMode
  members: Member[]
  pets: Pet[]
  /** 自驾时车辆座位数（含驾驶位） */
  vehicleSeats?: number
}

/**
 * 地点 / 行程点的属性标签。行程点与红黑榜共用一套，
 * 规则层拿「需求」对「标签」做匹配。
 */
export type Tag =
  | 'steps'        // 台阶多 / 爬山
  | 'accessible'   // 无障碍通行（坡道、电梯）
  | 'stroller'     // 推车可通行
  | 'petOk'        // 可带宠物
  | 'kidMenu'      // 有儿童餐 / 宝宝椅
  | 'softFood'     // 有软烂清淡的菜
  | 'elevator'     // 住宿有电梯或低楼层
  | 'parking'      // 好停车
  | 'restroom'     // 厕所方便
  | 'shade'        // 有遮阴 / 室内
  | 'napOk'        // 适合小孩补觉（车上、酒店）

export type StopKind = 'sight' | 'food' | 'lodging' | 'drive' | 'transit' | 'rest'

export interface Poi {
  lng: number
  lat: number
  /** 高德 6 位行政区划码，足迹地图靠它归到省市 */
  adcode?: string
  /** 高德 POI id，红黑榜按它对齐同一个地方 */
  amapId?: string
}

export type StopStatus = 'planned' | 'done' | 'skipped'

export interface Stop {
  id: string
  kind: StopKind
  name: string
  /** 'HH:MM'。缺省时接在上一站之后 */
  start?: string
  durationMin: number
  walkKm?: number
  /** drive 类站点的净驾驶时长；也可以挂在其他站点上表示到达这里要开多久 */
  driveMin?: number
  altitudeM?: number
  tags?: Tag[]
  poi?: Poi
  /** 1 必去 / 2 想去 / 3 可去。进度落后时按它挑可砍的 */
  priority?: 1 | 2 | 3
  status?: StopStatus
  /** 为什么排这一站（LLM 草案带出来的理由，或自己写的备注） */
  why?: string
  /** 实际到达时间 'HH:MM'，打卡时写入 */
  actualStart?: string
  /** 排程工具在附近推荐的（吃饭、住处、服务区），还没人确认过 */
  suggested?: boolean
}

export interface Day {
  /** 这一天的默认出发时间，缺省 09:00 */
  startTime?: string
  stops: Stop[]
}

/** 玩法类型：决定推荐偏向与排程节奏，是偏好不是限制——和同行人的硬限制冲突时以限制为准 */
export type TripStyle = 'scenic' | 'family' | 'active' | 'heritage' | 'resort' | 'food'

/** 要去的一个点：流程一你列的、流程二推荐的、导入攻略提炼的，最后都是这个，交给排程引擎（core/planner.ts） */
export interface PlanPlace {
  id: string
  name: string
  kind: 'sight' | 'food' | 'lodging'
  poi: Poi
  /** 省 市 区，列表里给人认地方用 */
  area?: string
  /** 必去：排不下时最后才砍，而且会建议加天 */
  must?: boolean
  /** 指定第几天（从 0 起）；住处是指「这一晚」 */
  day?: number
  /** 想在第几天（从 0 起）：只是偏好，放不下或那天空了会挪。导入攻略时来自原文的分天 */
  prefDay?: number
  /** AI 推荐出来的（还没人确认）：排进行程后带「推荐」标记，住处缺条件只作待核 */
  suggested?: boolean
  /** 固定开始时刻 HH:MM（门票预约之类） */
  start?: string
  durationMin?: number
  tags?: Tag[]
  walkKm?: number
  altitudeM?: number
}

/** 新建时的两种排法：已知要去的点只排时间 / 只知道大概地区、要工具推荐去处 */
export type PlanFlow = 'places' | 'region'

/** 新建行程时填的计划信息，排程和推荐靠它 */
export interface TripPlan {
  flow: PlanFlow
  /** 最多两个，第一个为主 */
  styles: TripStyle[]
  /** 流程二的大致地区，例如「滇西北」 */
  region?: string
  /** 出发地（自驾、公共交通时填），第一天从这里出发 */
  origin?: string
  /** 上次排程用的地点，回来改了再排 */
  places?: PlanPlace[]
}

export interface Trip {
  id: string
  title: string
  /** 'YYYY-MM-DD' */
  startDate: string
  party: Party
  days: Day[]
  plan?: TripPlan
  /** 应用自带的示例，可以删、可以恢复 */
  sample?: boolean
  /** 和同行好友共享：拿到分享码的人都能看、能改这一趟（src/sync/share.ts） */
  share?: TripShare
}

export interface TripShare {
  code: string
  /** owner 是我分享出去的，member 是我用别人的分享码加入的 */
  role: 'owner' | 'member'
}
