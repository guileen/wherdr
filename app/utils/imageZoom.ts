// Image viewer geometry, pure. The image is laid out at `scale` (1 = actual size,
// in CSS pixels) with its top-left corner at (x, y) inside the viewer box.

export interface ImageSize { w: number, h: number }
export interface ZoomView { scale: number, x: number, y: number }

// Step of the zoom buttons and +/- keys.
export const ZOOM_STEP = 1.5

// An SVG stays crisp at any size, so "fit" may enlarge it; a raster image is
// only ever shown at or below its pixel size.
export function isVectorSrc(src: string): boolean {
  return /^data:image\/svg\+xml/i.test(src) || /\.svg(?:[?#]|$)/i.test(src)
}

// Whole image visible, never enlarged past its actual size (unless vector).
export function fitScale(img: ImageSize, box: ImageSize, vector = false): number {
  if (img.w <= 0 || img.h <= 0 || box.w <= 0 || box.h <= 0) return 1
  const fit = Math.min(box.w / img.w, box.h / img.h)
  return vector ? fit : Math.min(1, fit)
}

// Scale reached by a double tap or a click on the image: the width of the
// box (capped at actual size for a raster image), so a tall capture can be
// read by scrolling; at least twice the fit, so a small image does grow.
export function detailScale(img: ImageSize, box: ImageSize, vector = false): number {
  const fit = fitScale(img, box, vector)
  if (img.w <= 0 || box.w <= 0) return fit
  return Math.max(Math.min(vector ? box.w / img.w : 1, box.w / img.w), fit * 2)
}

export function zoomBounds(img: ImageSize, box: ImageSize, vector = false): { min: number, max: number } {
  const fit = fitScale(img, box, vector)
  // A vector fitted above actual size can still be reduced to 1:1.
  return { min: vector ? Math.min(fit, 1) : fit, max: Math.max(1, fit * 8, detailScale(img, box, vector) * 2) }
}

// One axis: centred when the image is shorter than the box, otherwise no gap at either edge.
function clampAxis(pos: number, size: number, box: number): number {
  if (size <= box) return (box - size) / 2
  return Math.min(0, Math.max(box - size, pos))
}

// Scale within the bounds, position within the box.
export function clampView(v: ZoomView, img: ImageSize, box: ImageSize, vector = false): ZoomView {
  const { min, max } = zoomBounds(img, box, vector)
  const scale = Math.min(max, Math.max(min, v.scale))
  return { scale, x: clampAxis(v.x, img.w * scale, box.w), y: clampAxis(v.y, img.h * scale, box.h) }
}

export function fitView(img: ImageSize, box: ImageSize, vector = false): ZoomView {
  return clampView({ scale: fitScale(img, box, vector), x: 0, y: 0 }, img, box, vector)
}

// New scale keeping the image point under (px, py) — box coordinates — where it is.
export function zoomAt(v: ZoomView, scale: number, px: number, py: number, img: ImageSize, box: ImageSize, vector = false): ZoomView {
  const { min, max } = zoomBounds(img, box, vector)
  const s = Math.min(max, Math.max(min, scale))
  const k = v.scale > 0 ? s / v.scale : 1
  return clampView({ scale: s, x: px - (px - v.x) * k, y: py - (py - v.y) * k }, img, box, vector)
}

// The image is larger than its fit (with a margin for rounding).
export function isZoomed(v: ZoomView, img: ImageSize, box: ImageSize, vector = false): boolean {
  return v.scale > fitScale(img, box, vector) * 1.001
}

// Image larger than the box on at least one axis: a drag pans it.
export function canPan(v: ZoomView, img: ImageSize, box: ImageSize): boolean {
  return img.w * v.scale > box.w + 0.5 || img.h * v.scale > box.h + 0.5
}

// Double tap / click: back to the fit when zoomed, otherwise the detail scale at that point.
export function toggleZoom(v: ZoomView, px: number, py: number, img: ImageSize, box: ImageSize, vector = false): ZoomView {
  if (isZoomed(v, img, box, vector)) return fitView(img, box, vector)
  return zoomAt(v, detailScale(img, box, vector), px, py, img, box, vector)
}

// Wheel delta in pixels to a zoom factor (trackpad pinch = ctrl+wheel, small deltas).
export function wheelFactor(deltaY: number, deltaMode: number): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY
  return Math.exp(-Math.max(-300, Math.min(300, px)) * 0.002)
}
