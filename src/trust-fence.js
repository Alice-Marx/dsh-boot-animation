// dsh-boot-animation — the browser trust fence for this plugin's own routes.
//
// Ported from dsh-boot-suite (MIT, © LeeRolling / 沈宏宏), lib/security.js's
// `guardDecision`, plus the small request wrapper that applies it.
//
// DSH's `connection` service answers `requestRejection(req)` with a status code
// when a request did not come from an authenticated page on this origin, and
// with nothing when it did. A custom route that reads or writes user data —
// template files from the profile directory, capability tokens — must ask
// first: without the fence such a route is readable by any page the user
// visits.
//
// The rule is FAIL-CLOSED, and that is the whole point of this module: a guard
// that throws, a connection service that is not there, or an answer that is
// neither a status nor a clear pass all reject. "Open when in doubt" is the
// behaviour that turns a decorative plugin into an exfiltration endpoint. The
// cost of failing closed is bounded and known: the template animation plays
// without its user-supplied media, and the boot screen still hands over.

/**
 * Decide one `requestRejection` answer.
 *
 * Fail-closed by construction — see the module header. Only an explicit
 * "no rejection" (undefined, null, false) lets a request through.
 * @param code - what requestRejection answered, when it answered at all.
 * @param error - the error it threw, if it threw.
 * @returns `{ reject, status, reason }`.
 */
export function guardDecision(code, error) {
  if (error) return { reject: true, status: 403, reason: 'guard-error' }
  if (code === undefined || code === null || code === false) return { reject: false }
  if (typeof code === 'number' && Number.isInteger(code) && code >= 100 && code <= 599) {
    return { reject: true, status: code, reason: code === 401 ? 'unauthorized' : 'request-rejected' }
  }
  return { reject: true, status: 403, reason: 'request-rejected' }
}

/**
 * Answer one JSON refusal.
 *
 * The body names the reason in the plugin's own user-facing language, because
 * the settings card surfaces it verbatim.
 * @param res - outgoing response.
 * @param status - HTTP status.
 * @param reason - machine-readable reason, for the log line.
 */
export function sendRejection(res, status, reason) {
  const message = status === 401
    ? '请在已登录的 DSH 页面中操作。'
    : '这个请求没有被放行。'
  const body = Buffer.from(JSON.stringify({ ok: false, error: message, reason }), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.byteLength),
    'cache-control': 'no-store',
  })
  res.end(body)
}

/**
 * Apply the fence to one request.
 *
 * A missing guard is a rejection, not a pass: the caller asked for a fenced
 * route, so the fence not being available must not silently open it.
 * @param req - incoming request.
 * @param res - outgoing response, written to when the request is rejected.
 * @param guard - `{ connection }` with a live connection service, or null.
 * @returns true when the request was rejected and the response already sent.
 */
export function rejected(req, res, guard) {
  if (!guard || typeof guard.connection?.requestRejection !== 'function') {
    sendRejection(res, 503, 'guard-unavailable')
    return true
  }
  let code = null
  let failure = null
  try {
    code = guard.connection.requestRejection(req)
  } catch (error) {
    failure = error
  }
  const decision = guardDecision(failure ? null : code, failure)
  if (!decision.reject) return false
  sendRejection(res, decision.status, decision.reason)
  return true
}
