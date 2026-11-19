import { useId, useState } from 'react'
import Icon from './Icon'
import './Accordion.css'

/**
 * Accessible accordion following the WAI-ARIA pattern:
 * button[aria-expanded][aria-controls] → region[aria-labelledby].
 * Only one item open at a time.
 */
export default function Accordion({ items }) {
  const [openIndex, setOpenIndex] = useState(0)
  const baseId = useId()

  return (
    <div className="accordion">
      {items.map((item, i) => {
        const isOpen = openIndex === i
        const buttonId = `${baseId}-btn-${i}`
        const panelId = `${baseId}-panel-${i}`

        return (
          <div key={item.q} className={`accordion__item ${isOpen ? 'is-open' : ''}`}>
            <h3 className="accordion__heading">
              <button
                id={buttonId}
                type="button"
                className="accordion__trigger"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setOpenIndex(isOpen ? -1 : i)}
              >
                <span>{item.q}</span>
                <Icon name="chevron" size={20} className="accordion__chevron" />
              </button>
            </h3>
            <div id={panelId} role="region" aria-labelledby={buttonId} className="accordion__panel" hidden={!isOpen}>
              <p>{item.a}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
