import { defineApi } from '../utils/http'
import { HerdrError } from '../utils/herdr'

// The text omp assembles before a turn. A session only keeps a 16-hex digest,
// so this is the local build's default, captured once from omp itself: the
// <project-context> block (cwd, AGENTS.md) is per pane and not included.
export default defineApi(async () => {
  const template = await useStorage('assets:server').getItem('omp-prompt.json')
  if (!template) throw new HerdrError('unavailable', 'Prompt template unavailable')
  return template
})
