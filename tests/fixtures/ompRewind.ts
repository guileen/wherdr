import type { ChatItem } from '../../shared/types'

// Normalized journal rows, shared by component and isolated browser journeys.
export function rewindItems(): ChatItem[] {
  return [
    { id: 'request', offset: 0, role: 'user', text: 'Review the example module.', ts: null },
    { id: 'checkpoint', offset: 100, role: 'system', text: 'Work package checkpoint recorded', ts: null, ompContext: { entryId: 'checkpoint-result', checkpointId: 'parent-package' } },
    { id: 'search-intro', offset: 200, role: 'assistant', text: 'Retired locating explanation.', ts: null, ompContext: { entryId: 'locating-batch' } },
    { id: 'search-call', offset: 200, role: 'tool', text: 'src/item.ts', name: 'Read', ts: null, ref: '200', images: 1, omp: { title: 'Read', target: 'src/item.ts', out: 'Retired file output.' }, ompContext: { entryId: 'locating-batch', searchId: 'search-one' } },
    { id: 'search-cut', offset: 350, role: 'notice', name: 'context-rewind', text: 'Search decision retained.', ts: null,
      rewind: { kind: 'search', contextChanged: true, anchorOffset: 100, searchId: 'search-one', nextAction: 'Inspect the selected function.', materials: [{ ref: 'source-one', path: 'src/item.ts', first: 4, last: 9, tag: 'ABCD', body: 'const safe = "<img src=x onerror=alert(1)>"' }] } },
    { id: 'child-report', offset: 400, role: 'assistant', text: 'Retired child analysis.', ts: null },
    { id: 'parent-cut', offset: 500, role: 'notice', name: 'context-rewind', text: '**Package handoff retained.**', ts: null,
      rewind: { kind: 'work-package', contextChanged: true, anchorOffset: 100, checkpointId: 'parent-package', parentId: 'outer-package', outcome: 'completed', nextAction: 'Continue the outer package.' } },
    { id: 'no-cut', offset: 600, role: 'notice', name: 'context-rewind', text: 'Scope closed without a cut.', ts: null,
      rewind: { kind: 'work-package', contextChanged: false, checkpointId: 'parent-package', outcome: 'completed' } },
    { id: 'current-request', offset: 700, role: 'user', text: 'Keep the current request visible.', ts: null },
    { id: 'current-call', offset: 800, role: 'tool', name: 'Bash', text: 'echo current-action', out: 'Current output.', ts: null, omp: { title: 'Bash', target: 'echo current-action', exit: 0 } },
    { id: 'current-reply', offset: 900, role: 'assistant', text: 'Current response remains visible.', ts: null },
  ]
}
