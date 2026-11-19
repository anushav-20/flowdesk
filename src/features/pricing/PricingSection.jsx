import { Link } from 'react-router'
import Reveal from '@/components/ui/Reveal'
import SectionHeading from '@/components/ui/SectionHeading'
import { plans } from '@/data/content'
import { selectBilling, useAppStore } from '@/store/appStore'
import BillingToggle from './BillingToggle'
import PricingCard from './PricingCard'
import { yearlyDiscountPercent } from './pricing'
import './Pricing.css'

const maxDiscount = Math.max(...plans.map(yearlyDiscountPercent))

export default function PricingSection({
  id = 'pricing',
  headingLevel = 'h2',
  eyebrow = 'Pricing',
  title = 'Simple pricing that grows with you',
  showCompareLink = false,
}) {
  const billing = useAppStore(selectBilling)

  return (
    <section id={id} className="section" aria-labelledby={`${id}-title`}>
      <div className="container">
        <SectionHeading
          id={`${id}-title`}
          as={headingLevel}
          eyebrow={eyebrow}
          title={title}
          subtitle="Start free. Upgrade when your team is ready. Cancel anytime."
        />
        <Reveal className="pricing__toggle-wrap">
          <BillingToggle discount={maxDiscount} />
        </Reveal>
        <div className="pricing__grid">
          {plans.map((plan, i) => (
            <Reveal key={plan.name} delay={i * 120}>
              <PricingCard plan={plan} billing={billing} />
            </Reveal>
          ))}
        </div>
        {showCompareLink && (
          <p className="pricing__compare-link">
            Not sure which plan fits? <Link to="/pricing#compare">Compare every feature</Link> or{' '}
            <Link to="/pricing#roi">calculate your ROI</Link>.
          </p>
        )}
      </div>
    </section>
  )
}
