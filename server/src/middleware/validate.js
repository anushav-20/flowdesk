/** Parses req.body / req.query with a Zod schema; invalid input becomes a 422 via the error handler. */
export const body = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body ?? {})
  next()
}
export const query = (schema) => (req, _res, next) => {
  req.valid = { ...(req.valid ?? {}), query: schema.parse(req.query ?? {}) }
  next()
}
