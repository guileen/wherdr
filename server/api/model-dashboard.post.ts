import { defineApi } from '../utils/http'
import { HerdrError } from '../utils/herdr'
import { modelDashboard } from '../utils/modelDashboard'

export default defineApi((_event, body: unknown) => {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !('selector' in body)) {
    throw new HerdrError('bad_model_selection', 'Choose a supported dashboard model')
  }
  return modelDashboard.select(body.selector)
})
