import path from 'node:path'
import fsp from 'node:fs/promises'
import type { H3Event } from 'h3'
import { getRouterParam, setResponseHeader, setResponseStatus } from 'h3'
import { sendError } from './http'

export const LOCAL_IMAGE_EXTS: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
}

const MAX_IMAGE_BYTES = 50 * 1024 * 1024 // 50 MB

export async function handleLocalImage(event: H3Event, basePrefix: string) {
  if (event.method !== 'GET' && event.method !== 'HEAD') {
    setResponseStatus(event, 405)
    return sendError(event, 405, { error: 'Method not allowed' })
  }

  const rawParam = getRouterParam(event, 'path') || ''
  let subPath: string
  try {
    subPath = decodeURIComponent(rawParam)
  } catch {
    return sendError(event, 400, { error: 'Invalid path encoding' })
  }

  let fullPath: string
  if (basePrefix === '~') {
    const home = process.env.HOME || ''
    fullPath = path.resolve(home, subPath)
  } else {
    fullPath = path.resolve(basePrefix, subPath)
  }

  // 1. Extension check: allowed image formats only
  const ext = path.extname(fullPath).toLowerCase().replace(/^\./, '')
  const mime = LOCAL_IMAGE_EXTS[ext]
  if (!mime) {
    return sendError(event, 404, { error: 'Not an image' })
  }

  // 2. Sensitive directory and hidden file protection
  const parts = fullPath.split(path.sep).filter(Boolean)
  if (parts.some(p => p.startsWith('.'))) {
    return sendError(event, 404, { error: 'Image not found' })
  }

  // 3. Allowed roots check
  const allowedRoots = ['/Users/', '/home/', '/tmp/', '/private/tmp/']
  const home = process.env.HOME
  if (home) allowedRoots.push(home.endsWith('/') ? home : `${home}/`)
  const isAllowedRoot = allowedRoots.some(r => fullPath.startsWith(r))
  if (!isAllowedRoot) {
    return sendError(event, 403, { error: 'Forbidden' })
  }

  // 4. File existence & size check
  try {
    const st = await fsp.stat(fullPath)
    if (!st.isFile()) {
      return sendError(event, 404, { error: 'Not a file' })
    }
    if (st.size > MAX_IMAGE_BYTES) {
      return sendError(event, 413, { error: 'Image too large' })
    }

    setResponseHeader(event, 'content-type', mime)
    setResponseHeader(event, 'content-length', st.size)
    setResponseHeader(event, 'cache-control', 'private, max-age=86400')
    setResponseHeader(event, 'x-content-type-options', 'nosniff')
    setResponseHeader(event, 'content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")

    if (event.method === 'HEAD') return ''
    return await fsp.readFile(fullPath)
  } catch {
    return sendError(event, 404, { error: 'Image not found' })
  }
}
