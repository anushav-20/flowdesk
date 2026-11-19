import { Link } from 'react-router'
import { hero } from '@/data/content'
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import './Hero.css'

const columns = [
  { title: 'To do', color: '#f59e0b', cards: ['Draft launch email', 'User interviews'] },
  { title: 'In progress', color: '#6d5dfc', cards: ['Pricing page v2', 'API rate limits'] },
  { title: 'Done', color: '#12a37a', cards: ['Onboarding flow'] },
]

/** Pure-CSS product preview, so the hero needs no heavy image download. */
function ProductPreview() {
  return (
    <div
      className="preview"
      role="img"
      aria-label="Preview of the FlowDesk task board with three columns: To do, In progress and Done"
    >
      <div className="preview__bar" aria-hidden="true">
        <span />
        <span />
        <span />
        <p>Sprint 24 · Website relaunch</p>
      </div>
      <div className="preview__board" aria-hidden="true">
        {columns.map((col, i) => (
          <div className="preview__col" key={col.title} style={{ '--i': i }}>
            <p className="preview__col-title">
              <span style={{ background: col.color }} />
              {col.title}
            </p>
            {col.cards.map((card, j) => (
              <div className="preview__card" key={card} style={{ '--j': j }}>
                <p>{card}</p>
                <div className="preview__meta">
                  <span className="preview__avatar" style={{ background: col.color }} />
                  <span className="preview__line" />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="preview__float" aria-hidden="true">
        <Icon name="spark" size={18} />
        <div>
          <strong>AI summary</strong>
          <p>3 tasks due today · 1 blocked</p>
        </div>
      </div>
    </div>
  )
}

export default function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero__bg" aria-hidden="true">
        <span className="hero__blob hero__blob--1" />
        <span className="hero__blob hero__blob--2" />
        <span className="hero__grid" />
      </div>

      <div className="container hero__inner">
        <div className="hero__content">
          <Link to="/#features" className="hero__badge">
            <span className="hero__badge-dot" aria-hidden="true" />
            {hero.badge}
            <Icon name="arrowRight" size={14} />
          </Link>

          <h1 id="hero-title" className="hero__title">
            {hero.title} <span className="gradient-text">{hero.highlight}</span>
          </h1>

          <p className="hero__subtitle">{hero.subtitle}</p>

          <div className="hero__ctas">
            <Button to={hero.primaryCta.to} size="lg" icon="arrowRight" className="hero__primary">
              {hero.primaryCta.label}
            </Button>
            <Button to={hero.secondaryCta.to} size="lg" variant="secondary" iconLeft="board">
              {hero.secondaryCta.label}
            </Button>
          </div>
          <p className="hero__trust">
            <Icon name="check" size={16} strokeWidth={2.6} />
            {hero.trustNote}
          </p>

          <dl className="hero__stats">
            {hero.stats.map((s) => (
              <div key={s.label}>
                <dt>{s.label}</dt>
                <dd>{s.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="hero__visual">
          <ProductPreview />
        </div>
      </div>
    </section>
  )
}
