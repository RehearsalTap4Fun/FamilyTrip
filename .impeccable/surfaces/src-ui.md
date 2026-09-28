---
version: 1
slug: "src-ui"
primary_target: "src/ui"
related_targets: ["design/previews/atlas.html"]
---

## Scope

网页版与小程序的应用界面（今天 / 行程 / 红黑榜 / 足迹 四页签）。Mode: Operate。路上单手看与出发前规划各占一半，老人基本不自己用。

## Direction contract

THESIS: 每一天是分省交通地图册的一页：行程是一条竖走的高速，叠加限制写进图例与比例尺。拒绝「地图头图 + 圆角卡片 + 一种蓝」的旅行 App 排法。

OWN-WORLD: 近白纸，州市平涂四色（淡黄 / 淡绿 / 淡粉 / 淡紫），红边黄芯高速线是唯一强调，图廓双线，水系蓝仿宋注记，宋 / 黑 / 仿宋三级注记。借自 GB 5768 的只有符号：国家高速路牌盾、黄三角警告、红圈限制牌、棕色景点方标，只作图例符号出现，不做成整块路牌。

STORY: 一眼看出今天走到哪、晚了多少、谁收紧了哪条限制；点注记看规则依据，拖动红线上的站点改顺序。

FIRST VIEWPORT: 顶部图名 + 接图表（按天）；中部竖向路线条，站点符号与时刻，当前位置红箭头，警告以黄三角加引线注记；底部图例：四枚红圈限制牌 + 比例尺（每人上限淡显，最严者压实标红）；页签在图廓外。

FORM: 分省交通地图册，我列出的方向中排第 3，融合高速指路标志符号（用户指定），seed 38f61ea7。

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- 小程序端 `<map>` 底图与地图册平涂风格如何衔接（足迹页）。
- 深色模式：夜间车内是否需要「夜航图」变体。
