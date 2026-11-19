import { logger } from '../lib/util.js'

/**
 * Optional LLM layer for the AI assistant.
 * The assistant always computes a grounded answer from real workspace data first (shared/assistant.js).
 * If ANTHROPIC_API_KEY is set, a model rewrites that answer in natural language — it is told to use
 * ONLY the provided facts, so it can't invent tasks. Any failure falls back to the grounded answer.
 */
export async function polishWithLlm(config, question, grounded, { fetchImpl = fetch } = {}) {
  if (!config.llm.apiKey) return { ...grounded, source: 'rules' }
  const facts = [grounded.text, ...(grounded.items ?? []).map((i) => `- ${i.label}`)].join('\n')
  try {
    const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': config.llm.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.llm.model,
        max_tokens: 400,
        system:
          'You are FlowDesk, a project management assistant. Answer the user using ONLY the facts provided. ' +
          'Do not invent tasks, people, numbers or dates. Be concise and friendly. Use short bullet points for lists.',
        messages: [{ role: 'user', content: `Question: ${question}\n\nFacts from the workspace:\n${facts}` }],
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`LLM responded ${res.status}`)
    const data = await res.json()
    const text = data.content?.find((c) => c.type === 'text')?.text
    return text ? { ...grounded, text, items: grounded.items, source: 'llm' } : { ...grounded, source: 'rules' }
  } catch (err) {
    logger.warn('llm_fallback', { message: err.message })
    return { ...grounded, source: 'rules' }
  }
}
