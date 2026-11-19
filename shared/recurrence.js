/** Recurring tasks: computes the next due date for a recurrence rule. */

export const FREQUENCIES = { daily: 'Every day', weekly: 'Every week', monthly: 'Every month' }

/**
 * @param {string} fromDate ISO date (YYYY-MM-DD)
 * @param {{ freq: 'daily'|'weekly'|'monthly', interval?: number }} rule
 * @returns {string} next ISO date
 */
export function nextOccurrence(fromDate, rule) {
  const d = new Date(`${fromDate}T00:00:00Z`)
  const n = Math.max(1, Math.min(365, Number(rule.interval) || 1))
  if (rule.freq === 'daily') d.setUTCDate(d.getUTCDate() + n)
  else if (rule.freq === 'weekly') d.setUTCDate(d.getUTCDate() + 7 * n)
  else if (rule.freq === 'monthly') {
    const day = d.getUTCDate()
    d.setUTCDate(1)
    d.setUTCMonth(d.getUTCMonth() + n)
    // Clamp 31 Jan → 28/29 Feb instead of overflowing into March
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
    d.setUTCDate(Math.min(day, last))
  } else throw new Error(`Unknown frequency: ${rule.freq}`)
  return d.toISOString().slice(0, 10)
}

export function describeRecurrence(rule) {
  if (!rule) return 'Does not repeat'
  const n = Number(rule.interval) || 1
  if (n === 1) return FREQUENCIES[rule.freq]
  return `Every ${n} ${rule.freq === 'daily' ? 'days' : rule.freq === 'weekly' ? 'weeks' : 'months'}`
}
