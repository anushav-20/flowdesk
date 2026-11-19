import { features } from '@/data/content'
import Card from '@/components/ui/Card'
import Icon from '@/components/ui/Icon'
import Reveal from '@/components/ui/Reveal'
import SectionHeading from '@/components/ui/SectionHeading'
import './Features.css'

function FeatureCard({ icon, title, text }) {
  return (
    <Card as="article" interactive className="feature">
      <span className="feature__icon">
        <Icon name={icon} size={24} />
      </span>
      <h3 className="feature__title">{title}</h3>
      <p className="feature__text">{text}</p>
    </Card>
  )
}

export default function Features() {
  return (
    <section id="features" className="section" aria-labelledby="features-title">
      <div className="container">
        <SectionHeading
          id="features-title"
          eyebrow="Features"
          title="Everything your team needs, nothing it doesn't"
          subtitle="Powerful building blocks that stay out of your way, so you can focus on the work that matters."
        />
        <ul className="features__grid">
          {features.map((f, i) => (
            <Reveal as="li" key={f.title} delay={(i % 3) * 100}>
              <FeatureCard {...f} />
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  )
}
