// 两台「设备」（两个独立用户目录的无头 Chrome）对线上服务器测同步：家庭成员逐人合并、现居地。
// 用法：node scripts/two-device-sync.mjs https://47.109.97.108/trip/ [people|home|all]（默认 all；截图写在当前目录）
// 同步走线上真的服务器；高德换成模拟数据（无头浏览器里没有真的 Key），搜「昆明」「成都」「大理」各给一个地点。每个场景测完关闭同步并删除云端。
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
const URL0 = process.argv[2]
const WHICH = process.argv[3] ?? 'all'

// 模拟高德地点搜索：只认这几个城市
const CITY = { 昆明: [102.712, 25.040, '530102', '昆明市'], 成都: [104.066, 30.572, '510104', '成都市'], 大理: [100.225, 25.590, '532901', '大理白族自治州'] }
function amap(url) {
  const k = new URL(url).searchParams.get('keywords') ?? ''
  const hit = Object.keys(CITY).find(c => k.includes(c))
  if (!hit) return { status: '1', info: 'OK', pois: [] }
  const [lng, lat, adcode, cityname] = CITY[hit]
  return { status: '1', info: 'OK', pois: [{ id: 'M' + hit, name: hit + '市人民政府', address: '', location: `${lng},${lat}`, pname: '', cityname, adname: '', adcode, type: '政府机构及社会团体;政府机关;区县级政府及事业单位' }] }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

async function launch(tag) {
  const port = 9400 + Math.floor(Math.random() * 400)
  const proc = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--disable-gpu', '--ignore-certificate-errors', `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/claude-501/chrome-2dev-${tag}-${port}`, 'about:blank'], { stdio: 'ignore' })
  let ws
  for (let i = 0; i < 60 && !ws; i++) { try { const j = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); ws = j.find(x => x.type === 'page')?.webSocketDebuggerUrl } catch {} await sleep(200) }
  const sock = new WebSocket(ws); await new Promise(r => sock.addEventListener('open', r))
  let id = 0; const pend = new Map()
  sock.addEventListener('message', e => {
    const m = JSON.parse(e.data)
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) }
    if (m.method === 'Fetch.requestPaused') {
      const body = Buffer.from(JSON.stringify(amap(m.params.request.url))).toString('base64')
      send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }], body })
    }
  })
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); sock.send(JSON.stringify({ id: i, method, params })) })
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) throw new Error(tag + ': ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result.result?.value }
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await send('Page.enable')
  await send('Fetch.enable', { patterns: [{ urlPattern: '*restapi.amap.com*' }] })
  const d = {
    tag, ev, send,
    go: async hash => { await send('Page.navigate', { url: URL0 + hash }); await sleep(2500) },
    // 点文字开头匹配的最后一个可见按钮
    click: async text => { const ok = await ev(`(() => { const el = [...document.querySelectorAll('button')].reverse().find(e => e.textContent.trim().startsWith(${JSON.stringify(text)}) && e.offsetParent); if (!el) return false; el.click(); return true })()`); if (!ok) throw new Error(`${tag}: 找不到按钮「${text}」`); await sleep(600) },
    esc: async () => { await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); 1`); await sleep(700) },
    state: () => ev(`JSON.parse(localStorage.getItem('tonglu.v1'))`),
    ages: async () => { const s = await d.state(); return Object.fromEntries(s.roster.members.map(m => [m.name, m.age ?? '-'])) },
    // 在「同行」页点某个家庭成员，把年龄 +1
    bump: async name => {
      await ev(`(() => { const b = [...document.querySelectorAll('.family .card-btn')].find(x => x.querySelector('.cname')?.textContent === ${JSON.stringify(name)}); b.click(); return 1 })()`); await sleep(700)
      await ev(`(() => { const b = [...document.querySelectorAll('.sheet-panel .stepper button')].pop(); b.click(); return 1 })()`); await sleep(300)
      await d.esc()
    },
    // 回到前台会触发一次同步
    wake: async () => { await ev(`document.dispatchEvent(new Event('visibilitychange')); 1`) },
    // 「同行」页的现居地：搜高德选一个 / 点「不设」
    setHome: async q => {
      await ev(`(() => { const f = [...document.querySelectorAll('.family .kfield')].find(x => x.textContent.includes('现居地')); [...f.querySelectorAll('button')].find(b => b.textContent === '搜高德').click(); return 1 })()`); await sleep(800)
      await ev(`(() => { const i = document.querySelector('.search-row input'); i.focus(); i.select(); return 1 })()`)
      await send('Input.insertText', { text: q }); await sleep(200)
      await ev(`document.querySelector('.sheet-panel .search-row button').click(); 1`); await sleep(1200)
      const ok = await ev(`(() => { const b = document.querySelector('.sheet-panel .card-btn.place'); if (!b) return false; b.click(); return true })()`); await sleep(800)
      if (!ok) throw new Error(`${tag}: 高德（模拟）没搜到「${q}」`)
    },
    clearHome: async () => { await ev(`(() => { const f = [...document.querySelectorAll('.family .kfield')].find(x => x.textContent.includes('现居地')); [...f.querySelectorAll('button')].find(b => b.textContent === '不设').click(); return 1 })()`); await sleep(500) },
    home: async () => (await d.state()).home?.name ?? '（没设）',
    pill: () => ev(`document.querySelector('.cloud-hd .pill')?.textContent ?? ''`),
    shot: async name => { const s = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`2dev-${tag}-${name}.png`, Buffer.from(s.result.data, 'base64')) },
    close: () => { sock.close(); proc.kill() },
  }
  return d
}

const fail = []
const check = (cond, msg) => { log(cond ? '✓' : '✗', msg); if (!cond) fail.push(msg) }

/** 两台干净的设备：A 生成同步码开启，B 用手抄的码接入（小写、空格） */
async function pair(A, B, beforeJoin) {
  for (const d of [A, B]) {
    await d.go('#party'); await d.ev(`localStorage.clear(); sessionStorage.clear(); 1`); await d.send('Page.reload'); await sleep(2500)
    // 高德是模拟的，随便填个 Key 让「搜高德」能点（Key 不同步）
    await d.ev(`(() => { const s = JSON.parse(localStorage.getItem('tonglu.v1')); s.amapKey = 'mock-key'; localStorage.setItem('tonglu.v1', JSON.stringify(s)); return 1 })()`); await d.send('Page.reload'); await sleep(2500)
  }
  await A.ev(`document.querySelector('.gear').click(); 1`); await sleep(700)
  await A.click('生成同步码并开启')
  const code = await A.ev(`document.querySelector('.cloud-code')?.getAttribute('aria-label')`)
  check(/^([2-9A-HJ-NP-Z]{4}-){5}[2-9A-HJ-NP-Z]{4}$/.test(code ?? ''), `A 生成同步码（${(code ?? '').slice(0, 4)}-…）`)
  await A.click('记下了，开启同步'); await sleep(5000)
  check((await A.pill()) === '已开', `A 同步状态：${await A.pill()}`)
  await A.esc()
  await beforeJoin?.()
  await B.ev(`document.querySelector('.gear').click(); 1`); await sleep(700)
  await B.click('我有同步码，接入')
  await B.ev(`(() => { const i = document.querySelector('.cloud input'); i.focus(); return 1 })()`)
  await B.send('Input.insertText', { text: code.toLowerCase().replace(/-/g, ' ') }); await sleep(300)
  await B.click('接入'); await sleep(7000)
  check((await B.pill()) === '已开', `B 接入后状态：${await B.pill()}`)
  await B.esc()
}

/** 清理：A 关闭同步并删除云端 */
async function unpair(A) {
  try {
    await A.esc(); await A.esc(); await A.ev(`document.querySelector('.gear').click(); 1`); await sleep(700)
    await A.click('关闭同步'); await A.click('关闭并删除云端'); await sleep(3000)
    log('清理：', await A.ev(`document.querySelector('.toast')?.textContent ?? ''`))
  } catch (e) { log('清理出错', e.message) }
}

async function people(A, B) {
  log('—— 家庭成员逐人合并 ——')
  let a1
  await pair(A, B, async () => {
    const a0 = await A.ages()
    await A.bump('外婆'); await sleep(7000)
    a1 = await A.ages()
    check(a1['外婆'] === a0['外婆'] + 1, `A 把外婆 ${a0['外婆']} → ${a1['外婆']}，等 7 秒推上去`)
  })
  const b1 = await B.ages()
  check(b1['外婆'] === a1['外婆'], `B 接入后外婆是 ${b1['外婆']}（A 改的，没被 B 本机从示例迁来的旧资料盖掉）`)
  await B.bump('朵朵'); await sleep(7000)
  const b2 = await B.ages()
  check(b2['朵朵'] === b1['朵朵'] + 1, `B 把朵朵 ${b1['朵朵']} → ${b2['朵朵']}，推上去`)

  // 3. A 拉取
  await A.wake(); await sleep(6000)
  const a2 = await A.ages()
  check(a2['外婆'] === a1['外婆'] && a2['朵朵'] === b2['朵朵'], `A 拉取后：外婆 ${a2['外婆']}、朵朵 ${a2['朵朵']}（两处改动都在）`)

  // 4. 并发：A 改外婆、B 改朵朵，都还没推时一起同步
  await A.bump('外婆'); await B.bump('朵朵')
  await sleep(1500)
  await Promise.all([A.wake(), B.wake()]); await sleep(9000)
  await Promise.all([A.wake(), B.wake()]); await sleep(7000)
  const a3 = await A.ages(), b3 = await B.ages()
  check(a3['外婆'] === a2['外婆'] + 1 && a3['朵朵'] === a2['朵朵'] + 1, `并发后 A：外婆 ${a3['外婆']}、朵朵 ${a3['朵朵']}`)
  check(b3['外婆'] === a3['外婆'] && b3['朵朵'] === a3['朵朵'], `并发后 B：外婆 ${b3['外婆']}、朵朵 ${b3['朵朵']}（和 A 一致）`)

  // 5. 删人：B 删掉小林，A 拉取后也没了
  await B.ev(`(() => { const b = [...document.querySelectorAll('.family .card-btn')].find(x => x.querySelector('.cname')?.textContent === '小林'); b.click(); return 1 })()`); await sleep(700)
  await B.click('从家庭成员里删掉'); await sleep(6500)
  await A.wake(); await sleep(6000)
  const a4 = await A.ages()
  check(!('小林' in a4), `B 删了小林，A 拉取后家庭成员：${Object.keys(a4).join('、')}`)
}

async function home(A, B) {
  log('—— 现居地 ——')
  await pair(A, B, async () => {
    await A.setHome('昆明'); await sleep(7000)
    check((await A.home()) === '昆明市人民政府', `A 在「同行」页把现居地设成 ${await A.home()}，等 7 秒推上去`)
  })
  check((await B.home()) === '昆明市人民政府', `B 接入后现居地：${await B.home()}`)

  await B.setHome('成都'); await sleep(7000)
  await A.wake(); await sleep(6000)
  check((await A.home()) === '成都市人民政府', `B 改成成都，A 拉取后：${await A.home()}`)

  // 并发：A 改现居地、B 改外婆，都没推时一起同步——现居地和家庭成员分开记，两处都留下
  const g0 = (await A.ages())['外婆']
  await A.setHome('大理'); await B.bump('外婆')
  await sleep(1500)
  await Promise.all([A.wake(), B.wake()]); await sleep(9000)
  await Promise.all([A.wake(), B.wake()]); await sleep(7000)
  for (const d of [A, B]) {
    const h = await d.home(), g = (await d.ages())['外婆']
    check(h === '大理市人民政府' && g === g0 + 1, `并发后 ${d.tag}：现居地 ${h}、外婆 ${g}（A 改的现居地、B 改的外婆都在）`)
  }

  // 清掉：B 点「不设」，A 拉取后也没了
  await B.clearHome(); await sleep(7000)
  await A.wake(); await sleep(6000)
  check((await A.home()) === '（没设）', `B 清掉现居地，A 拉取后：${await A.home()}`)
  await A.shot('home-final')
}

for (const [name, fn] of [['people', people], ['home', home]]) {
  if (WHICH !== 'all' && WHICH !== name) continue
  const A = await launch('A'), B = await launch('B')
  try { await fn(A, B) } catch (e) { fail.push(String(e)); log('出错', e.message) }
  finally { await unpair(A); A.close(); B.close() }
}
log(fail.length ? `失败 ${fail.length} 项` : '全部通过')
