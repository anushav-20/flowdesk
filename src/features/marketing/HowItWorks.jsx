import { steps } from '@/data/content'
import Reveal from '@/components/ui/Reveal'
import SectionHeading from '@/components/ui/SectionHeading'
import './HowItWorks.css'

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="section section--alt" aria-labelledby="how-title">
      <div className="container">
        <SectionHeading
          id="how-title"
          eyebrow="How it works"
          title="Up and running in three steps"
          subtitle="No training sessions, no complicated setup. Most teams are productive on day one."
        />
        <ol className="steps">
          {steps.map((step, i) => (
            <Reveal as="li" className="step" key={step.title} delay={i * 140}>
              <span className="step__number" aria-hidden="true">
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3 className="step__title">{step.title}</h3>
              <p className="step__text">{step.text}</p>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  )
}
