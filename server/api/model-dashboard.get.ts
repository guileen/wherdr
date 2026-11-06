import { defineApi } from '../utils/http'
import { modelDashboard } from '../utils/modelDashboard'

// Authentication/network checks are enforced by the shared API middleware.
export default defineApi(() => modelDashboard.get())
