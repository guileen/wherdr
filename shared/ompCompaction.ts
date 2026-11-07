// Live labels emitted by omp's manual and automatic maintenance loaders.
export function ompCompacting(step: string | null | undefined): boolean {
  return /^(?:(?:Context overflow detected, |Response incomplete, |Idle )?Auto (?:server compaction|context-full maintenance)|Auto-(?:compacting context|handoff|shake|snapcompact)|Compacting context)(?:…|\.\.\.)/i.test(step || '')
}
