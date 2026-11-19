import { compose, email, isChecked, maxLength, minLength, required } from '@/lib/validators'

export const MESSAGE_MAX = 1000

export const contactInitialValues = {
  name: '',
  email: '',
  company: '',
  teamSize: '',
  topic: 'sales',
  message: '',
  consent: false,
  website: '', // honeypot — hidden from humans, bots fill it in
}

export const contactSchema = {
  name: compose(required('Enter your name.'), minLength(2, 'Name must be at least 2 characters.'), maxLength(80)),
  email: compose(required('Enter your email address.'), email()),
  company: maxLength(100),
  teamSize: required('Choose your team size.'),
  topic: required('Choose a topic.'),
  message: compose(
    required('Tell us how we can help.'),
    minLength(20, 'Please write at least 20 characters so we can help properly.'),
    maxLength(MESSAGE_MAX),
  ),
  consent: isChecked('Please agree to be contacted about your enquiry.'),
}

/** Trim and normalise before sending — never send raw form input. */
export function toContactPayload(values) {
  return {
    name: values.name.trim(),
    email: values.email.trim().toLowerCase(),
    company: values.company.trim() || null,
    teamSize: values.teamSize,
    topic: values.topic,
    message: values.message.trim(),
  }
}
