// dsh-boot-animation — the boot-screen template store (Host half).
//
// A "template" is a directory holding a template.json plus optional assets:
//
//   <root>/<id>/template.json      the animation, as pure data
//   <root>/<id>/assets/<file>      audio / images / video the template references
//   <root>/<id>/<entry>.html       an iframe template's own document (engine:'iframe')
//
// Two roots, in priority order:
//
//   1. the user's   <profile>/data/dsh-boot-animation/templates
//   2. the package  assets/templates
//
// The user root wins on a name collision, which is the same rule
// dsh-boot-suite uses and the reason it is stated here: a template the user
// edited must be the one that plays, and an installed package update must not
// silently take a customised template away. The user root is reached through
// `profileContext`, injected rather than read — see createTemplateStore.
//
// Everything this module serves has already passed validateTemplate(), and
// every path it hands back has already passed containment. A caller may
// therefore stream bytes without re-checking, which is what keeps the route
// handlers small: the rules live here, once.
//
// The API is SYNCHRONOUS on purpose. The index-inject table is collected
// synchronously — that is the one moment early enough to pre-empt the kernel's
// boot page — so the template data for the injection has to be readable
// without a promise. The route handlers are async anyway and call these same
// functions from inside their async bodies; the files involved are kilobytes.

import { readdirSync, readFileSync, statSync, realpathSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { validateTemplate, TEMPLATE_ID_RE } from './template-validate.js'

/** Package-owned templates, resolved from this module. */
const BUILTIN_ROOT = fileURLToPath(new URL('../assets/templates', import.meta.url))

/**
 * File extensions a template may reference from its assets/ directory.
 *
 * Audio, images and VIDEO — a timeline act can be a full-screen clip, which is
 * what whale-girl-scan is — plus the json a config-style template reads.
 * Deliberately NOT html/js/css: those belong to the template's own directory
 * and are served by the file route, which applies the iframe sandboxing rules
 * to them. Letting an asset path name an html file would let a template load a
 * second document outside the sandbox.
 */
export const ASSET_FILE_RE = /^[a-z0-9][a-z0-9._-]{0,60}\.(mp3|wav|ogg|m4a|aac|png|jpe?g|webp|gif|svg|json|mp4|webm)$/i

/**
 * File extensions an iframe template may serve from its own directory.
 *
 * The template is a small static site; fonts and its own documents belong here.
 * The entry document is additionally sandboxed by the frame route.
 */
export const TEMPLATE_FILE_EXT_RE = /\.(html|js|css|json|wav|mp3|ogg|m4a|aac|png|jpe?g|webp|gif|svg|mp4|webm|woff2?|ttf|txt)$/i

/** One path segment of a template-relative path: no separators, no traversal. */
const TEMPLATE_FILE_SEG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** MIME types the file route answers, by lower-case extension. */
export const TEMPLATE_FILE_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
}

/** Voice packs the package ships, read once from the vendored manifest. */
const VOICE_ROOT = fileURLToPath(new URL('../assets/splash/voices', import.meta.url))

const VOICE_PACKS = (() => {
  try {
    const list = JSON.parse(readFileSync(join(VOICE_ROOT, 'manifest.json'), 'utf8'))
    if (!Array.isArray(list)) return []
    return list
      .filter((entry) => entry && /^[a-z]$/.test(String(entry.id)) && (entry.lang === 'en' || entry.lang === 'ja'))
      .map((entry) => ({
        id: String(entry.id),
        name: String(entry.name || '').slice(0, 12) || ('音色 ' + String(entry.id).toUpperCase()),
        lang: entry.lang,
      }))
  } catch {
    return []
  }
})()

/** One capability token, minted for one iframe template document. */
const FRAME_TOKEN_TTL_MS = 10 * 60 * 1000
const FRAME_TOKEN_LIMIT = 200

/**
 * Whether a resolved path really sits inside a root.
 *
 * `startsWith` on the joined path is not enough: a symlink inside the tree can
 * point outside it, and a Windows path comparison is case-insensitive in a way
 * `startsWith` is not. Both sides are therefore realpath'd, and the comparison
 * is done on the lower-cased real paths. A path that cannot be realpath'd (it
 * does not exist) is rejected rather than waved through — the caller is about
 * to read it.
 * @param file - candidate path, already joined.
 * @param root - the root it must stay inside.
 * @returns true when the real path of `file` is the real `root` or below it.
 */
