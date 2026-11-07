import { describe, expect, it, vi } from 'vitest'
import fsp from 'node:fs/promises'
import type { H3Event } from 'h3'
import { handleLocalImage } from '../server/utils/localImage'

interface TestEventContext {
  params?: Record<string, string>
}

interface TestMockEvent {
  method: string
  context: TestEventContext
  _headers: Record<string, string | number>
  _status: number
  node: {
    req: { method: string }
    res: Record<string, unknown>
  }
}
function mockEvent(method: string, pathParam: string): { event: H3Event & TestMockEvent } {
  const headers: Record<string, string | number> = {}
  const ev = {
    method,
    context: { params: { path: pathParam } },
    _headers: headers,
    _status: 200,
    node: {
      req: { method, headers: {} },
      res: {
        setHeader: (k: string, v: string | number) => { headers[k.toLowerCase()] = v },
        getHeader: (k: string) => headers[k.toLowerCase()],
      },
    },
  } as unknown as H3Event & TestMockEvent
  return { event: ev }
}
vi.mock('h3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('h3')>()
  return {
    ...actual,
    sendError: (event: TestMockEvent, code: number, body: Record<string, unknown>) => {
      event._status = code
      return body
    },
    setResponseStatus: (event: TestMockEvent, code: number) => {
      event._status = code
    },
    sendError: (event: TestMockEvent, code: number, body: Record<string, unknown>) => {
      event._status = code
      return { status: code, body }
    },
  }
})

describe('handleLocalImage', () => {
  it('serves an existing webp image with correct content-type and headers', async () => {
    const targetFile = '/Users/gl/llmwork/vertex-color-orbit-20261107/reference.webp'
    const exists = await fsp.stat(targetFile).then(s => s.isFile()).catch(() => false)
    if (!exists) return

    const relParam = 'gl/llmwork/vertex-color-orbit-20261107/reference.webp'
    const { event } = mockEvent('GET', relParam)

    const res = await handleLocalImage(event, '/Users')
    expect(Buffer.isBuffer(res)).toBe(true)
    expect(event._headers['content-type']).toBe('image/webp')
    expect(event._headers['x-content-type-options']).toBe('nosniff')
    expect(event._headers['content-security-policy']).toContain("default-src 'none'")
  })

  it('rejects non-image extensions with 404', async () => {
    const { event } = mockEvent('GET', 'gl/.ssh/id_rsa')
    const res = await handleLocalImage(event, '/Users')
    expect(event._status).toBe(404)
    expect(res).toEqual({ error: 'Not an image' })
  })

  it('rejects hidden files or folders with 404', async () => {
    const { event } = mockEvent('GET', 'gl/.secret/photo.png')
    const res = await handleLocalImage(event, '/Users')
    expect(event._status).toBe(404)
    expect(res).toEqual({ error: 'Image not found' })
  })

  it('rejects forbidden root directories with 403', async () => {
    const { event } = mockEvent('GET', 'etc/shadow.png')
    const res = await handleLocalImage(event, '/var')
    expect(event._status).toBe(403)
    expect(res).toEqual({ error: 'Forbidden' })
  })

  it('returns 404 for missing files', async () => {
    const { event } = mockEvent('GET', 'gl/non-existent-image-12345.png')
    const res = await handleLocalImage(event, '/Users')
    expect(event._status).toBe(404)
    expect(res).toEqual({ error: 'Image not found' })
  })
  it('handles HEAD request with empty string body', async () => {
    const targetFile = '/Users/gl/llmwork/vertex-color-orbit-20261107/reference.webp'
    const exists = await fsp.stat(targetFile).then(s => s.isFile()).catch(() => false)
    if (!exists) return

    const { event } = mockEvent('HEAD', 'gl/llmwork/vertex-color-orbit-20261107/reference.webp')
    const res = await handleLocalImage(event, '/Users')
    expect(res).toBe('')
    expect(event._headers['content-type']).toBe('image/webp')
  })

  it('rejects POST method with 405', async () => {
    const { event } = mockEvent('POST', 'gl/photo.png')
    const res = await handleLocalImage(event, '/Users')
    expect(event._status).toBe(405)
    expect(res).toEqual({ error: 'Method not allowed' })
  })
})
