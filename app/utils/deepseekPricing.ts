// DeepSeek bills API tokens by time of day. Peak is 01:00–04:00 and
// 06:00–10:00 UTC, Monday through Friday, except Chinese public holidays; every
// other hour is off-peak at half the peak rate. Catalog prices are peak prices.
// https://api-docs.deepseek.com/quick_start/pricing/
import { DEEPSEEK_CNY_PER_USD, type DashboardCost } from '../../shared/modelDashboard'

export const DEEPSEEK_PEAK_NOTE = 'Peak: Monday–Friday 01:00–04:00 and 06:00–10:00 UTC (09:00–12:00 and 14:00–18:00 Beijing), excluding Chinese public holidays. Off-peak is half price.'
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const BEIJING = 8 * HOUR

export interface DeepseekPeakWindow {
  weekdays: readonly number[]
  startMinute: number
  endMinute: number
}
export interface DeepseekSchedule {
  offPeakMultiplier: number
  peakWindows: readonly DeepseekPeakWindow[]
}
// What DeepSeek publishes when the catalog omits its peak metadata.
const DEFAULT_SCHEDULE: DeepseekSchedule = {
  offPeakMultiplier: 0.5,
  peakWindows: [
    { weekdays: [1, 2, 3, 4, 5], startMinute: 1 * 60, endMinute: 4 * 60 },
    { weekdays: [1, 2, 3, 4, 5], startMinute: 6 * 60, endMinute: 10 * 60 },
  ],
}

// Chinese public holidays, as published by the State Council. Update the table
// when the next year's notice appears; ordinary weekends need no entries.
const HOLIDAYS: readonly (readonly [string, string])[] = [
  ['2026-01-01', '2026-01-03'],
  ['2026-02-15', '2026-02-23'],
  ['2026-04-04', '2026-04-06'],
  ['2026-05-01', '2026-05-05'],
  ['2026-06-19', '2026-06-21'],
  ['2026-09-25', '2026-09-27'],
  ['2026-10-01', '2026-10-07'],
  ['2027-01-01', '2027-01-03'],
  ['2027-02-05', '2027-02-13'],
  ['2027-04-03', '2027-04-05'],
  ['2027-05-01', '2027-05-05'],
  ['2027-06-09', '2027-06-09'],
  ['2027-09-15', '2027-09-15'],
  ['2027-10-01', '2027-10-07'],
]

const holidayDates = new Set<string>()
for (const [start, end] of HOLIDAYS) {
  for (let at = Date.parse(`${start}T00:00:00Z`), last = Date.parse(`${end}T00:00:00Z`); at <= last; at += DAY) {
    holidayDates.add(new Date(at).toISOString().slice(0, 10))
  }
}

function beijingDate(at: number): string {
  return new Date(at + BEIJING).toISOString().slice(0, 10)
}

// The published windows are UTC, but Chinese holidays are Beijing calendar
// dates; these windows all fall inside one Beijing day (09:00–12:00 and
// 14:00–18:00), so the UTC weekday is the Beijing weekday. Instants are
// absolute, so the viewer's own timezone never enters the calculation.
export function beijingClock(at: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(at)
}

export interface DeepseekPricing {
  peak: boolean
  /** Fraction of the catalog peak price billed now: 1 at peak, 0.5 off-peak. */
  factor: number
  /** Epoch milliseconds of the next peak/off-peak change. */
  until: number
  /** The active off-peak period is a Chinese public holiday. */
  holiday: boolean
}

function isPeak(at: number, schedule: DeepseekSchedule): boolean {
  const date = new Date(at)
  const weekday = date.getUTCDay()
  if (holidayDates.has(beijingDate(at))) return false
  const minute = date.getUTCHours() * 60 + date.getUTCMinutes()
  return schedule.peakWindows.some(window =>
    window.weekdays.includes(weekday) && minute >= window.startMinute && minute < window.endMinute)
}

function nextChange(at: number, peak: boolean, schedule: DeepseekSchedule): number {
  const date = new Date(at)
  const boundaries = [...new Set(schedule.peakWindows.flatMap(window => [window.startMinute, window.endMinute]))]
  for (let offset = 0; offset < 15; offset++) {
    for (const minute of boundaries) {
      const candidate = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + offset) + minute * MINUTE
      if (candidate > at && isPeak(candidate, schedule) !== peak) return candidate
    }
  }
  return at + DAY
}

export function deepseekPricing(at: number, schedule: DeepseekSchedule = DEFAULT_SCHEDULE): DeepseekPricing {
  const peak = isPeak(at, schedule)
  return { peak, factor: peak ? 1 : schedule.offPeakMultiplier, until: nextChange(at, peak, schedule), holiday: !peak && holidayDates.has(beijingDate(at)) }
}

export function deepseekCnyPrice(cost: DashboardCost | null | undefined, factor: number): { input: number, output: number } | null {
  if (!cost || !Number.isFinite(cost.input) || !Number.isFinite(cost.output) || cost.input < 0 || cost.output < 0) return null
  return {
    input: cost.input * DEEPSEEK_CNY_PER_USD * factor,
    output: cost.output * DEEPSEEK_CNY_PER_USD * factor,
  }
}
