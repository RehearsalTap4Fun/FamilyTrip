# 国外地图中转（Cloudflare Worker → Google 地图）

高德查不了国外（实测：搜不到、算车程报 `INSUFFICIENT_ABROAD_PRIVILEGES`），国外的地点、车程、周边改用 Google 地图。
国内访问不了 Google，Cloudflare 自带的 `*.workers.dev` 地址也连不上（2026-09-30 从服务器实测：DNS 被污染、指定 IP 直连也被掐断），
而挂在 Cloudflare 上的普通域名能连上。所以链路是：

```
app ──► 自家服务器 /trip/api/gmap/*（server/api-server.mjs 转发）──► https://map.你的域名（这个 Worker）──► Google
```

- Google Key 只放在 Worker 里（`GOOGLE_KEY`），app 和自家服务器都不经手。
- app 带访问口令（`X-Trip-Token`），Worker 核对 `ACCESS_TOKEN`，对不上就拒绝。别人拿到地址也用不了你的额度。
- 只请求必要的字段（字段越少计费档越低），同样的请求会缓存：地点 7 天、路线 1 天、城市 30 天。

## 一、Google Cloud（约 15 分钟）

1. 打开 console.cloud.google.com，新建项目（比如 `tonglu`），开通结算，这一步要绑卡。
2. 「API 和服务 → 库」里启用三个 API：**Places API (New)**、**Routes API**、**Geocoding API**。
3. 「凭据 → 创建凭据 → API 密钥」。在密钥设置里：
   - **API 限制**：只勾上面三个。
   - 应用限制选「无」。Worker 的出口 IP 不固定，没法按 IP 限；靠 API 限制、配额和访问口令兜底。
4. 「结算 → 预算和提醒」：建一个每月 **10 美元** 的预算，50%、90%、100% 时发邮件提醒。
5. 「API 和服务 → 配额」里给三个 API 各设每日上限，防止出问题时一夜跑光。建议值：
   - Places：Text Search 每天 200 次，Nearby Search 每天 300 次。
   - Routes：computeRoutes 每天 500 次。
   - Geocoding：每天 200 次。

   家庭自用一般用不到这么多。每月有多少免费调用、超出后怎么计费，以 Google 的价格页为准。

## 二、域名 + Cloudflare（约 20 分钟）

1. 注册 Cloudflare 免费账号。
2. 在 Cloudflare「域名注册」里买一个域名（.com 大约 10 美元一年，按成本价），买完会自动托管在 Cloudflare。
   - 在别家买的也行，把域名服务器（NS）改成 Cloudflare 给的那两个。
   - 域名不指向国内服务器，不用备案。
3. 编辑 `worker/wrangler.toml` 最后一行：去掉注释，把 `map.你的域名` 换成真实域名，比如 `map.example.com`。

## 三、部署 Worker（在 Claude Code 里用 `!` 跑，Key 由你自己粘贴）

```sh
! cd worker && npx wrangler login                    # 弹出浏览器，授权 Cloudflare
! cd worker && npx wrangler secret put GOOGLE_KEY    # 粘贴 Google API Key
! openssl rand -hex 16                               # 生成一个访问口令，复制下来
! cd worker && npx wrangler secret put ACCESS_TOKEN  # 粘贴刚才的口令
! cd worker && npx wrangler deploy
```

部署完用 `curl https://map.你的域名/health` 检查，应该看到 `{"ok":true,"key":true,"token":true}`。

## 四、服务器上配置中转地址

告诉 Claude 你的域名，它会在服务器上写 `/etc/trip/gmap.env`（内容 `GMAP_URL=https://map.你的域名`）并重启 `trip-api`。
没有这个文件时，`/trip/api/gmap/*` 返回 503，其他功能照常。

## 五、app 里填口令

「同行」页右上角 → 设置 →「国外地图访问口令」：填第三步的口令，点「测一下」。
口令和高德 Key 一样只存在这台设备上，不同步、不导出。每台要用国外地图的设备都填一次。

## 六、日本的公交地铁（NAVITIME，选配）

Google 的接口没有日本的公交地铁数据（Google 自家的地图 App 里能查，开放给开发者的没有；东京实测一条方案都没有），日本改问 NAVITIME：

1. 注册 RapidAPI（rapidapi.com），搜「NAVITIME Route(totalnavi)」，订阅免费档（Basic）；订阅时看清超出免费额度后怎么收费。
2. 在**自己的终端**（不要在 Claude Code 里用 `!`，那里是非交互、会传空值）：
   ```sh
   cd /Users/tap4fun/Demo/trip/worker
   npx wrangler secret put RAPIDAPI_KEY    # 粘贴 RapidAPI 的 Key（X-RapidAPI-Key）
   ```
3. `curl https://map.rehearsal.work/health` 里 `navitime` 变成 `true` 就好了，不用重新部署。

没配时日本照旧按估算，标「估」，点「打开地图查换乘」去 Google 地图里查。站名是日文（多数是汉字），票价是 IC 卡价（日元）。

## 接口

都是 `POST` + JSON，返回和 app 里高德那套同样形状的数据：

| 路径 | 请求 | 返回 |
|---|---|---|
| `/v1/search` | `{ q, near? }` | `{ places }` |
| `/v1/nearby` | `{ at, kind: sight\|food\|lodging\|serviceArea, radius }` | `{ places }`（带评分） |
| `/v1/drive` | `{ from, to }` | `{ minutes, km }` |
| `/v1/route` | `{ from, to }` | `{ minutes, points: [{ lng, lat, t }] }` |
| `/v1/transit` | `{ from, to, cc?, at? }` | `{ by, min, summary, steps, fare? }`（日本问 NAVITIME，别处问 Google） |
| `/v1/region` | `{ at }` | `{ country, cc, city, district }` |

测试：`tests/gmap.test.ts`，用假的 Google 返回，不花钱。
