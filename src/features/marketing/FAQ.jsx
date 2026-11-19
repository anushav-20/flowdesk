import { faqs } from '@/data/content'
import Accordion from '@/components/ui/Accordion'
import Reveal from '@/components/ui/Reveal'
import SectionHeading from '@/components/ui/SectionHeading'
import './FAQ.css'

export default function FAQ() {
  return (
    <section id="faq" className="section section--alt" aria-labelledby="faq-title">
      <div className="container faq">
        <SectionHeading
          id="faq-title"
          eyebrow="FAQ"
          title="Questions? Answers."
          subtitle="Can't find what you're looking for? Our support team replies within a few hours."
          align="left"
        />
        <Reveal>
          <Accordion items={faqs} />
        </Reveal>
      </div>
    </section>
  )
}
