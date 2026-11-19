import { describe, expect, it } from 'vitest'
import { calculateRoi, pricePerSeat, recommendPlan, yearlyDiscountPercent } from './pricing'

const pro = { monthly: 12, yearly: 10 }

describe('pricing', () => {
  it('returns the seat price for the billing period', () => {
    expect(pricePerSeat(pro, 'monthly')).toBe(12)
    expect(pricePerSeat(pro, 'yearly')).toBe(10)
  })

  it('computes the yearly discount and handles free plans', () => {
    expect(yearlyDiscountPercent(pro)).toBe(17)
    expect(yearlyDiscountPercent({ monthly: 0, yearly: 0 })).toBe(0)
  })

  it('recommends a plan by team size', () => {
    expect(recommendPlan(3)).toBe('Starter')
    expect(recommendPlan(20)).toBe('Pro')
    expect(recommendPlan(120)).toBe('Business')
  })

  it('calculates ROI from hours recovered', () => {
    // 10 people × 5h × 40% × 52/12 weeks ≈ 86.7h → ×$30 = $2,600; cost 10 × $12 = $120
    const r = calculateRoi({ teamSize: 10, hoursLostPerWeek: 5, hourlyCost: 30, seatPrice: 12 })
    expect(r).toEqual({ hoursSaved: 87, valueSaved: 2600, cost: 120, net: 2480, roi: 2067 })
  })

  it('reports ROI as null (unbounded) for a free plan', () => {
    expect(calculateRoi({ teamSize: 3, hoursLostPerWeek: 2, hourlyCost: 20, seatPrice: 0 }).roi).toBeNull()
  })

  it('never returns negative hours for invalid team sizes', () => {
    expect(calculateRoi({ teamSize: -5, hoursLostPerWeek: 2, hourlyCost: 20, seatPrice: 10 }).hoursSaved).toBe(0)
  })
})
