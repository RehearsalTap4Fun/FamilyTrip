---
name: 同路
description: 家庭自驾行程工具；一台安静的家用小设备，机身上开一扇海报窗口，下面是圆键、胶囊键和一块读数屏。
colors:
  housing: "#D8D5CE"
  panel: "#F1F0EC"
  panel-recess: "#E5E3DD"
  key-face: "#FBFBF9"
  grid-line: "#D6D3CB"
  edge: "#ABA79D"
  ink: "#2A2724"
  ink-secondary: "#5F5A51"
  ink-dim: "#928D83"
  tab-ink: "#6F6A61"
  commit-orange: "#E0561B"
  commit-orange-edge: "#B4430F"
  ok-green: "#5E7F24"
  warn-amber: "#B05A00"
  warn-bg: "#F4E1C8"
  warn-ink: "#7A3E00"
  error-red: "#C23B22"
  error-bg: "#F2D5CD"
  error-ink: "#8C2415"
  highlight: "#EDE5CF"
  channel-1: "#B98600"
  channel-2: "#2D7B8A"
  channel-3: "#AD447D"
  channel-4: "#3E5DB6"
  channel-5: "#6F8A23"
  channel-6: "#8C5B3B"
  window-sky: "#7FA7AB"
  window-far: "#BFCFC4"
  window-mid: "#8FA67C"
  window-near: "#56704B"
  window-caption-ink: "#DCE6D6"
  moon: "#ECE7D2"
  toast: "#262826"
typography:
  window-headline:
    fontFamily: "ZCOOL QingKe HuangYou, Noto Sans SC, PingFang SC, sans-serif"
    fontSize: "23px"
    fontWeight: 400
    lineHeight: 1.15
    letterSpacing: "0.04em"
  display:
    fontFamily: "Noto Sans SC, PingFang SC, sans-serif"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "0.02em"
  readout:
    fontFamily: "Barlow, Helvetica Neue, Noto Sans SC, sans-serif"
    fontSize: "30px"
    fontWeight: 300
    lineHeight: 1.1
    fontFeature: "tnum"
  key-numeral:
    fontFamily: "Barlow, Helvetica Neue, Noto Sans SC, sans-serif"
    fontSize: "20px"
    fontWeight: 500
    lineHeight: 1
    fontFeature: "tnum"
  time:
    fontFamily: "Barlow, Helvetica Neue, Noto Sans SC, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    fontFeature: "tnum"
  title:
    fontFamily: "Noto Sans SC, PingFang SC, sans-serif"
    fontSize: "19px"
    fontWeight: 900
    lineHeight: 1.25
    letterSpacing: "0.02em"
  body-strong:
    fontFamily: "Noto Sans SC, PingFang SC, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.35
  body:
    fontFamily: "Noto Sans SC, PingFang SC, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.45
  label:
    fontFamily: "Noto Sans SC, PingFang SC, sans-serif"
    fontSize: "14px"
    fontWeight: 700
  chip:
    fontFamily: "Noto Sans SC, PingFang SC, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    lineHeight: 1
  caption:
    fontFamily: "Noto Sans SC, PingFang SC, sans-serif"
    fontSize: "12px"
    fontWeight: 500
rounded:
  tag: "5px"
  field: "12px"
  panel: "16px"
  card: "18px"
  window: "20px"
  housing: "28px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
