// dsh-boot-animation — structural validation for a boot-screen template.
//
// Ported from dsh-boot-suite (MIT, © LeeRolling / 沈宏宏), lib/security.js, with
// only the parts a template needs: `validateTemplate`, `sanitizeValue` and the
// shared regular expressions. The digest helpers are not ported — this package
// has no update chain to guard.
//
// A template is DATA, never code. The engine (assets/splash/splash.js) reads a
// template as plain JSON and renders it; nothing in a template is ever
// evaluated. That property is what makes third-party templates safe to run, and
// this module is where it is enforced: a template that arrives with a prototype
// key, a 40 MB string, or 10 000 nodes is rejected here rather than being
// trusted to behave once it reaches the browser.
//
// The bounds below are the upstream ones. They are deliberately generous enough
// for a real template (the shipped ones peak at 46 layers) and small enough that
// a hostile file cannot cost the Host unbounded time or memory: every check is a
// plain structural walk with an early exit, so a rejection costs at most one
// pass over the rejected document.

/** Template ids are lower-case, hyphenated, and short — they become path segments. */
export const TEMPLATE_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/

/** A template document may not exceed 16 MiB serialized. */
export const MAX_TEMPLATE_BYTES = 16 * 1024 * 1024

/** The entry document of an iframe template: one safe relative file name. */
export const TEMPLATE_ENTRY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/

const MAX_DEPTH = 10
const MAX_ARRAY_ITEMS = 256
const MAX_OBJECT_KEYS = 128
const MAX_STRING_LEN = 4000
const MAX_ABS_NUMBER = 1e7
const MAX_TOTAL_NODES = 20000
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * Walk one value, rejecting anything outside the structural bounds.
 *
 * Rejection is a returned reason, never a throw: a caller reading a directory of
 * templates must be able to skip the broken one and keep going.
 * @param value - the value to check.
 * @param depth - current nesting depth.
 * @param state - mutable node counter shared across the whole walk.
 * @returns `{ ok: true, value }` with the sanitized copy, or `{ ok: false, reason }`.
 */
function sanitizeValue(value, depth, state) {
  if (state.nodes++ > MAX_TOTAL_NODES) return { ok: false, reason: 'too-many-nodes' }
  if (depth > MAX_DEPTH) return { ok: false, reason: 'too-deep' }
  if (value === null) return { ok: true, value: null }
  const type = typeof value
  if (type === 'string') return { ok: true, value: value.replace(/\u0000/g, '').slice(0, MAX_STRING_LEN) }
  if (type === 'boolean') return { ok: true, value }
  if (type === 'number') {
    if (!Number.isFinite(value)) return { ok: false, reason: 'non-finite-number' }
    return { ok: true, value: Math.max(-MAX_ABS_NUMBER, Math.min(MAX_ABS_NUMBER, value)) }
  }
  if (type !== 'object') return { ok: false, reason: 'unsupported-type' }
  if (Array.isArray(value)) {
    const out = []
    const count = Math.min(value.length, MAX_ARRAY_ITEMS)
    for (let index = 0; index < count; index += 1) {
      const result = sanitizeValue(value[index], depth + 1, state)
      if (!result.ok) return result
      out.push(result.value)
    }
    return { ok: true, value: out }
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return { ok: false, reason: 'non-plain-object' }
  const keys = Object.keys(value)
  if (keys.length > MAX_OBJECT_KEYS) return { ok: false, reason: 'too-many-keys' }
  const out = {}
  for (const key of keys) {
    if (DANGEROUS_KEYS.has(key)) continue
    if (key.length > 100) return { ok: false, reason: 'key-too-long' }
    const result = sanitizeValue(value[key], depth + 1, state)
    if (!result.ok) return result
    out[key] = result.value
  }
  return { ok: true, value: out }
}

/**
 * Validate one template document.
 *
 * Called on every template the Host serves — built-in or user-supplied — before
 * its JSON reaches the injection table. A rejection means the template does not
 * exist as far as the plugin is concerned: the store then falls back to the next
 * candidate, and the boot screen keeps working.
 * @param raw - the parsed template.json.
 * @returns `{ ok: true, value }` with the sanitized template, or `{ ok: false, reason }`.
 */
export function validateTemplate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'not-object' }
  const id = String(raw.id || '').trim()
  if (!TEMPLATE_ID_RE.test(id)) return { ok: false, reason: 'bad-id' }
  let json = ''
  try {
    json = JSON.stringify(raw)
  } catch (error) {
    return { ok: false, reason: 'unserializable' }
  }
  if (json.length > MAX_TEMPLATE_BYTES) return { ok: false, reason: 'too-large' }
  const state = { nodes: 0 }
  const result = sanitizeValue(raw, 0, state)
  if (!result.ok) return result
  const out = result.value
  out.id = id
  if (Array.isArray(out.steps)) out.steps = out.steps.slice(0, 24)
  if (out.layers !== undefined) {
    if (!Array.isArray(out.layers)) return { ok: false, reason: 'bad-layers' }
    for (const layer of out.layers) {
      if (!layer || typeof layer !== 'object' || Array.isArray(layer)) return { ok: false, reason: 'bad-layer' }
      if (layer.type !== undefined && typeof layer.type !== 'string') return { ok: false, reason: 'bad-layer-type' }
    }
  }
  if (out.engine !== undefined && typeof out.engine !== 'string') return { ok: false, reason: 'bad-engine' }
  if (out.engine === 'iframe') {
    if (out.entry !== undefined && (typeof out.entry !== 'string' || !TEMPLATE_ENTRY_RE.test(out.entry))) {
      return { ok: false, reason: 'bad-entry' }
    }
  }
  return { ok: true, value: out }
}
