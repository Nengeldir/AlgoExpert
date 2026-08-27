import type { FastifyInstance } from 'fastify'

/**
 * Accept a parameter-less POST however a scheduler chooses to phrase it.
 *
 * cron-job.org (and similar) send an unpredictable Content-Type on a POST with no body —
 * `application/json`, `application/x-www-form-urlencoded`, or none at all. Fastify 415s on
 * a content type it has no parser for, and its *built-in* JSON parser rejects an empty body
 * outright with FST_ERR_CTP_EMPTY_JSON_BODY. Either way the cron job fails silently: the
 * scheduler logs a 4xx that nobody reads and the tick never runs.
 *
 * So: treat an empty body as `{}` for every content type, and only attempt to JSON-parse a
 * non-empty one. The wildcard alone is not enough — `application/json` has to be registered
 * explicitly, because the built-in parser takes precedence over `'*'`.
 *
 * Registered from one place so the test app and the real app cannot drift; a bug here is
 * invisible to `app.inject()` unless the tests run through the same parsers.
 */
export function registerContentTypeParsers(app: FastifyInstance): void {
  const parseMaybeEmpty = (
    _request: unknown,
    body: string,
    done: (err: Error | null, result?: unknown) => void,
  ) => {
    if (body.trim() === '') {
      done(null, {})
      return
    }
    try {
      done(null, JSON.parse(body))
    } catch {
      // Mark it a client error explicitly. A bare Error out of a content-type parser
      // becomes a 500, which would blame the server for a malformed request body — and
      // hide a genuine 500 among them in the logs.
      const err = new Error('Body is not valid JSON.') as Error & { statusCode?: number }
      err.statusCode = 400
      done(err, undefined)
    }
  }

  app.addContentTypeParser('*', { parseAs: 'string' }, parseMaybeEmpty)
  app.addContentTypeParser('application/json', { parseAs: 'string' }, parseMaybeEmpty)
}
