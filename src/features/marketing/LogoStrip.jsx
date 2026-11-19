import { logos } from '@/data/content'
import './LogoStrip.css'

/** Infinite-scrolling marquee of (fictional) customer names. */
export default function LogoStrip() {
  return (
    <section className="logos" aria-label="Teams using FlowDesk">
      <div className="container">
        <p className="logos__title">Trusted by fast-moving teams</p>
        <div className="logos__viewport">
          <ul className="logos__track">
            {[...logos, ...logos].map((name, i) => (
              <li key={`${name}-${i}`} aria-hidden={i >= logos.length}>
                {name}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
