import { useId, useMemo, useState } from 'react'
import Icon from '@/components/ui/Icon'
import Reveal from '@/components/ui/Reveal'
import SectionHeading from '@/components/ui/SectionHeading'
import { plans } from '@/data/content'
import { selectBilling, useAppStore } from '@/store/appStore'
import BillingToggle from './BillingToggle'
import { calculateRoi, formatCurrency, formatNumber, pricePerSeat, recommendPlan } from './pricing'
import './RoiCalculator.css'

function Slider({ label, value, min, max, step = 1, format = (v) => v, onChange }) {
  const id = useId()
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className="slider">
      <div className="slider__head">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>{format(value)}</output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ '--fill': `${pct}%` }}
        aria-valuetext={String(format(value))}
      />
    </div>
  )
}

/** Interactive savings estimate. All maths lives in pricing.js (pure + unit-tested). */
export default function RoiCalculator() {
  const billing = useAppStore(selectBilling)
  const [teamSize, setTeamSize] = useState(12)
  const [hoursLost, setHoursLost] = useState(4)
  const [hourlyCost, setHourlyCost] = useState(30)

  const planName = recommendPlan(teamSize)
  const plan = plans.find((p) => p.name === planName)
  const seatPrice = pricePerSeat(plan, billing)

  const result = useMemo(
    () => calculateRoi({ teamSize, hoursLostPerWeek: hoursLost, hourlyCost, seatPrice }),
    [teamSize, hoursLost, hourlyCost, seatPrice],
  )

  return (
    <section id="roi" className="section section--alt" aria-labelledby="roi-title">
      <div className="container">
        <SectionHeading
          id="roi-title"
          eyebrow="ROI calculator"
          title="See what FlowDesk is worth to your team"
          subtitle="Move the sliders. We assume FlowDesk recovers about 40% of the time lost to status meetings, chasing updates and switching between tools."
        />
        <Reveal className="roi">
          <div className="roi__inputs">
            <Slider
              label="Team size"
              value={teamSize}
              min={1}
              max={200}
              onChange={setTeamSize}
              format={(v) => `${v} people`}
            />
            <Slider
              label="Hours lost per person, per week"
              value={hoursLost}
              min={1}
              max={15}
              onChange={setHoursLost}
              format={(v) => `${v} h`}
            />
            <Slider
              label="Average hourly cost"
              value={hourlyCost}
              min={5}
              max={150}
              step={5}
              onChange={setHourlyCost}
              format={(v) => formatCurrency(v)}
            />
            <div className="roi__billing">
              <span>Billing</span>
              <BillingToggle />
            </div>
          </div>

          <div className="roi__results" aria-live="polite">
            <p className="roi__plan">
              Recommended plan: <strong>{planName}</strong>
              <span>{seatPrice ? `${formatCurrency(seatPrice)} / user / month` : 'Free'}</span>
            </p>
            <dl className="roi__stats">
              <div>
                <dt>Hours saved / month</dt>
                <dd>{formatNumber(result.hoursSaved)}</dd>
              </div>
              <div>
                <dt>Value of time saved</dt>
                <dd>{formatCurrency(result.valueSaved)}</dd>
              </div>
              <div>
                <dt>FlowDesk cost / month</dt>
                <dd>{formatCurrency(result.cost)}</dd>
              </div>
              <div className="roi__highlight">
                <dt>Net monthly gain</dt>
                <dd>{formatCurrency(result.net)}</dd>
              </div>
            </dl>
            <p className="roi__roi">
              <Icon name="chart" size={20} />
              {result.roi === null ? (
                <span>Pure gain — the Starter plan is free.</span>
              ) : (
                <span>
                  Return on investment: <strong>{formatNumber(result.roi)}%</strong>
                </span>
              )}
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