components:
  button-commit:
    backgroundColor: "{colors.commit-orange}"
    textColor: "{colors.key-face}"
    typography: "{typography.title}"
    rounded: "{rounded.pill}"
    height: "48px"
  button-key:
    backgroundColor: "{colors.key-face}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 18px"
    height: "48px"
  button-key-pressed:
    backgroundColor: "{colors.panel-recess}"
    textColor: "{colors.ink}"
  button-key-danger:
    backgroundColor: "{colors.key-face}"
    textColor: "{colors.error-red}"
    rounded: "{rounded.pill}"
    height: "48px"
  sheet-done-commit:
    backgroundColor: "{colors.commit-orange}"
    textColor: "{colors.key-face}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "40px"
  sheet-done-plain:
    backgroundColor: "{colors.panel-recess}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "40px"
  date-key:
    backgroundColor: "{colors.key-face}"
    textColor: "{colors.ink}"
    typography: "{typography.key-numeral}"
    rounded: "{rounded.pill}"
    size: "50px"
  date-key-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.panel}"
  channel-capsule:
    backgroundColor: "{colors.key-face}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 8px 0 7px"
    height: "40px"
  readout:
    backgroundColor: "{colors.panel-recess}"
    textColor: "{colors.ink}"
    typography: "{typography.readout}"
    rounded: "{rounded.panel}"
    padding: "4px 10px 5px"
  next-stop-card:
    backgroundColor: "{colors.key-face}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "8px 12px"
  window-caption:
    backgroundColor: "{colors.window-near}"
    textColor: "{colors.key-face}"
    typography: "{typography.window-headline}"
    rounded: "{rounded.window}"
    padding: "6px 14px 10px"
  chip-warn:
    backgroundColor: "{colors.warn-bg}"
    textColor: "{colors.warn-ink}"
    typography: "{typography.chip}"
    rounded: "{rounded.pill}"
    padding: "4px 9px"
  chip-error:
    backgroundColor: "{colors.error-bg}"
    textColor: "{colors.error-ink}"
    typography: "{typography.chip}"
    rounded: "{rounded.pill}"
    padding: "4px 9px"
  stepper:
    backgroundColor: "{colors.key-face}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "48px"
  segmented-track:
    backgroundColor: "{colors.panel-recess}"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.pill}"
    padding: "4px"
  segmented-on:
    backgroundColor: "{colors.key-face}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "42px"
  tile:
    backgroundColor: "{colors.key-face}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "12px"
    height: "96px"
  summary-card:
    backgroundColor: "{colors.key-face}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "12px 14px"
    height: "64px"
  text-field:
    backgroundColor: "{colors.key-face}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "8px 12px"
    height: "46px"
  toast:
    backgroundColor: "{colors.toast}"
    textColor: "{colors.key-face}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "0 8px 0 16px"
    height: "50px"
---

# Design System: 同路

## Overview

**Creative North Star: "开了一扇窗的家用小设备"**

同路的默认风格是「博朗 × 海报」（`data-family="device"` 下的 `data-theme="braun"`）：一台浅暖灰机身的家用小设备，Dieter Rams 式的克制。机身里嵌一块近白面板，面板上是圆形日期键、胶囊同行者键、一块读数屏和四格读数；只有「今天」页在面板顶端开一扇圆角海报窗口，窗里是平涂层叠山景，一句方块字标题压在近山上，只说此刻最该做的一件事。

密度是「设备面板」而不是「网页卡片流」：字少、数字大，「谁定的」用通道色点表示，问题只给短标签，句子留在点开后的面板里。浏览为主，编辑一律进底部面板，一次只改一件事，面板底部当场写出「这样改之后」。拒绝「地图头图 + 卡片 + 一种蓝」，也拒绝暗底极客屏。

应用只支持两套风格（2026-09-28 用户定）：本文件描述的博朗 × 海报（默认），以及分省交通地图册（`data-theme="atlas"`，令牌与组件样式在 `src/styles.css`，方向契约见 `.impeccable/surfaces/src-ui.md`）。新页面、新组件两套都要做：共用组件靠令牌自动换装，只有「今天」「行程」两页博朗走设备家族结构（ScopeToday / ScopeTrip）、地图册走自己的页面。示波器、公园导览折页、公园海报已移除，不再维护。本文件只描述 braun。

**Key Characteristics:**
- 浅暖灰机身 + 近白面板 + 一格下凹的读数色，三层明度就是全部的结构。
- 全机只有一颗橙色提交键；绿色只表示没问题；通道色只表示人。
- 圆形与胶囊：日期键是圆，其余按键、分段、步进器、标签都是胶囊。
- 按键厚度靠带模糊的柔和投影与顶部内高光，没有硬边裙摆。
- 海报窗口只在「今天」，按时段换色，夜里换月亮。
- 只按手机设计：大屏上是居中的一列手机宽度。

## Colors

低饱和暖灰为主调，一颗高饱和橙做唯一的「按这里」，其余颜色各管一件事：状态、人、窗口里的风景。