export function isFileInsideRoot(file, root) {
  try {
    const realRoot = realpathSync(root)
    const realFile = realpathSync(file)
    const prefix = realRoot.endsWith(sep) ? realRoot : realRoot + sep
    return realFile.toLowerCase() === realRoot.toLowerCase()
      || realFile.toLowerCase().startsWith(prefix.toLowerCase())
  } catch {
    return false
  }
}

/** Read and parse one template document from disk, or null when unreadable. */
function readTemplateFile(file) {
  try {
    const info = statSync(file)
    if (!info.isFile() || info.size > 16 * 1024 * 1024) return null
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

/** The engine a validated template runs under, for listings and the card. */
export function templateEngine(template) {
  if (template.engine === 'iframe') return 'iframe'
  if (Array.isArray(template.layers) && template.layers.length) return 'timeline'
  return 'steps'
}

/** The one-line summary the settings card and the manifest route publish. */
function summarize(id, template, source) {
  return {
    id,
    name: String(template.name || id).slice(0, 40),
    author: String(template.author || '').slice(0, 60),
    adaptedBy: String(template.adaptedBy || '').slice(0, 60),
    description: String(template.description || '').slice(0, 140),
    engine: templateEngine(template),
    source,
    license: String(template.license || '').slice(0, 40),
  }
}

/**
 * Create the store.
 *
 * The profile directory is optional and arrives through an injected owner: the
 * Host half cannot know at module-evaluation time whether this profile runs
 * with a profileContext at all (a link install in a profile that never mounted
 * one must not take the routes down with it), and reading it with `ctx.get`
 * would race activation — the same trap src/custom-clips.js documents.
 * @param ctx - Host plugin context.
 * @returns the store's public face.
 */
export function createTemplateStore(ctx) {
  let userRoot = ''

  if (typeof ctx?.inject === 'function') {
    ctx.inject(['profileContext'], (owner) => {
      const profile = owner?.get?.('profileContext')
      const dir = typeof profile?.dir === 'string' ? profile.dir : ''
      if (dir === '') return
      const root = resolve(dir, 'data', 'dsh-boot-animation', 'templates')
      userRoot = root
      owner.effect(() => () => { if (userRoot === root) userRoot = '' })
    })
  }

  /** Both roots, user first — the order IS the override rule. */
  function roots() {
    const out = []
    if (userRoot !== '') out.push({ root: userRoot, source: 'user' })
    out.push({ root: BUILTIN_ROOT, source: 'builtin' })
    return out
  }

  /**
   * Every template available, user copies overriding built-in ones.
   *
   * The walk is defensive per directory: one unreadable or invalid template is
   * skipped, because a settings dropdown that lists nothing is worse than one
   * that lists the good ones.
   * @returns summaries, sorted by id.
   */
  function listTemplates() {
    const seen = new Set()
    const out = []
    for (const { root, source } of roots()) {
      let entries = []
      try {
        entries = readdirSync(root, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || seen.has(entry.name) || !TEMPLATE_ID_RE.test(entry.name)) continue
        const raw = readTemplateFile(join(root, entry.name, 'template.json'))
        if (raw === null) continue
        const checked = validateTemplate({ ...raw, id: entry.name })
        if (!checked.ok) continue
        seen.add(entry.name)
        out.push(summarize(entry.name, checked.value, source))
      }
    }
    out.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    return out
  }

  /**
   * One validated template, or null when it does not exist.
   *
   * A template that exists but fails validation is treated as absent: the boot
   * screen then falls back rather than rendering something the store refused to
   * vouch for. `__root` and `__source` travel with the result for the store's
   * own asset routes; the injection strips them before the browser sees them.
   * @param id - template id.
   * @returns the template with its location, or null.
   */
  function readTemplate(id) {
    if (typeof id !== 'string' || !TEMPLATE_ID_RE.test(id)) return null
    for (const { root, source } of roots()) {
      const raw = readTemplateFile(join(root, id, 'template.json'))
      if (raw === null) continue
      const checked = validateTemplate({ ...raw, id })
      if (!checked.ok) continue
      return { ...checked.value, id, __root: join(root, id), __source: source }
    }
    return null
  }

  /**
   * Resolve one template asset to a readable file inside the template.
   * @param id - template id.
   * @param name - bare file name.
   * @returns `{ file, source }`, or null when it does not resolve inside assets/.
   */
  function resolveAsset(id, name) {
    if (typeof id !== 'string' || !TEMPLATE_ID_RE.test(id)) return null
    if (typeof name !== 'string' || !ASSET_FILE_RE.test(name) || name.includes('..')) return null
    for (const { root, source } of roots()) {
      const dir = join(root, id, 'assets')
      const file = join(dir, name)
      if (!isFileInsideRoot(file, dir)) continue
      try {
        if (!statSync(file).isFile()) continue
        return { file, source }
      } catch {
        continue
      }
    }
    return null
  }

  /**
   * Resolve one iframe template file to a readable file inside the template.
   *
   * Multi-segment relative paths are allowed (a template is a small site), each
   * segment individually whitelisted, with traversal and drive letters refused
   * before any join happens.
   * @param id - template id.
   * @param rel - relative path inside the template directory.
   * @returns `{ file, untrusted }`, or null.
   */
  function resolveTemplateFile(id, rel) {
    if (typeof id !== 'string' || !TEMPLATE_ID_RE.test(id)) return null
    if (typeof rel !== 'string' || rel === '' || rel.includes('..') || rel.includes(':')
      || rel.includes('\\') || rel.startsWith('/')) {
      return null
    }
    const segments = rel.split('/')
    if (!segments.every((segment) => TEMPLATE_FILE_SEG_RE.test(segment))) return null
    if (!TEMPLATE_FILE_EXT_RE.test(rel)) return null
    for (const { root, source } of roots()) {
      const dir = join(root, id)
      const file = join(dir, rel)
      if (!isFileInsideRoot(file, dir)) continue
      try {
        if (!statSync(file).isFile()) continue
        return { file, untrusted: source === 'user' }
      } catch {
        continue
      }
    }
    return null
  }

  // ── iframe capability tokens ────────────────────────────────────────────────
  //
  // An iframe template is a document this plugin did not write. Loading it
  // same-origin would hand it the user's session; loading it in a sandbox with
  // no same-origin flag means it cannot fetch its own assets. A short-lived
  // unguessable token is the bridge: the authenticated page mints one, the
  // frame route exchanges it for the template's static files, and the cookie
  // fence never applies to the frame. Tokens are minted per document load,
  // expire in ten minutes, and the table is capped — a leaked token buys ten
  // minutes of read access to one template's files and nothing else.

  const frameTokens = new Map()
  let frameTokenPruneAt = 0

  function pruneFrameTokens(now) {
    if (now < frameTokenPruneAt) return
    frameTokenPruneAt = now + 30000
    for (const [token, entry] of Array.from(frameTokens.entries())) {
      if (!entry || entry.expires <= now) frameTokens.delete(token)
    }
  }

  /**
   * Mint a capability token for one template.
   * @param id - template id.
   * @returns `{ token, expires, untrusted }`, or null when the template is absent.
   */
  function createFrameSession(id) {
    const template = readTemplate(id)
    if (template === null) return null
    const now = Date.now()
    pruneFrameTokens(now)
    while (frameTokens.size >= FRAME_TOKEN_LIMIT) {
      const oldest = frameTokens.keys().next()
      if (oldest.done) break
      frameTokens.delete(oldest.value)
    }
    const token = randomBytes(32).toString('hex')
    frameTokens.set(token, {
      id,
      root: template.__root,
      untrusted: template.__source === 'user',
      expires: now + FRAME_TOKEN_TTL_MS,
    })
    return { token, expires: now + FRAME_TOKEN_TTL_MS, untrusted: template.__source === 'user' }
  }

  /**
   * Look one token up without consuming it — the frame route reads it per file.
   * @param token - 64 hex characters.
   * @returns the entry, or null when unknown or expired.
   */
  function frameSession(token) {
    if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return null
    const entry = frameTokens.get(token)
    if (!entry) return null
    if (entry.expires <= Date.now()) {
      frameTokens.delete(token)
      return null
    }
    return entry
  }

  /** Drop every token — the plugin's own disposal path. */
  function clearFrameSessions() {
    frameTokens.clear()
  }

  return {
    listTemplates,
    readTemplate,
    resolveAsset,
    resolveTemplateFile,
    createFrameSession,
    frameSession,
    clearFrameSessions,
    voicePacks: VOICE_PACKS,
    builtinRoot: BUILTIN_ROOT,
    get userRoot() { return userRoot },
  }
}
