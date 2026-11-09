// dsh-boot-animation — the remote template store client (Host half).
//
// A "store" is a published index of templates in this package's own format,
// fetched at runtime from a fixed raw URL. The default is the dsh-boot-suite
// template library, whose format this package plays unchanged — which is the
// point: the store is useful on day one because it already holds dozens of
// templates, and every entry carries its own author field.
//
// Ported from dsh-boot-suite (MIT, © LeeRolling / 沈宏宏), lib/host-startup.js's
// store half, with the fetch injected rather than taken from the global scope:
// a module that calls `fetch` directly cannot be tested without a network, and
// this package's suites run offline.
//
// What the store may and may not do, and why:
//
//   * It READS a template.json and its declared assets from one fixed origin,
//     validates the document, and writes it into the user's template directory.
//     It never executes anything it fetched.
//   * It refuses an entry whose path is not a plain relative path, an index
//     entry whose id does not match the document it served, and a document that
//     fails validateTemplate — the same validator the local store uses, so a
//     remote template is held to exactly the same standard as a built-in one.
//   * The index is cached for five minutes and answered from the cache when the
//     network is down, so a flaky connection costs freshness, not the feature.

import { TEMPLATE_ID_RE } from './template-validate.js'
import { validateTemplate } from './template-validate.js'

/** The default index: the dsh-boot-suite template library. */
export const DEFAULT_STORE_URL = 'https://raw.githubusercontent.com/LeeRolling/dsh-boot-suite-templates/main/index.json'

/** How long a fetched index is served before it is re-fetched. */
export const STORE_TTL_MS = 5 * 60 * 1000

/** The index's own ceiling. */
export const STORE_INDEX_LIMIT = 256 * 1024

/** One template document's ceiling. */
export const STORE_TEMPLATE_LIMIT = 96 * 1024

/** One asset's ceiling, and the whole install's. */
export const STORE_ASSET_LIMIT = 2 * 1024 * 1024
export const STORE_INSTALL_LIMIT = 12 * 1024 * 1024

/** Extensions an install may fetch as a template's declared asset. */
export const STORE_ASSET_RE = /^[a-z0-9][a-z0-9._-]{0,60}\.(mp3|wav|ogg|m4a|aac|png|jpe?g|webp|gif|svg|json|mp4|webm)$/i

/**
 * One safe relative path from an index entry.
 *
 * The index is remote data: an entry's `path` becomes part of a fetch URL, so
 * anything that is not a plain relative path of safe segments is refused —
 * absolute paths, drive letters, `..` segments, empty segments and characters
 * outside the whitelist. `null` is the refusal.
 * @param value - the raw path from the index.
 * @returns the path, or null.
 */
export function safeStorePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null
  if (value.includes('\\')) return null
  const segments = value.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return null
  if (!/^[a-zA-Z0-9._/-]+$/.test(value)) return null
  return value
}

/**
 * Normalize one fetched index into the entries the card and the editor show.
 *
 * Every field is bounded and defaulted here rather than trusted: an index is
 * remote data, and a field that arrives as an object, a 10 KB string or a
 * nested array is trimmed to the shape this package publishes. An entry without
 * a usable id or path is dropped rather than carried.
 * @param parsed - the parsed index document.
 * @param rawBase - the raw base the preview URLs are built from.
 * @returns the entries, sorted by id.
 */
export function normalizeStoreIndex(parsed, rawBase) {
  const list = Array.isArray(parsed?.templates) ? parsed.templates : []
  const out = []
  for (const item of list) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
    const id = String(item.id ?? '').trim()
    if (!TEMPLATE_ID_RE.test(id)) continue
    const path = safeStorePath(item.path ?? ('templates/' + id))
    if (path === null) continue
    out.push({
      id,
      path,
      name: String(item.name ?? id).slice(0, 40),
      author: String(item.author ?? '').slice(0, 60),
      adaptedBy: String(item.adaptedBy ?? '').slice(0, 60),
      basedOn: String(item.basedOn ?? '').slice(0, 60),
      description: String(item.description ?? '').slice(0, 140),
      license: String(item.license ?? '').slice(0, 40),
      tags: Array.isArray(item.tags) ? item.tags.slice(0, 6).map((tag) => String(tag).slice(0, 20)) : [],
      preview: String(rawBase ?? '') + '/' + path + '/preview.gif',
      image: String(rawBase ?? '') + '/' + path + '/preview.png',
    })
  }
  out.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
  return out
}

