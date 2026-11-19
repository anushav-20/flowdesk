import { memo } from 'react'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import Icon from '@/components/ui/Icon'
import { appActions } from '@/store/appStore'
import { pricePerSeat } from './pricing'

function PricingCard({ plan, billing }) {
  const price = pricePerSeat(plan, billing)
  const headingId = `plan-${plan.name.toLowerCase()}`

  return (
    <Card as="article" highlight={plan.featured} className="plan" aria-labelledby={headingId}>
      {plan.featured && <p className="plan__badge">Most popular</p>}
      <h3 id={headingId} className="plan__name">
        {plan.name}
      </h3>
      <p className="plan__desc">{plan.description}</p>

      <p className="plan__price">
        <span className="plan__amount" key={`${plan.name}-${billing}`}>
          ${price}
        </span>
        <span className="plan__period">
          {price === 0 ? 'free forever' : `/ user / month${billing === 'yearly' ? ', billed yearly' : ''}`}
        </span>
      </p>

      <Button
        variant={plan.featured ? 'primary' : 'secondary'}
        fullWidth
        to={plan.name === 'Business' ? '/contact?topic=sales' : undefined}
        onClick={
          plan.name === 'Business'
            ? undefined
            : () => appActions.toast(`${plan.name} plan selected (${billing} billing). This is a demo!`)
        }
      >
        {plan.cta}
      </Button>

      <ul className="plan__features" aria-label={`${plan.name} plan includes`}>
        {plan.features.map((f) => (
          <li key={f}>
            <Icon name="check" size={18} strokeWidth={2.4} />
            {f}
          </li>
        ))}
      </ul>
    </Card>
  )
}

export default memo(PricingCard)
