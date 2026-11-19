import { testimonials } from '@/data/content'
import Card from '@/components/ui/Card'
import Icon from '@/components/ui/Icon'
import Reveal from '@/components/ui/Reveal'
import SectionHeading from '@/components/ui/SectionHeading'
import './Testimonials.css'

const initials = (name) =>
  name
    .split(' ')
    .map((n) => n[0])
    .join('')

export default function Testimonials() {
  return (
    <section className="section section--alt" aria-labelledby="testimonials-title">
      <div className="container">
        <SectionHeading id="testimonials-title" eyebrow="Testimonials" title="Teams love working in FlowDesk" />
        <div className="testimonials__grid">
          {testimonials.map((t, i) => (
            <Reveal key={t.name} delay={i * 120} direction="zoom">
              <Card as="figure" interactive className="testimonial">
                <Icon name="quote" size={30} className="testimonial__mark" />
                <blockquote>
                  <p>{t.quote}</p>
                </blockquote>
                <figcaption>
                  <span className="testimonial__avatar" aria-hidden="true">
                    {initials(t.name)}
                  </span>
                  <span>
                    <strong>{t.name}</strong>
                    <span className="testimonial__role">{t.role}</span>
                  </span>
                </figcaption>
              </Card>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
