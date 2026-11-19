/**
 * Pure pricing logic — no React, so it's trivial to unit-test and reuse
 * (e.g. on a checkout page or in a backend).
 */

/** @param {{monthly:number, yearly:number}} plan @param {'monthly'|'yearly'} billing */
export function pricePerSeat(plan, billing) {
  return billing === 'yearly' ? plan.yearly : plan.monthly
}

/** Percentage saved by paying yearly, rounded (e.g. 17). 0 for free plans. */
export function yearlyDiscountPercent(plan) {
  if (!plan.monthly) return 0
  return Math.round((1 - plan.yearly / plan.monthly) * 100)
}

/**
 * Estimates the monthly value FlowDesk creates for a team.
 * Assumption (shown to users): FlowDesk removes ~40% of the time lost to coordination.
 *
 * @param {{ teamSize:number, hoursLostPerWeek:number, hourlyCost:number, seatPrice:number }} input
 */
export function calculateRoi({ teamSize, hoursLostPerWeek, hourlyCost, seatPrice }, recoveryRate = 0.4) {
  const size = Math.max(0, teamSize)
  const WEEKS_PER_MONTH = 52 / 12
  const hoursSaved = size * hoursLostPerWeek * recoveryRate * WEEKS_PER_MONTH
  const valueSaved = hoursSaved * hourlyCost
  const cost = size * seatPrice
  const net = valueSaved - cost
  const roi = cost > 0 ? (net / cost) * 100 : null // null = infinite (free plan)

  return {
    hoursSaved: Math.round(hoursSaved),
    valueSaved: Math.round(valueSaved),
    cost: Math.round(cost),
    net: Math.round(net),
    roi: roi === null ? null : Math.round(roi),
  }
}

/** Recommends the cheapest plan that fits the team. */
export function recommendPlan(teamSize) {
  if (teamSize <= 5) return 'Starter'
  if (teamSize <= 50) return 'Pro'
  return 'Business'
}

const currencyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const numberFmt = new Intl.NumberFormat('en-US')

export const formatCurrency = (n) => currencyFmt.format(n)
export const formatNumber = (n) => numberFmt.format(n)
