import { Fragment } from 'react'
import Icon from '@/components/ui/Icon'
import Reveal from '@/components/ui/Reveal'
import SectionHeading from '@/components/ui/SectionHeading'
import { comparison } from '@/data/content'
import './ComparisonTable.css'

function Cell({ value }) {
  if (value === true) {
    return (
      <>
        <Icon name="check" size={18} strokeWidth={2.6} className="compare__yes" />
        <span className="sr-only">Included</span>
      </>
    )
  }
  if (value === false) {
    return (
      <>
        <span aria-hidden="true" className="compare__no">
          –
        </span>
        <span className="sr-only">Not included</span>
      </>
    )
  }
  return value
}

/** Semantic, accessible table (caption, scoped headers, row groups) that scrolls horizontally on small screens. */
export default function ComparisonTable() {
  return (
    <section id="compare" className="section" aria-labelledby="compare-title">
      <div className="container">
        <SectionHeading id="compare-title" eyebrow="Compare" title="Every feature, side by side" />
        <Reveal className="compare" tabIndex={0} role="region" aria-label="Plan comparison table, scrollable">
          <table>
            <caption className="sr-only">Feature comparison of the Starter, Pro and Business plans</caption>
            <thead>
              <tr>
                <th scope="col">Feature</th>
                {comparison.plans.map((p) => (
                  <th scope="col" key={p}>
                    {p}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {comparison.groups.map((group) => (
                <Fragment key={group.name}>
                  <tr className="compare__group">
                    <th scope="colgroup" colSpan={comparison.plans.length + 1}>
                      {group.name}
                    </th>
                  </tr>
                  {group.rows.map((row) => (
                    <tr key={row.feature}>
                      <th scope="row">{row.feature}</th>
                      {row.values.map((v, i) => (
                        <td key={comparison.plans[i]}>
                          <Cell value={v} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </Reveal>
      </div>
    </section>
  )
}
