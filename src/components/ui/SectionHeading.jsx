import Reveal from './Reveal'
import './SectionHeading.css'

/** Eyebrow + title + subtitle. `as` sets the heading level ('h1' on standalone pages). */
export default function SectionHeading({ id, eyebrow, title, subtitle, align = 'center', as: Heading = 'h2' }) {
  return (
    <Reveal className={`section-heading section-heading--${align}`}>
      {eyebrow && <p className="section-heading__eyebrow">{eyebrow}</p>}
      <Heading id={id} className="section-heading__title">
        {title}
      </Heading>
      {subtitle && <p className="section-heading__subtitle">{subtitle}</p>}
    </Reveal>
  )
}
