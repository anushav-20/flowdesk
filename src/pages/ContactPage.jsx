import Icon from '@/components/ui/Icon'
import PageHeader from '@/components/ui/PageHeader'
import ContactForm from '@/features/contact/ContactForm'
import useDocumentMeta from '@/hooks/useDocumentMeta'
import './ContactPage.css'

const channels = [
  { icon: 'mail', title: 'Email', text: 'hello@flowdesk.example', note: 'Replies within 1 business day' },
  { icon: 'message', title: 'Live chat', text: 'Mon–Fri, 9am–6pm IST', note: 'Average response: 4 minutes' },
  { icon: 'pin', title: 'Office', text: 'Bengaluru, India', note: 'Remote-first team' },
]

export default function ContactPage() {
  useDocumentMeta({
    title: 'Contact',
    description: 'Talk to the FlowDesk team about pricing, support or partnerships.',
  })

  return (
    <>
      <PageHeader
        eyebrow="Contact"
        title="Let's talk"
        subtitle="Questions about plans, a demo for your team, or help with your workspace — we're here."
      />
      <section className="section section--tight">
        <div className="container contact-layout">
          <ContactForm />
          <aside className="contact-channels" aria-label="Other ways to reach us">
            {channels.map((c) => (
              <div key={c.title} className="contact-channel">
                <span className="contact-channel__icon" aria-hidden="true">
                  <Icon name={c.icon} size={22} />
                </span>
                <div>
                  <h2>{c.title}</h2>
                  <p>{c.text}</p>
                  <p className="contact-channel__note">{c.note}</p>
                </div>
              </div>
            ))}
          </aside>
        </div>
      </section>
    </>
  )
}
