import { appActions, selectBilling, useAppStore } from '@/store/appStore'

const OPTIONS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
]

/** Monthly / yearly switch built on native radio inputs (arrow keys work out of the box). */
export default function BillingToggle({ discount = 17 }) {
  const billing = useAppStore(selectBilling)

  return (
    <fieldset className="billing-toggle">
      <legend className="sr-only">Billing period</legend>
      <span className="billing-toggle__pill" data-position={billing} aria-hidden="true" />
      {OPTIONS.map((o) => (
        <label key={o.value} className={billing === o.value ? 'is-active' : ''}>
          <input
            type="radio"
            name="billing"
            value={o.value}
            checked={billing === o.value}
            onChange={() => appActions.setBilling(o.value)}
          />
          {o.label}
          {o.value === 'yearly' && <span className="billing-toggle__save">-{discount}%</span>}
        </label>
      ))}
    </fieldset>
  )
}
