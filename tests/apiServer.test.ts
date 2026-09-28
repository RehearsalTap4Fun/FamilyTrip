import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'

let base = ''
let srv: Server
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trip-sync-'))

beforeAll(async () => {
  process.env.DATA_DIR = dir
  // @ts-expect-error 服务端是纯 .mjs
  const { createServer } = await import('../server/api-server.mjs')
  srv = createServer().listen(0, '127.0.0.1')
  await new Promise(r => srv.on('listening', r))
  base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`
})
afterAll(() => { srv.close(); fs.rmSync(dir, { recursive: true, force: true }) })

const id = 'a'.repeat(64)
const put = (body: unknown) => fetch(`${base}/sync/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) })

describe('服务端：云同步', () => {
  it('没有时 version 0；按版本号写，版本不对 409 并带回当前记录；删掉回到 0', async () => {
    expect(await (await fetch(`${base}/sync/${id}`)).json()).toEqual({ version: 0, blob: null, updatedAt: 0 })
    expect((await (await put({ blob: 'v1.xxx', baseVersion: 0 })).json()).version).toBe(1)
    const c = await put({ blob: 'v1.yyy', baseVersion: 0 })
    expect(c.status).toBe(409)
    expect((await c.json()).blob).toBe('v1.xxx')
    expect((await (await put({ blob: 'v1.yyy', baseVersion: 1 })).json()).version).toBe(2)
    expect(fs.existsSync(path.join(dir, id + '.json'))).toBe(true)
    await fetch(`${base}/sync/${id}`, { method: 'DELETE' })
    expect((await (await fetch(`${base}/sync/${id}`)).json()).version).toBe(0)
  })

  it('坏请求回 400，进程不挂；id 不是 64 位十六进制 404', async () => {
    for (const b of ['null', '1', '"x"', '{bad', JSON.stringify({ blob: '', baseVersion: 0 })]) expect((await put(b)).status).toBe(400)
    expect((await fetch(`${base}/sync/abc`)).status).toBe(404)
    expect((await fetch(`${base}/health`)).status).toBe(200)
  })

  it('本地开发的页面可以跨域调用（带 PUT 与 Content-Type 预检）；陌生来源不给', async () => {
    const pre = await fetch(`${base}/sync/${id}`, { method: 'OPTIONS', headers: { Origin: 'http://localhost:5321' } })
    expect(pre.headers.get('access-control-allow-origin')).toBe('http://localhost:5321')
    expect(pre.headers.get('access-control-allow-methods')).toContain('PUT')
    expect(pre.headers.get('access-control-allow-headers')).toContain('Content-Type')
    const bad = await fetch(`${base}/sync/${id}`, { headers: { Origin: 'https://evil.example.com' } })
    expect(bad.headers.get('access-control-allow-origin')).toBeNull()
  })
})
