// 两台「设备」（两个独立用户目录的无头 Chrome）对线上服务器测家庭成员逐人同步。
// 用法：node scripts/two-device-sync.mjs https://47.109.97.108/trip/（在 scratchpad 或任意目录跑，截图写在当前目录）
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
const URL0 = process.argv[2]
const sleep = ms => new Promise(r => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

async function launch(tag) {
  const port = 9400 + Math.floor(Math.random() * 400)
  const proc = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--disable-gpu', '--ignore-certificate-errors', `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/claude-501/chrome-2dev-${tag}-${port}`, 'about:blank'], { stdio: 'ignore' })
  let ws
  for (let i = 0; i < 60 && !ws; i++) { try { const j = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); ws = j.find(x => x.type === 'page')?.webSocketDebuggerUrl } catch {} await sleep(200) }
  const sock = new WebSocket(ws); await new Promise(r => sock.addEventListener('open', r))
  let id = 0; const pend = new Map()
  sock.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } })
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); sock.send(JSON.stringify({ id: i, method, params })) })
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) throw new Error(tag + ': ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result.result?.value }
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await send('Page.enable')
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
    pill: () => ev(`document.querySelector('.cloud-hd .pill')?.textContent ?? ''`),
    shot: async name => { const s = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`2dev-${tag}-${name}.png`, Buffer.from(s.result.data, 'base64')) },
    close: () => { sock.close(); proc.kill() },
  }
  return d
}

const A = await launch('A'), B = await launch('B')
const fail = []
const check = (cond, msg) => { log(cond ? '✓' : '✗', msg); if (!cond) fail.push(msg) }
try {
  for (const d of [A, B]) { await d.go('#party'); await d.ev(`localStorage.clear(); sessionStorage.clear(); 1`); await d.send('Page.reload'); await sleep(2500) }

  // 1. A 开启同步，改外婆
  await A.ev(`document.querySelector('.gear').click(); 1`); await sleep(700)
  await A.click('生成同步码并开启')
  const code = await A.ev(`document.querySelector('.cloud-code')?.getAttribute('aria-label')`)
  check(/^([2-9A-HJ-NP-Z]{4}-){5}[2-9A-HJ-NP-Z]{4}$/.test(code ?? ''), `A 生成同步码（${(code ?? '').slice(0, 4)}-…）`)
  await A.click('记下了，开启同步'); await sleep(5000)
  check((await A.pill()) === '已开', `A 同步状态：${await A.pill()}`)
  await A.esc()
  const a0 = await A.ages()
  await A.bump('外婆'); await sleep(7000)
  const a1 = await A.ages()
  check(a1['外婆'] === a0['外婆'] + 1, `A 把外婆 ${a0['外婆']} → ${a1['外婆']}，等 7 秒推上去`)

  // 2. B 接入：先拿到 A 改的外婆，再改朵朵
  await B.ev(`document.querySelector('.gear').click(); 1`); await sleep(700)
  await B.click('我有同步码，接入')
  await B.ev(`(() => { const i = document.querySelector('.cloud input'); i.focus(); return 1 })()`)
  await B.send('Input.insertText', { text: code.toLowerCase().replace(/-/g, ' ') }); await sleep(300) // 手抄的小写、空格也要认
  await B.click('接入'); await sleep(7000)
  check((await B.pill()) === '已开', `B 接入后状态：${await B.pill()}`)
  await B.esc()
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
  await A.shot('final')
} catch (e) { fail.push(String(e)); log('出错', e.message) }
finally {
  // 清理：A 关闭同步并删除云端
  try {
    await A.esc(); await A.esc(); await A.ev(`document.querySelector('.gear').click(); 1`); await sleep(700)
    await A.click('关闭同步'); await A.click('关闭并删除云端'); await sleep(3000)
    log('清理：', await A.ev(`document.querySelector('.toast')?.textContent ?? ''`))
  } catch (e) { log('清理出错', e.message) }
  A.close(); B.close()
  log(fail.length ? `失败 ${fail.length} 项` : '全部通过')
}
