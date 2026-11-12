import type { Pane } from '#shared/types'

// App-level sheet: the entry lives inside the phone identity sheet, which
// unmounts when it closes, so the viewer cannot own its own state.
export const contextViewer = reactive<{ open: boolean, pane: Pane | null }>({ open: false, pane: null })

export function openContextViewer(pane: Pane) {
  contextViewer.pane = pane
  contextViewer.open = true
}
