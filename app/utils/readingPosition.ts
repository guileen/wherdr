// Per-pane reading context for the app lifetime; never infer intent from geometry.
export interface ReadingAnchor {
  key: string
  textOffset: number
  text: string
  viewportOffset: number
  sourceOffset?: number
}
export interface OutputBoundary { key: string, text: string, out?: string, err?: string }
export interface ReadingPosition {
  file: string
  anchor: ReadingAnchor
  hasNewBelow: boolean
  latest: OutputBoundary | null
}
const positions = new Map<string, ReadingPosition>()
const MAX_KEPT = 50

export function saveReadingPosition(paneId: string, position: ReadingPosition | null) {
  positions.delete(paneId)
  if (!position) return
  positions.set(paneId, position)
  if (positions.size > MAX_KEPT) positions.delete(positions.keys().next().value!)
}

export function readingPosition(paneId: string, file: string): ReadingPosition | null {
  const position = positions.get(paneId)
  return position?.file === file ? position : null
}
