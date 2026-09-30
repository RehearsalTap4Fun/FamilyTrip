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

describe('服务端：国外地图转发', () => {
  it('POST /gmap/* 原样转给中转，口令照带；没配地址 503；别的接口 404', async () => {
    // @ts-expect-error 服务端是纯 .mjs
    const { createServer } = await import('../server/api-server.mjs')
    const got: { url: string; token: string; body: string }[] = []
    const fake = async (url: string, init: RequestInit) => { got.push({ url, token: (init.headers as Record<string, string>)['X-Trip-Token'], body: String(init.body) }); return new Response(JSON.stringify({ minutes: 21, km: 8.4 }), { status: 200 }) }
    const s1 = createServer({ gmapUrl: 'https://map.example/', fetch: fake }).listen(0, '127.0.0.1')
    const s2 = createServer({ gmapUrl: '' }).listen(0, '127.0.0.1')
    await Promise.all([s1, s2].map(s => new Promise(r => s.on('listening', r))))
    const b1 = `http://127.0.0.1:${(s1.address() as AddressInfo).port}`, b2 = `http://127.0.0.1:${(s2.address() as AddressInfo).port}`
    const body = JSON.stringify({ from: { lng: 1, lat: 2 }, to: { lng: 3, lat: 4 } })
    const r = await fetch(`${b1}/gmap/drive`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Trip-Token': 'tok' }, body })
    expect(await r.json()).toEqual({ minutes: 21, km: 8.4 })
    expect(got).toEqual([{ url: 'https://map.example/v1/drive', token: 'tok', body }])
    expect((await fetch(`${b1}/gmap/other`, { method: 'POST', body: '{}' })).status).toBe(404)
    expect((await fetch(`${b1}/gmap/drive`)).status).toBe(405)
    const prev = process.env.GMAP_URL; delete process.env.GMAP_URL
    expect((await fetch(`${b2}/gmap/drive`, { method: 'POST', body })).status).toBe(503)
    if (prev) process.env.GMAP_URL = prev
    s1.close(); s2.close()
  })
})