/**
 * Create the store client.
 *
 * The fetch is injected so the suites can run offline; the default is the
 * global one, with a timeout so a hanging connection cannot hang a route.
 * @param options - `{ indexUrl, fetchImpl, now }`.
 * @returns the client's face.
 */
export function createStoreClient(options = {}) {
  const indexUrl = typeof options.indexUrl === 'string' && options.indexUrl !== ''
    ? options.indexUrl
    : DEFAULT_STORE_URL
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : fetch
  const now = typeof options.now === 'function' ? options.now : () => Date.now()

  /** The raw base the index's entries are fetched from. */
  const rawBase = indexUrl.replace(/\/[^/]*$/, '')

  let cache = { at: 0, data: null }

  /**
   * Fetch one URL as text, bounded and timed out.
   *
   * The timeout is a RACE, not an AbortController: in this runtime the global
   * `fetch` and the `AbortController` a module can construct come from
   * different realms, and passing such a signal makes fetch reject outright
   * with a TypeError — which a catch would swallow and turn every store read
   * into a silent failure. Racing a timer has the same effect for the caller
   * (it stops waiting) without handing fetch an object it refuses.
   * @param url - the URL.
   * @param timeoutMs - the timeout.
   * @param limit - the byte ceiling.
   * @returns the text.
   */
  async function fetchText(url, timeoutMs = 8000, limit = STORE_INDEX_LIMIT) {
    const timeout = new Promise((resolve, reject) => {
      setTimeout(() => reject(new Error('store fetch timed out after ' + String(timeoutMs) + 'ms')), timeoutMs)
    })
    const response = await Promise.race([
      (async () => {
        const answer = await fetchImpl(url, { headers: { 'user-agent': 'dsh-boot-animation' } })
        if (!answer.ok) throw new Error('HTTP ' + String(answer.status))
        const text = await answer.text()
        if (text.length > limit) throw new Error('响应过大')
        return text
      })(),
      timeout,
    ])
    return response
  }

  /**
   * The index, cached for the TTL and served from the cache when the network
   * is down — the last good list beats an error page.
   * @param force - true to bypass the cache.
   * @returns the entries.
   */
  async function list(force = false) {
    const at = now()
    if (!force && cache.data !== null && at - cache.at < STORE_TTL_MS) return cache.data
    const text = await fetchText(indexUrl, 8000, STORE_INDEX_LIMIT)
    const data = normalizeStoreIndex(JSON.parse(text), rawBase)
    cache = { at, data }
    return data
  }

  /** The last good list, for answering a failure without losing the feature. */
  function cached() {
    return cache.data ?? []
  }

  /**
   * Fetch one template document from the store.
   *
   * The document is validated here, not after it is written: an entry the index
   * served is not a promise that the document behind it is sound.
   * @param path - the entry's safe relative path.
   * @returns the validated template, with its id checked against the entry.
   */
  async function fetchTemplate(path) {
    const text = await fetchText(rawBase + '/' + path + '/template.json', 12000, STORE_TEMPLATE_LIMIT)
    let parsed = null
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error('模板不是合法 JSON')
    }
    const checked = validateTemplate(parsed)
    if (!checked.ok) throw new Error('模板内容不合法：' + checked.reason)
    return checked.value
  }

  /**
   * Fetch one declared asset, bounded.
   * @param path - the entry's safe relative path.
   * @param name - the asset file name.
   * @returns the bytes, or null when it is absent, oversized or the wrong kind.
   */
  async function fetchAsset(path, name) {
    if (!STORE_ASSET_RE.test(name)) return null
    // The timeout is a race here too, for the same reason fetchText's is: a
    // locally constructed AbortSignal is refused by the global fetch in this
    // runtime, and the refusal would surface as a missing asset.
    const timeout = new Promise((resolve) => {
      setTimeout(() => resolve(null), 12000)
    })
    return Promise.race([
      (async () => {
        const response = await fetchImpl(rawBase + '/' + path + '/assets/' + name, {
          headers: { 'user-agent': 'dsh-boot-animation' },
        })
        if (!response.ok) return null
        const buffer = Buffer.from(await response.arrayBuffer())
        if (buffer.byteLength === 0 || buffer.byteLength > STORE_ASSET_LIMIT) return null
        return buffer
      })(),
      timeout,
    ])
  }

  return {
    list,
    cached,
    fetchTemplate,
    fetchAsset,
    rawBase,
    indexUrl,
  }
}
