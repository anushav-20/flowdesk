import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithRouter } from '@/test/utils'
import ContactForm from './ContactForm'
import * as service from './contactService'

async function fillValidForm(user) {
  await user.type(screen.getByLabelText('Full name'), 'Anusha V')
  await user.type(screen.getByLabelText('Work email'), 'anusha@example.com')
  await user.selectOptions(screen.getByLabelText('Team size'), '6–20')
  await user.type(screen.getByLabelText('Message'), 'We would like a demo for our engineering team.')
  await user.click(screen.getByRole('checkbox'))
}

describe('ContactForm', () => {
  it('shows an error summary and focuses the first invalid field', async () => {
    const { user } = renderWithRouter(<ContactForm />)

    await user.click(screen.getByRole('button', { name: /send message/i }))

    expect(screen.getByRole('heading', { name: /there are 5 problems/i })).toBeInTheDocument()
    expect(screen.getByLabelText('Full name')).toHaveFocus()
    expect(screen.getByLabelText('Full name')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Full name')).toHaveAccessibleDescription(/enter your name/i)
  })

  it('validates a field on blur, then live while correcting it', async () => {
    const { user } = renderWithRouter(<ContactForm />)
    const emailInput = screen.getByLabelText('Work email')

    await user.type(emailInput, 'not-an-email')
    await user.tab()
    expect(screen.getByText(/enter a valid email/i)).toBeInTheDocument()

    await user.clear(emailInput)
    await user.type(emailInput, 'ok@example.com')
    expect(screen.queryByText(/enter a valid email/i)).not.toBeInTheDocument()
  })

  it('pre-selects the topic from the URL', () => {
    renderWithRouter(<ContactForm />, { route: '/contact?topic=support' })
    expect(screen.getByRole('radio', { name: 'Product support' })).toBeChecked()
  })

  it('submits normalised data and shows a success state', async () => {
    const send = vi.spyOn(service, 'sendContactMessage').mockResolvedValue({ ok: true })
    const { user } = renderWithRouter(<ContactForm />)

    await fillValidForm(user)
    await user.click(screen.getByRole('button', { name: /send message/i }))

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Thanks, Anusha!' })).toBeInTheDocument())
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Anusha V', email: 'anusha@example.com', topic: 'sales', company: null }),
      expect.objectContaining({ honeypot: '' }),
    )
  })

  it('shows a friendly error when sending fails', async () => {
    vi.spyOn(service, 'sendContactMessage').mockRejectedValue(new Error('offline'))
    const { user } = renderWithRouter(<ContactForm />)

    await fillValidForm(user)
    await user.click(screen.getByRole('button', { name: /send message/i }))

    expect(await screen.findByText(/couldn't send your message/i)).toBeInTheDocument()
  })
})

describe('sendContactMessage bot protection', () => {
  it('silently drops submissions with the honeypot filled', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(service.sendContactMessage({ topic: 'x', message: 'y' }, { honeypot: 'spam' })).resolves.toEqual({
      ok: true,
      id: null,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