### Primary
- **提交橙** (#E0561B)：「到了」、面板右上角的「完成 / 加入」、「加一站」这类提交动作的键面。键边用 **橙键边** (#B4430F)。同一时刻可按的橙键只有一颗。橙色同时是「此刻」的记号：窗口里的太阳与小路、读数屏上的当前时刻竖线、今天那颗日期键的内圈、下一站的闪灯、当前标签页图标、焦点框。它们都不可按或只表示位置，不与提交键争。

### Secondary
- **没问题绿** (#5E7F24)：只表示「没问题 / 已完成」：已到站的灯、「没问题」字样、开关打开的轨道、影响提示里的「解决了」和变宽松的数字。
- **留意琥珀** (#B05A00)，底 (#F4E1C8)，字 (#7A3E00)：超标但不致命的读数、「留意」短标签、碰线点、影响提示里变紧的数字。
- **必改红** (#C23B22)，底 (#F2D5CD)，字 (#8C2415)：必改标签、行程页抬头的「N 必改」、删除类键的字色、左滑的删除动作、红榜大键。

### Tertiary
- **通道色**（我 #B98600、ch2 #2D7B8A、ch3 #AD447D、ch4 #3E5DB6、ch5 #6F8A23、ch6 #8C5B3B）：每个同行者按全程名单顺序领一种颜色，跟着人走。出现形式是胶囊键里的圆点、读数格下的「谁定的」色点、摘要卡左侧的点、读数屏里每人一条的触发虚线、午睡时段的斜线与字（用正在午睡那个人的颜色）。不属于某个人的线（行程页迷你图里当天最严的上限）用淡墨。
- **窗口山景**：天 (#7FA7AB)、远山 (#BFCFC4)、中山 (#8FA67C)、近山 (#56704B)，标题栏是近山色，副文字 (#DCE6D6)，夜里的月亮与星 (#ECE7D2)。清晨、傍晚、夜里各有一组替换色（见 sidecar 的 `windowPhases`），都在博朗的低饱和范围内。

### Neutral
- **机身暖灰** (#D8D5CE)：页面底色与底部标签栏。
- **面板近白** (#F1F0EC)：主面板与底部面板的底。
- **下凹灰** (#E5E3DD)：读数格、读数屏、行程每天的格子、面板底部的影响区、分段键的槽。
- **键面白** (#FBFBF9)：一切可按的面：键、卡片、步进器、磁贴、输入框。
- **格线** (#D6D3CB) 与 **边线** (#ABA79D)：读数屏格线、列表分隔、键与字段的 1px 描边。
- **墨** (#2A2724)、**次墨** (#5F5A51)、**淡墨** (#928D83)、**标签栏墨** (#6F6A61)：正文、说明、已完成 / 已跳过、未选中的标签页。
- **撤销条** (#262826)：唯一的深色浮层。
- **高亮** (#EDE5CF)：表格里当前行。

### Named Rules
**The One Orange Key Rule.** 一屏里可按的橙色键只有一颗，而且只给提交。只是收起、确认已读、取消的键（「关闭」「知道了」「取消」「算了」）一律用中性键面（`doneTone="plain"`）。

**The Green Means OK Rule.** 绿色只说「没问题」。不拿绿色做装饰、品牌色或选中态。

**The Channels Are People Rule.** 通道色只代表同行者，只以圆点、触发线或这个人自己的时段（午睡）出现，不写成人名的字色，不拿来表示问题等级、类别或「待核」；不属于某个人的线一律用淡墨。

## Typography

**Display Font:** ZCOOL QingKe HuangYou（窗口标题专用，回退 Noto Sans SC / 苹方）
**Body Font:** Noto Sans SC（回退 PingFang SC）
**Label/Mono Font:** Barlow 300 / 500（时刻、天数、读数，等宽数字）；Barlow Semi Condensed 600 / 700（步进器与天数条里的数字）

**Character:** 方块字标题像海报上的丝网印字，只出现一次；其余是安静的黑体加上细体大数字，像家电面板上的印字和刻度。

### Hierarchy
- **窗口标题** (400, 23px, 1.15, 字距 .04em, text-wrap: balance)：海报窗口里那一句此刻该做的事，全应用只此一处。
- **Display** (Noto Sans SC 700, 26px, 1.1)：行程、同行、红黑榜的页名。
- **读数** (Barlow 300, 30px, 1.1)：四格读数的大数；单位与上限用 14px 次墨跟在后面。下一站时刻 24px、行程每天的天数 28px 同属这一族。
- **键数字** (Barlow 500, 20px)：圆形日期键里的天数，下方 10px 日期。
- **Title** (Noto Sans SC 900, 19px, 1.25)：底部面板标题；摘要卡名 17px、每天路线名 16px、磁贴名 17px 同为 900。下一站站名在 braun 里降到 500、19px。
- **Body strong** (700, 16px, 1.35)：今天页站点列表的站名。
- **Body** (500, 14px, 1.45)：影响提示、说明、撤销条。面板里的问题说明 15px / 1.6。
- **Label** (700, 14px)：面板字段名、分段键、读数格的一个字（braun 读数格降到 500）。
- **Chip** (700, 12px, 行高 1)：短标签。**Caption** (500, 12px)：次要说明、窗口里的地名与天数。

### Named Rules
**The One Headline Rule.** 方块字 ZCOOL QingKe HuangYou 只用于海报窗口里的一句话。页名、站名、面板标题都用 Noto Sans SC。

**The Short Label Rule.** 问题在列表、读数、卡片上只显示短标签（`Issue.short`，如「连开 130/90 分」「台阶多」「4 待核」），完整句子只在点开的面板里。

## Layout

只按手机设计。主面板固定在视口里，四周留 10px 机身，最大宽度 430px（左右 `max(10px, 50% − 215px)`），大屏上就是居中的一列手机；底部标签栏高 60px，与机身同色。面板内边距 12px，底部多留 28px。

「今天」自上而下固定顺序：海报窗口（山景 92px 高 + 标题栏）→ 一排圆形日期键（两端对齐）→ 同行者胶囊键一排 → 读数屏 → 2×2 读数格 → 下一站卡片 → 当天问题标签 → 站点列表 → 下一天入口。其他页没有窗口，以页名开头。

节奏以 6 / 8 / 10 / 12px 为主：同排小键之间 6px，读数格之间 5px，磁贴与卡片列表之间 8–10px，面板字段之间 14px。底部面板最大 430px 宽、88dvh 高，内容区 16px 左右内边距，影响区固定在底。

## Elevation & Depth

三层明度加一种柔和投影。机身最暗，面板次之，下凹灰表示「嵌进面板的显示区」，键面白表示「凸出来可按」。凸起只靠一道带模糊的小投影和顶部 1px 内高光，没有硬边、没有偏移色块。读数格与读数屏完全不加阴影，只靠下凹灰。

### Shadow Vocabulary
- **键的厚度** (`box-shadow: inset 0 1px 0 rgba(255,255,255,.7), 0 1px 3px -1px rgba(42,39,36,.35)`)：一切键、日期键、卡片、下一站卡片。按下时底色换成下凹灰，并缩到 0.97。
- **主面板** (`box-shadow: inset 0 1px 0 #fff, 0 12px 26px -16px rgba(42,39,36,.45)`)：嵌在机身上的主面板。
- **底部面板** (`box-shadow: 0 -12px 30px -14px rgba(0,0,0,.45)`)，遮罩 `rgba(20,22,20,.38)`。
- **撤销条** (`box-shadow: 0 10px 24px -10px rgba(0,0,0,.5)`)。
- **拖动中的行** (`box-shadow: 0 8px 20px -8px rgba(0,0,0,.35)`)。
- **分段选中** (`box-shadow: 0 1px 2px rgba(0,0,0,.18)`)。

### Named Rules
**The Soft Key Rule.** 按键的厚度用带模糊的阴影，不画硬边裙摆，不用无模糊的偏移阴影。

## Shapes

圆与胶囊。日期键是正圆（50px），同行者键、按键、分段键、步进器、天数条、短标签、撤销条都是胶囊（999px）。容器按层级递增圆角：摘要卡与磁贴、读数格 16px，下一站卡片 18px，海报窗口与底部面板顶角 20px，主面板 28px。输入框与开关外框 12px。只有左滑露出的动作键是方角实色，填满行高。

海报窗口是上下两段拼成的一个圆角矩形：山景段只圆上角，标题栏只圆下角，窗口内沿一道 8% 墨色的 1px 内描边。

## Components

### Buttons
安静、厚实、按下有回应。
- **Shape:** 胶囊 (999px)，高 48px；面板右上角的完成键高 40px。
- **提交键：** 提交橙底、白字、橙键边，900 17px（「到了」）或 700 15px（kbtn）；厚度与中性键同一道柔和键投影。一屏只有一颗。
- **中性键：** 键面白底、墨字、1px 边线或只靠投影；「跳过」「加一天」「跳过这一站」。
- **危险键：** 中性键面，字用必改红（「删除」「移出同行」「删掉这一天」）。颜色在字上，不在底上。
- **按下：** 100ms 缩到 0.97，底色换下凹灰；焦点框 2px 橙线外扩 2px。
- **禁用：** 透明度 .45。

### 圆形日期键
一排五颗（天数多时同样两端排开），50px 正圆，Barlow 500 20px 天数 + 10px 日期。选中的一天整颗变墨色、字变面板白；今天那一天另加 2px 橙色内圈，选中与今天可同时出现。

### 同行者胶囊键
一人一颗，高 40px，左侧 8px 通道色圆点，名字 13px，右端上限小时数（Barlow）。点一下关掉他在读数屏上的触发线，关掉的键降到 .45 透明度。

### 读数屏
下凹灰底、16px 圆角的格线图：横轴时刻、纵轴累计游玩。每个同行者一条自己颜色的触发虚线（1.6px，6/3 虚线），同一高度的多人线错开 2.4px 叠放；已走部分是 2.4px 墨线，下面填一座中山色的山（.38 透明），未走部分为淡墨虚线，下面是远山色的山；当前时刻一条 2px 橙竖线；碰线处一个琥珀空心圆和「HH:MM 碰线」。午睡时段用斜线阴影表示，斜线与「某某午睡」字样用午睡那个人的通道色。

### 读数格
2×2，下凹灰、16px 圆角、无阴影。左上一个字（游玩 / 连开 / 步行 / 晚），右侧 Barlow 300 大数 + 「/上限」，左下是「谁定的」通道色点（10px）。超标时字与数一起变留意琥珀。

### 下一站卡片
键面白、18px 圆角、带键的厚度。站名 + 右侧时刻；需要处理时一行留意琥珀的说明（「停够 20 分，解决『连开 130/90 分』」）；底部「到了」（橙，占满）与「跳过」（中性，34% 宽）。

### Chips（短标签）
- **Style:** 胶囊，700 12px，4px 9px 内边距。留意＝琥珀底琥珀字，必改＝红底红字，「N 待核」与不在场 / 关闭＝中性：次墨字加边线色细描边。
- **State:** 标签本身可点，点开的是问题面板（标题即短标签，正文是完整句子，右上「知道了」为中性键）。

### Cards / Containers
- **摘要卡（同行、红黑榜）：** 键面白、16px 圆角、1px 边线，最小高 64px；左 14px 通道色点，名字 900 17px，副行 500 13px，下面一排 12px 小标签（5px 圆角、下凹灰底），右侧箭头。整卡可点，点开进底部面板。
- **行程的一天：** 下凹灰、16px 圆角；左边 Barlow 天数，右边路线名、驾车时长、一条迷你曲线与淡墨的上限虚线，底下短标签。展开后面板内是出发时间步进器、站点列表与动作键，不再卡片套卡片。
- **磁贴（加一站 / 加谁）：** 2 列，最小高 96px，16px 圆角，左上 28px 线条图标，底部 900 17px 名称 + 12px 说明。

### Inputs / Fields
大控件代替输入框和下拉，只有名字用输入框。
- **输入框：** 键面白、1px 边线、12px 圆角、最小高 46px、500 17px。聚焦时边线变橙并外扩 3px 25% 橙光晕。
- **步进器：** 胶囊，两端 52px 的 − / + 键，中间 Barlow Semi Condensed 600 22px 数值，到头时键降到 .3。
- **分段键：** 下凹灰槽里一排胶囊，选中者浮起为键面白 + 墨字 + 分段投影，未选为次墨字。
- **开关：** 整行 52px 高、12px 圆角；轨道 50×30，关时边线色，开时没问题绿。
- **天数条：** 下凹灰胶囊槽，按住划选连续的天，选中段变墨色并两端成圆；右侧「全程」键。
- **更多：** 少用的字段收在「更多」折叠里，顶部一道细线。

### Navigation
底部四个标签（今天 / 行程 / 同行 / 红黑榜），机身色底，22px 1.6 描边线条图标 + 12px 字；未选标签栏墨，选中字变墨色、图标变橙。

### 底部面板（Signature）
所有编辑都在这里。顶部 40×5 把手，标题 900 19px，右上完成键（提交橙或中性）。把手与标题栏可拖动，1:1 跟手，往上越拉越沉，松手按速度投影超过面板高 45% 就关，否则弹回；弹簧阻尼 1（不回弹）、response 0.32s。关闭时一定播完退场（滑下，或减少动态效果时淡出）再卸载，面板里的内容在退场期间保持不变。内容区可滚动；底部固定的影响区是下凹灰，写「这样改之后」（12px 700 次墨）加逐条变化：上限 A → **B**（变紧琥珀、变宽松绿）、解决了（绿）、新问题（红）、没变化（次墨）；影响区下方放危险键或次要动作。

### 撤销条
底部标签栏上方 14px，深色胶囊 50px 高，左侧一句「已到 X · 13:05」「已删除 X」，右侧半透明白的「撤销」胶囊。5 秒后消失。删除、打卡、跳过都直接生效再给撤销，只有「恢复示例旅程」弹确认。

### 左滑列表
行程里展开一天的站点行：左滑露出方角实色的「跳过」（淡墨）与「删除」（必改红），时刻与站名钉在原地，只有右半滑走；右端 44px 把手拖动排序；弹簧 response 0.28s，不回弹。

### 海报窗口（Signature）
只在「今天」。平涂四层：天、远山、中山、近山，加一条虚线小路；白天太阳是提交橙并随时刻沿弧线移动，傍晚太阳变浅橙，夜里换成月牙加七颗星、小路变淡。时段：5:00–7:30 清晨、7:30–16:30 白天、16:30–19:30 傍晚、其余夜里。只有正在进行的那一天跟真实时段换色，看别的日子一律按白天画。不做定时刷新，回到页面时重算。标题栏左侧是窗口标题，右侧是地名、第几天与时刻。

### 线条图标
面板、磁贴、出行方式用同一套 20 格、1.6 描边、圆头圆角的线条图标（景点、吃饭、休息、住宿、驾车、公共交通、跟团）。地图册的点状站点符号与出行方式图例只留在地图册风格。

### 动效
- 按下：100ms ease-out 缩到 0.97。
- 面板与左滑：临界阻尼弹簧（damping 1），可被手指随时打断；速度 <20px/s 且离目标 <1px 即落定。面板开与关都有动画，关闭播完退场才卸载。
- 读数屏曲线：0.9s cubic-bezier(.16,1,.3,1) 扫出；换页 0.22s 淡入上移 6px；撤销条 0.24s 从下方 12px 进入；开关圆钮 180ms。
- 下一站的灯 1.2s 阶跃闪烁。
- 减少动态效果时：位移换成淡入淡出：面板与遮罩 200ms 淡入淡出，撤销条 0.2s 淡入；曲线扫出、换页、闪灯、高亮闪一下关闭。

## Do's and Don'ts

### Do:
- **Do** 一屏只留一颗橙色提交键；收起类的完成键用中性 `doneTone="plain"`。
- **Do** 用通道色圆点表示「谁定的」，不写人名。
- **Do** 在列表、读数和卡片上只放 `Issue.short` 短标签，句子进面板。
- **Do** 浏览为主，编辑进底部面板，面板底部当场写「这样改之后」。
- **Do** 用撤销条代替确认框；只有「恢复示例旅程」确认。
- **Do** 用步进器、分段键、磁贴、开关、天数条代替输入框和下拉；只有名字用输入框。
- **Do** 保证触控目标不小于 44px（键 48px、日期键 50px、行 ≥44px、把手 44px）。
- **Do** 用带模糊的柔和投影 (`0 1px 3px -1px`) 加顶部内高光表达按键厚度，按下换下凹灰。
- **Do** 面板和拖动用不回弹的弹簧，开关都有动画；减少动态效果时改为淡入淡出。
- **Do** 大屏上保持居中的一列手机宽度（最大 430px）。

### Don't:
- **Don't** 把绿色用在「没问题 / 已完成」以外的任何地方。
- **Don't** 拿通道色表示问题等级、类别或装饰。
- **Don't** 把海报窗口搬到「今天」以外的页面，也不要给它加定时刷新。
- **Don't** 在窗口标题以外使用方块字 ZCOOL QingKe HuangYou。
- **Don't** 画硬边按键裙摆或无模糊的偏移阴影。
- **Don't** 在读数格、读数屏上加阴影；它们靠下凹灰表示嵌入。
- **Don't** 做「地图头图 + 卡片 + 一种蓝」的旅行 App 模样，也不做暗底极客屏。
- **Don't** 在博朗风格里使用地图册的点状站点符号、路牌盾与高速红黄。
