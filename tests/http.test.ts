import { afterAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import { createApp, toWebHandler } from 'h3'

// Vitest hoists this factory before static imports; load its isolated-data helpers here.
vi.mock('../server/utils/env', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const os = await import('node:os')
  return { DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'wherdr-http-')), PASSKEY_USER: 'test', log: () => {} }
})
import { DATA_DIR } from '../server/utils/env'
import { defineApi } from '../server/utils/http'

const handler = vi.fn((_event, body) => ({ body }))
const request = toWebHandler(createApp().use('/api/check', defineApi(handler)))
afterAll(async () => { await fs.rm(DATA_DIR, { recursive: true, force: true }) })

describe('shared HTTP write admission', () => {
  it.each([
    ['http://other', 'application/json'],
    ['http://localhost', 'application/json-invalid'],
    ['http://localhost', 'text/plain'],
  ])('rejects Origin %s and MIME %s before invoking the route', async (origin, contentType) => {
    handler.mockClear()
    const response = await request(new Request('http://localhost/api/check', {
      method: 'POST', headers: { host: 'localhost', origin, 'content-type': contentType }, body: '{}',
    }))
    expect(response.status).toBe(403)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toMatchObject({ code: 'origin' })
    expect(handler).not.toHaveBeenCalled()
  })

  it.each(['application/json', 'application/json; charset=utf-8', 'Application/JSON'])('accepts same-Origin %s', async contentType => {
    const response = await request(new Request('http://localhost/api/check', {
      method: 'POST', headers: { host: 'localhost', origin: 'http://localhost', 'content-type': contentType }, body: '{"test":1}',
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ body: { test: 1 } })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})
