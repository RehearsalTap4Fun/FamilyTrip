> **已移除（2026-09-28）**：示波器风格已从代码删除，只保留作设计历史。现行风格见 src-ui-braun.md（默认）与 src-ui.md（地图册）。

---
version: 1
slug: "src-ui-scope"
primary_target: "src/ui/scope"
related_targets: ["design/previews/scope.html"]
---

## Scope

网页版「示波器」风格试用版（与地图册版并存，在「同行」页切换）。Mode: Operate。用户反馈地图册版上手别扭，要求试示波器。

## Direction contract

THESIS: 一趟行程就是一条扫描曲线：累计游玩时长随时间爬升，每个同行的人是一个通道、一条触发线，曲线先碰到谁的线，谁就是今天的限制。拒绝「时间线卡片 + 进度条」。

OWN-WORLD: 户外手持机的反射式液晶屏（2026-09-28 用户反馈暗底难读、太极客后改）：浅灰绿液晶底、深墨迹线与大号等宽读数，机壳只剩窄边与底部按键；安全橙是唯一可按的键色；四个通道色只代表同行者，「谁定的」用色点而不是名字；问题只用短标签（琥珀留意、红必改），不写整句。

STORY: 一眼看出：现在曲线走到哪、离最近的触发线还有多远、谁的线；下一站、落后多少、连续驾驶读数。点通道键开关那个人的触发线。

FIRST VIEWPORT: 顶部 D1–D5 时基键与 RUN 时刻；通道键条；格线屏占上半屏（迹线、触发线、NOW 游标、午睡窗口斜线、TRIG 标记）；下方四格读数（游玩 / 连续驾驶 / 步行 / 偏差）；STOP 卡片带打卡按钮。

FORM: 示波器（第一手竞争方向，用户指定），seed 38f61ea7。

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- 白天户外强光下深色屏的可读性（路上用）。
- 试用后保留哪一套，决定后再重写 DESIGN.md。
