import { ZodError } from 'zod'
import { logger } from './util.js'

/** An error that is safe to show to the client. Anything else becomes a generic 500. */
export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

export const badRequest = (message, details) => new HttpError(422, 'validation', message, details)
export const notFound = (what = 'Resource') => new HttpError(404, 'not_found', `${what} not found.`)
export const forbidden = (message = "You don't have permission to do that.") => new HttpError(403, 'forbidden', message)
export const conflict = (code, message) => new HttpError(409, code, message)

/** Consistent JSON error responses: { error: { code, message, details? } }. Never leaks stack traces. */
export function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
    return res
      .status(422)
      .json({ error: { code: 'validation', message: details[0]?.message ?? 'Invalid input', details } })
  }
  if (err instanceof HttpError) {
    return res
      .status(err.status)
      .json({ error: { code: err.code, message: err.message, ...(err.details && { details: err.details }) } })
  }
  if (err?.type === 'entity.too.large')
    return res.status(413).json({ error: { code: 'too_large', message: 'Request body is too large.' } })
  if (err?.type === 'entity.parse.failed')
    return res.status(400).json({ error: { code: 'bad_json', message: 'Malformed JSON.' } })

  req.metrics?.recordError(req, err)
  logger.error('unhandled_error', { requestId: req.id, path: req.path, message: err?.message, stack: err?.stack })
  res
    .status(500)
    .json({ error: { code: 'internal', message: 'Something went wrong. Please try again.', requestId: req.id } })
}
