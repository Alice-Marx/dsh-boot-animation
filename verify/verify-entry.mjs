// Offline verification for the dsh-boot-animation Host half after the
// DSH 0.2.0-rc.2 port. No DSH process, no ports, no network, no prompts.
//
// Run from the package root that holds the ported entry.js:
//   node verify/verify-entry.mjs
//
// The suite re-implements, verbatim, the three predicates the kernel applies to
// a plugin Config — `volatileForm()` and `isVolatilePath()` from
// @deepseek-ai/dsh-settings, and `plainConfig()`'s reference unwrapping — so a
// schema the settings service would silently drop, or a config shape the plugin
// would silently misread, is caught here instead of in the browser.

import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import z from '@deepseek-ai/schemastery'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

let failures = 0
let checks = 0

function check(label, condition, detail) {
  checks++
  console.log((condition ? '  ok   ' : '  FAIL ') + label
    + (detail === undefined || detail === '' ? '' : '   [' + detail + ']'))
  if (!condition) failures++
  return condition
}

function equal(label, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  return check(label, a === e, a === e ? a : 'actual ' + a + ' != expected ' + e)
}

/** Strip line and block comments, so prose about an old approach is not matched as the approach. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

// cosmokit's protocol key, as @deepseek-ai/cosmokit/src/volatile.ts declares it.
const VOLATILE_REF = Symbol.for('cosmokit.volatile.write')
const isLive = (value) => typeof value === 'object' && value !== null && VOLATILE_REF in value

/** Verbatim re-implementation of dsh-settings lib/index.js:97-101 `plainConfig`. */
function plainConfig(value) {
  if (isLive(value)) return plainConfig(value.get())
  if (Array.isArray(value)) return value.map(plainConfig)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, plainConfig(child)]))
  }
  return value
}

// ---------------------------------------------------------------------------
// 0. Fixtures the staged package needs to behave like the real one.
// ---------------------------------------------------------------------------

const bootScreenSource = readFileSync(join(root, 'src', 'boot-screen.js'), 'utf8')

const FIXTURE = 'verify-fixture.mp4'

// The module under test is imported from a SCRATCH MIRROR of the package, not
// from the package itself, and the fixture is the only clip in that mirror's
// pool.
//
// This is not tidiness. The first version wrote the fixture into the real
// `assets/videos/` and then asserted on `clips[0]` and `clips.length`. That
// passes only where the pool is empty — which is true of a staging copy and
// false of the deployment, whose three real clips are what the manifest is for
// and which sort ahead of the fixture. A suite that has to be run in a tree
// without media is a defect in the suite, and this one also has no business
// writing into the user's clip directory.
//
// The scratch copy is complete (entry.js, package.json, src/, node_modules/),
// so it exercises the same module resolution the deployment does; `assets/` is
// left to the fixture because the pool is the one thing that must be fixed.
//
// The template form's built-in templates come along for the same reason the
// module does: `templateRows()` resolves them from the scratch tree's own
// assets/templates, and a mirror without them would fall back to the clip
// screen on every assertion in [4c] — a suite that passes for the wrong reason.
// Only the two templates the suite names are copied; the rest of the pool is
// several megabytes of media this suite has no business moving.
const scratch = join(root, '.verify-entry')
rmSync(scratch, { recursive: true, force: true })
mkdirSync(join(scratch, 'node_modules', '@deepseek-ai'), { recursive: true })
cpSync(join(root, 'entry.js'), join(scratch, 'entry.js'))
cpSync(join(root, 'package.json'), join(scratch, 'package.json'))
cpSync(join(root, 'src'), join(scratch, 'src'), { recursive: true })
for (const name of ['archive-warm', 'deep-sonar']) {
  cpSync(join(root, 'assets', 'templates', name),
    join(scratch, 'assets', 'templates', name), { recursive: true, dereference: true })
}
for (const name of ['schemastery', 'cosmokit']) {
  // `dereference: true`: an installed package's node_modules entries are symlinks,
  // and a scratch tree that keeps the link is not a copy — it is the real library
  // behind a new path. See verify-degraded.mjs, where that once edited the
  // installed schemastery.
  cpSync(join(root, 'node_modules', '@deepseek-ai', name),
    join(scratch, 'node_modules', '@deepseek-ai', name), { recursive: true, dereference: true })
}

const clipDir = join(scratch, 'assets', 'videos')
mkdirSync(clipDir, { recursive: true })
const fixtureClip = join(clipDir, FIXTURE)
// ftyp box (20 bytes) followed by an empty moov box: readFaststart() must answer
// true for this, which is what the manifest publishes as `faststart`.
writeFileSync(fixtureClip, Buffer.concat([
  Buffer.from([0, 0, 0, 20]), Buffer.from('ftyp', 'latin1'),
  Buffer.from('isom', 'latin1'), Buffer.from([0, 0, 0, 0]), Buffer.from('isom', 'latin1'),
  Buffer.from([0, 0, 0, 8]), Buffer.from('moov', 'latin1'),
]))

// ---------------------------------------------------------------------------
// 1. The module evaluates and exports the shape RegistryService.plugin() reads.
// ---------------------------------------------------------------------------

console.log('\n[1] module shape')
const mod = await import(new URL('.verify-entry/entry.js', new URL('../', import.meta.url)).href)
equal('exported names', Object.keys(mod).sort(), ['Config', 'apply', 'inject', 'name'])
equal('name', mod.name, 'dsh-boot-animation')
equal('inject (no settings service)', mod.inject, ['webServer'])
check('apply is a function', typeof mod.apply === 'function', 'typeof ' + typeof mod.apply)
check('Config has toJSON (dsh-settings schema() gate)', 'toJSON' in mod.Config)
check('Config has ~standard (cordis resolveConfig gate)', typeof mod.Config['~standard'] === 'object')
check('Config is callable', typeof mod.Config === 'function')

const Config = mod.Config

// ---------------------------------------------------------------------------
// 2. The schema is real schemastery with the seven fields and the old defaults.
// ---------------------------------------------------------------------------

console.log('\n[2] Config schema')
equal('field order', Object.keys(Config.dict),
  ['enabled', 'fadeMs', 'enterMode', 'disabledClips', 'sound', 'clickToEnter', 'showHint',
    'form', 'template', 'template2', 'tpl'])
const DEFAULTS = {
  enabled: true, fadeMs: 2000, enterMode: 'tail', disabledClips: [],
  sound: true, clickToEnter: false, showHint: true,
  form: 'video', template: 'archive-warm', template2: '',
  tpl: {
    speed: 1, theme: 'light', mode: 'session', requireInteraction: true, allowSkip: true,
    sound: true, soundVolume: 0.5, voice: true, voiceLang: 'en', voicePack: 'f', voiceFx: 'robot',
    voiceRate: 0.88, voicePitch: 0.85, voiceVolume: 0.9, voiceCue: true, voiceLead: 240,
    identity: 'JOYCE MOORE', identityId: '0087', accessLevel: '3',
    accent: '#ff7500', glitchA: '#ff3b30', glitchB: '#2971b8',
    transitionIn: 'dissolve', transitionJoin: 'dissolve', transitionOut: 'dissolve',
    transitionMs: 600, transitionDir: 'left',
    glass: false, glassOpacity: 0.75, glassBlur: 22, glassSaturate: 160, glassBackdropBlur: 28,
    bgmEnabled: false, bgmLoop: true, bgmFile: '', bgmFile2: '', bgmVolume: 0.5,
    bgmBpm: 100, bgmBeats1: 16, bgmBeats2: 32, bgm1Start: 0, bgm2Start: 0,
    bgm1FadeIn: 1, bgm1FadeOut: 1, bgm2FadeIn: 1, bgm2FadeOut: 2, bgmCrossfade: 1200,
    bgm2Loop: false, bgmDuck: true,
  },
}

/** The same defaults as they reach the injected row (no `enabled`, no pool). */
const INJECTED_DEFAULTS = {
  base: '/plugins/dsh-boot-animation',
  manifest: '/plugins/dsh-boot-animation/clips.json',
  holdMs: 15000,
  fadeMs: 2000,
  enterMode: 'tail',
  sound: true,
  clickToEnter: false,
  showHint: true,
}
equal('defaults for {}', plainConfig(Config({})), DEFAULTS)
equal('defaults for undefined (absent settings document)', plainConfig(Config(undefined)), DEFAULTS)
equal('defaults via ~standard.validate (the path cordis uses)',
  plainConfig(Config['~standard'].validate({}).value), DEFAULTS)

function rejects(label, value) {
  let issue = null
  try { Config(value) } catch (error) { issue = error.message }
  check(label, issue !== null, issue === null ? 'ACCEPTED' : String(issue).split('\n')[0])
}
function accepts(label, value) {
  let issue = null
  try { Config(value) } catch (error) { issue = error.message }
  check(label, issue === null, issue === null ? '' : String(issue).split('\n')[0])
}

rejects('fadeMs 100 rejected', { fadeMs: 100 })
rejects('fadeMs 5001 rejected', { fadeMs: 5001 })
rejects('fadeMs "2000" rejected', { fadeMs: '2000' })
accepts('fadeMs 300 accepted (lower bound)', { fadeMs: 300 })
accepts('fadeMs 5000 accepted (upper bound)', { fadeMs: 5000 })
rejects('enterMode "nope" rejected', { enterMode: 'nope' })
for (const mode of ['tail', 'end', 'click']) accepts('enterMode "' + mode + '" accepted', { enterMode: mode })
rejects('enabled "yes" rejected', { enabled: 'yes' })
rejects('disabledClips "a.mp4" rejected', { disabledClips: 'a.mp4' })
accepts('disabledClips ["a.mp4"] accepted', { disabledClips: ['a.mp4'] })
rejects('sound "no" rejected', { sound: 'no' })
accepts('sound false accepted (the silence switch)', { sound: false })
rejects('clickToEnter 1 rejected', { clickToEnter: 1 })
accepts('clickToEnter true accepted', { clickToEnter: true })
rejects('showHint "yes" rejected', { showHint: 'yes' })
accepts('showHint false accepted (the hint switch)', { showHint: false })

// ── the template form's fields ───────────────────────────────────────────────
rejects('form "nope" rejected', { form: 'nope' })
accepts('form "video" accepted', { form: 'video' })
accepts('form "template" accepted', { form: 'template' })
// The id fields are plain strings on purpose: the whitelist lives in the
// store, which is also what decides whether a template exists at all. A
// schema-level pattern would reject a well-formed id whose template was since
// deleted — the wrong answer, because the documented behaviour for that is a
// fallback to the clip screen, not a settings write that refuses to save. The
// sanitising half is asserted in [4c]'s fallback checks.
accepts('template "Bad_Id" accepted by the schema (the store judges it)', { template: 'Bad_Id' })
rejects('template2 1 rejected', { template2: 1 })
rejects('tpl.speed 9 rejected (above the schema bound)', { tpl: { speed: 9 } })
rejects('tpl.speed 0.1 rejected (below the schema bound)', { tpl: { speed: 0.1 } })
rejects('tpl.theme "blue" rejected', { tpl: { theme: 'blue' } })
rejects('tpl.glassOpacity 0.1 rejected (below 0.15)', { tpl: { glassOpacity: 0.1 } })
rejects('tpl.glassOpacity 0.99 rejected (above 0.95)', { tpl: { glassOpacity: 0.99 } })
accepts('tpl.glassOpacity 0.5 accepted (inside 0.15–0.95)', { tpl: { glassOpacity: 0.5 } })
rejects('tpl.transitionIn "spin" rejected', { tpl: { transitionIn: 'spin' } })
accepts('tpl partial accepted — the other leaves keep their defaults',
  { tpl: { speed: 1.5, glass: true } })

// ---------------------------------------------------------------------------
// 3. Every field is volatile: without one, dsh-settings never serves the
//    namespace and the browser card can never render.
// ---------------------------------------------------------------------------

console.log('\n[3] live (volatile) projection')
const FIELD_KEYS = Object.keys(Config.dict)
for (const key of FIELD_KEYS) {
  if (key === 'tpl') {
    // The one nested field: the object itself is NOT volatile (a whole-object
    // live reference would project as a single opaque value the card could not
    // write one leaf at a time), but every LEAF is. The projection below is
    // what proves the leaves survive; this is what proves the object is not
    // marked by mistake.
    check('field "tpl" is an object of live leaves, not itself live',
      Config.dict.tpl.meta.volatile !== true && Config.dict.tpl.type === 'object'
      && Object.values(Config.dict.tpl.dict).every((leaf) => leaf.meta.volatile === true),
      'type=' + Config.dict.tpl.type + ' meta.volatile=' + JSON.stringify(Config.dict.tpl.meta.volatile))
    check('...and every one of its leaves is volatile',
      Object.values(Config.dict.tpl.dict).every((leaf) => leaf.meta.volatile === true),
      String(Object.values(Config.dict.tpl.dict).filter((leaf) => leaf.meta.volatile !== true).length) + ' not live')
    continue
  }
  check('field "' + key + '" is volatile', Config.dict[key].meta.volatile === true,
    'meta.volatile=' + JSON.stringify(Config.dict[key].meta.volatile))
}
check('root is not volatile (per-field, like ui-theme / bash-local)', Config.meta.volatile !== true)

// Verbatim re-implementation of dsh-settings lib/index.js:118-131.
function volatileForm(schema) {
  if (schema.meta.volatile) return new z(schema.toJSON())
  if (schema.type === 'object') {
    const dict = Object.fromEntries(Object.entries(schema.dict ?? {}).flatMap(([key, child]) => {
      const field = volatileForm(child)
      return field === undefined ? [] : [[key, field]]
    }))
    return Object.keys(dict).length === 0 ? undefined : z.object(dict)
  }
  return undefined
}
// Verbatim re-implementation of dsh-settings lib/index.js:153-158.
function isVolatilePath(schema, path) {
  if (schema.meta.volatile) return true
  const [key, ...rest] = path
  const child = key === undefined ? undefined : schema.dict?.[key]
  return child !== undefined && isVolatilePath(child, rest)
}
// Verbatim re-implementation of dsh-settings lib/index.js:141-147.
function projectForm(schema, value) {
  if (schema.type === 'object' && value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(schema.dict ?? {}).flatMap(([key, child]) => {
      const field = Reflect.get(value, key)
      return field === undefined ? [] : [[key, projectForm(child, field)]]
    }))
  }
  return value
}

const form = volatileForm(Config)
check('describe() would NOT drop this entry (volatileForm !== undefined)', form !== undefined)
equal('described field keys', Object.keys(form?.dict ?? {}), FIELD_KEYS)
check('described schema serializes for the client', 'refs' in form.toJSON())
equal('described value for the pristine config', projectForm(form, plainConfig(Config({}))), DEFAULTS)
for (const key of FIELD_KEYS) {
  if (key === 'tpl') {
    // Nested: the object path itself is not a writable leaf, every leaf path
    // is. Both halves are asserted, because a schema where the object itself
    // were volatile would let the card replace the whole group in one write,
    // and one where the leaves were not would silently refuse every write.
    check('write path rejects the group object itself (isVolatilePath)', isVolatilePath(Config, ['tpl']) === false)
    const tplKeys = Object.keys(Config.dict.tpl.dict)
    for (const leaf of tplKeys) {
      check('write path accepts "tpl.' + leaf + '" (isVolatilePath)', isVolatilePath(Config, ['tpl', leaf]) === true)
    }
    check('write path would reject an undeclared leaf', isVolatilePath(Config, ['tpl', 'nope']) === false)
    continue
  }
  check('write path accepts "' + key + '" (isVolatilePath)', isVolatilePath(Config, [key]) === true)
}
check('write path would reject an undeclared field', isVolatilePath(Config, ['nope']) === false)

const rehydrated = new z(Config.toJSON())
equal('toJSON round-trip keeps the defaults', plainConfig(rehydrated({})), DEFAULTS)

// ---------------------------------------------------------------------------
// 4. apply(): routes, the pre-boot injection, and the removed settings service.
// ---------------------------------------------------------------------------

console.log('\n[4] apply()')

function makeCtx() {
  const routes = []
  const listeners = new Map()
  const log = []
  const base = {
    logger: {
      warn: (...args) => log.push(['warn', String(args[0])]),
      error: (...args) => log.push(['error', String(args[0])]),
    },
    effect: (callback) => { const disposer = callback(); return () => { if (typeof disposer === 'function') disposer() } },
    on: (event, handler) => { listeners.set(event, handler); return () => listeners.delete(event) },
    webServer: { register: (route) => { routes.push(route); return () => {} } },
  }
  // A ctx with no `settings` service at all: reading it throws, so a leftover
  // reference to the removed namespace registration cannot pass unnoticed.
  const ctx = new Proxy(base, {
    get(target, key, receiver) {
      if (key === 'settings') throw new Error('ctx.settings was read')
      return Reflect.get(target, key, receiver)
    },
  })
  return { ctx, routes, listeners, log, config: undefined }
}

function mount(bundle, config) {
  bundle.config = config
  mod.apply(bundle.ctx, config)
  return bundle
}

function render(bundle) {
  const table = []
  bundle.listeners.get('webserver/index-inject')(table)
  return table
}

const CFG_PREFIX = 'globalThis.__DSH_BOOT_ANIM_CFG__='
const injectedConfig = (rows) => JSON.parse(rows[0].text.slice(CFG_PREFIX.length))

const enabled = mount(makeCtx(), Config({}))
// Three for the clip screen — the manifest, the clip bytes, and the on-demand
// rewrite the settings card's 优化 button calls — plus eleven for the template
// form. The rewrite route is a prefix for the same reason the clip route is:
// the file name travels in its query string, and an exact route matches the
// whole URL including that query. The template routes all live under their own
// /tpl prefix, so none of them can claim `<ROUTE>/client.js`.
check('twenty-eight routes registered', enabled.routes.length === 28,
  enabled.routes.map((r) => r.kind + ' ' + r.path).join(', '))
equal('route kinds/paths', enabled.routes.map((route) => [route.kind, route.path]),
  [['exact', '/plugins/dsh-boot-animation/clips.json'],
    ['prefix', '/plugins/dsh-boot-animation/clip'],
    ['prefix', '/plugins/dsh-boot-animation/optimize'],
    ['exact', '/plugins/dsh-boot-animation/tpl/splash.js'],
    ['exact', '/plugins/dsh-boot-animation/tpl/splash.css'],
    ['prefix', '/plugins/dsh-boot-animation/tpl/asset'],
    ['prefix', '/plugins/dsh-boot-animation/tpl/voice'],
    ['exact', '/plugins/dsh-boot-animation/tpl/templates.json'],
    ['prefix', '/plugins/dsh-boot-animation/tpl/template'],
    ['prefix', '/plugins/dsh-boot-animation/tpl/template-asset'],
    ['prefix', '/plugins/dsh-boot-animation/tpl/template-file'],
    ['exact', '/plugins/dsh-boot-animation/tpl/frame-session'],
    ['prefix', '/plugins/dsh-boot-animation/tpl/frame'],
    ['exact', '/plugins/dsh-boot-animation/tpl/diag'],
    ['exact', '/plugins/dsh-boot-animation/tpl/music/list'],
    ['prefix', '/plugins/dsh-boot-animation/tpl/music/file'],
    ['prefix', '/plugins/dsh-boot-animation/tpl/music/upload'],
    ['exact', '/plugins/dsh-boot-animation/tpl/music/delete'],
    ['exact', '/plugins/dsh-boot-animation/tpl/editor'],
    ['exact', '/plugins/dsh-boot-animation/tpl/idcard'],
    ['exact', '/plugins/dsh-boot-animation/tpl/templates'],
    ['exact', '/plugins/dsh-boot-animation/tpl/preview-template'],
    ['exact', '/plugins/dsh-boot-animation/tpl/editor/draft'],
    ['exact', '/plugins/dsh-boot-animation/tpl/editor/preview'],
    ['exact', '/plugins/dsh-boot-animation/tpl/templates/save'],
    ['exact', '/plugins/dsh-boot-animation/tpl/template-assets/upload'],
    ['exact', '/plugins/dsh-boot-animation/tpl/store'],
    ['exact', '/plugins/dsh-boot-animation/tpl/store/install']])
// The clip routes keep their three original paths in their original order —
// the first three rows above — so an accidental reordering that changed which
// handler a clip request reached would fail here rather than in the browser.
check('the three clip routes still come first',
  enabled.routes.slice(0, 3).every((route) => !route.path.includes('/tpl')))
check('no ctx.settings read, no warning', enabled.log.length === 0, JSON.stringify(enabled.log))

const enabledRows = render(enabled)
equal('two head rows injected when enabled', enabledRows.length, 2)
equal('first row placement', [enabledRows[0].kind, enabledRows[0].placement], ['script', 'head'])
check('config row assigns the documented global', enabledRows[0].text.startsWith(CFG_PREFIX),
  enabledRows[0].text.slice(0, 44))
equal('injected config', injectedConfig(enabledRows), INJECTED_DEFAULTS)
check('second row is the boot screen source verbatim', enabledRows[1].text === bootScreenSource,
  enabledRows[1].text === '' ? 'EMPTY (src/boot-screen.js unreadable)' : enabledRows[1].text.length + ' chars')

const off = mount(makeCtx(), Config({ enabled: false }))
equal('no head rows injected when disabled', render(off).length, 0)
equal('no warning when disabled', off.log.length, 0)

const noConfig = mount(makeCtx(), undefined)
const noConfigRows = render(noConfig)
equal('two head rows with no applied config (no schema resolution)', noConfigRows.length, 2)
check('...and they still carry the defaults', injectedConfig(noConfigRows).fadeMs === 2000)

const partial = mount(makeCtx(), { fadeMs: 4000 })
equal('per-field fallback on a partial plain config',
  [injectedConfig(render(partial)).fadeMs, injectedConfig(render(partial)).enterMode], [4000, 'tail'])

const junk = mount(makeCtx(), {
  enabled: true, fadeMs: 'x', enterMode: 'nope', disabledClips: 'no',
  sound: 'no', clickToEnter: 1, showHint: 'yes',
})
const junkCfg = injectedConfig(render(junk))
equal('per-field fallback on a junk config',
  [junkCfg.fadeMs, junkCfg.enterMode, junkCfg.sound, junkCfg.clickToEnter, junkCfg.showHint],
  [2000, 'tail', true, false, true])
equal('per-field fallback on an absent config keeps every default',
  injectedConfig(render(noConfig)), INJECTED_DEFAULTS)

// ---------------------------------------------------------------------------
// 4c. The template form's rows, and the fallback when its template is gone.
// ---------------------------------------------------------------------------

console.log('\n[4c] template form rows')

/** The globals a template row assigns, parsed the same way the video one is. */
function globalOf(rows, name) {
  const prefix = 'globalThis.' + name + '='
  const row = rows.find((candidate) => candidate.kind === 'script' && candidate.text.startsWith(prefix))
  if (row === undefined) return undefined
  return JSON.parse(row.text.slice(prefix.length))
}

const tplBundle = mount(makeCtx(), Config({ form: 'template' }))
const tplRows = render(tplBundle)
equal('nine rows for the template form', tplRows.length, 9)
equal('row order (kind, placement, target)',
  tplRows.map((row) => [row.kind, row.placement ?? '', row.src ?? row.path ?? (row.text || row.html || '').slice(0, 24)]),
  [['style', '', 'html.dsu-lock,html.dsu-l'],
    ['html', 'head', '<link rel="stylesheet" h'],
    ['script', 'head', 'globalThis.__DSH_BOOT_AN'],
    ['script', 'head', 'globalThis.__DSH_BOOT_AN'],
    ['script', 'head', 'globalThis.__DSH_BOOT_AN'],
    ['html', 'body', '<div id="dsh-boot-anim-t'],
    ['script', 'body', '(function(){try{\nvar c=g'],
    ['script-preload', '', '/plugins/dsh-boot-animation/tpl/splash.js'],
    ['script-src', 'body', '/plugins/dsh-boot-animation/tpl/splash.js']])
check('the runtime is preloaded before it is executed',
  tplRows[7].kind === 'script-preload' && tplRows[8].kind === 'script-src'
  && tplRows[7].src === tplRows[8].src)

// The runtime's own contract: the route prefix, its config, and the template
// data, all as plain globals the script-src row reads after them.
equal('route prefix global', globalOf(tplRows, '__DSH_BOOT_ANIM_TPL_BASE__'),
  '/plugins/dsh-boot-animation/tpl')
const tplCfg = globalOf(tplRows, '__DSH_BOOT_ANIM_TPL_CFG__')
check('runtime config global present', tplCfg !== undefined)
equal('runtime config carries the template-form settings',
  [tplCfg.mode, tplCfg.theme, tplCfg.speed, tplCfg.identity, tplCfg.glass],
  ['session', 'light', 1, 'JOYCE MOORE', false])

// A value the user STORED has to reach the runtime, not just the schema default.
// `tpl` is a nested object whose leaves are volatile, so the applied config is a
// plain object full of live references: reading `source[key]` directly made every
// type guard fail and every field fall back to `TPL_DEFAULTS`, while the settings
// card happily showed what was stored. Reported as "我改了身份名称，开屏里的内容还是没变".
const edited = render(mount(makeCtx(), Config({
  form: 'template',
  tpl: { identity: 'MASTER', identityId: '0018', speed: 1.5, glass: true, bgmEnabled: true },
})))
const editedCfg = globalOf(edited, '__DSH_BOOT_ANIM_TPL_CFG__')
equal('a stored template-form value reaches the runtime',
  [editedCfg.identity, editedCfg.identityId, editedCfg.speed, editedCfg.glass, editedCfg.bgmEnabled],
  ['MASTER', '0018', 1.5, true, true])
check('runtime config never carries the clip screen\'s fields',
  !('fadeMs' in tplCfg) && !('enterMode' in tplCfg) && !('manifest' in tplCfg))
check('runtime config says enabled — the Host already decided that',
  tplCfg.enabled === true)

// The template data itself: the built-in archive-warm, with the store's private
// location fields stripped.
const tplData = globalOf(tplRows, '__DSH_BOOT_ANIM_TPL_1__')
check('first-act template global present', tplData !== undefined)
equal('...and it is the built-in archive-warm',
  [tplData.id, tplData.steps.length, tplData.__root, tplData.__source],
  ['archive-warm', 5, undefined, undefined])
check('no second-act global when template2 is empty',
  globalOf(tplRows, '__DSH_BOOT_ANIM_TPL_2__') === undefined)
check('the mount point is the runtime\'s own root id',
  tplRows[5].html === '<div id="dsh-boot-anim-tpl" class="dsu-root dsu-boot"></div>')
check('the bootstrap decides session/daily and arms the nine-second fallback',
  tplRows[6].text.includes("sessionStorage.getItem('dsh-boot-animation:tpl-shown')")
  && tplRows[6].text.includes('__DSH_BOOT_ANIM_TPL_RUNNING__')
  && tplRows[6].text.includes('9000'))

// A second act adds exactly one row, in the right place.
const twoActs = render(mount(makeCtx(), Config({ form: 'template', template: 'archive-warm', template2: 'deep-sonar' })))
equal('ten rows with a second act', twoActs.length, 10)
const secondData = globalOf(twoActs, '__DSH_BOOT_ANIM_TPL_2__')
equal('...and its data global is the second template',
  [secondData.id, secondData.steps.length], ['deep-sonar', 5])

// The template-form rows carry the template screen's own settings; the video
// screen's two rows are still what a video form serves, byte for byte.
const backToVideo = render(mount(makeCtx(), Config({ form: 'video' })))
equal('the video form still serves exactly two head rows', backToVideo.length, 2)
equal('...and the same config as before', injectedConfig(backToVideo), INJECTED_DEFAULTS)
check('...and the same screen source as before', backToVideo[1].text === bootScreenSource)

// A template that cannot be read or validated falls back to the clip screen,
// because a boot page with no screen at all is the one outcome this package
// exists to prevent.
const broken = mount(makeCtx(), Config({ form: 'template', template: 'no-such-template' }))
const brokenRows = render(broken)
equal('a missing template falls back to the two clip rows', brokenRows.length, 2)
check('...and says so in the log',
  broken.log.some((entry) => entry[0] === 'warn' && entry[1].includes('no-such-template')),
  JSON.stringify(broken.log))
const brokenId = mount(makeCtx(), Config({ form: 'template', template: 'Bad_Id!' }))
const brokenIdRows = render(brokenId)
// An id that is not even a legal template name never reaches the store: the
// Host sanitises it to the documented default, which exists, so the template
// form still serves its nine rows — with the DEFAULT template's data, not the
// junk id's. That is the sanitising half of the two-layer design; the store's
// own rejection path is what the missing-template case above exercises.
equal('an illegal template id is sanitised, not served', brokenIdRows.length, 9)
equal('...to the documented default template',
  globalOf(brokenIdRows, '__DSH_BOOT_ANIM_TPL_1__').id, 'archive-warm')

// ---------------------------------------------------------------------------
// 4b. The applied config carries LIVE references, and reading them per render
//     is what makes a stored edit take effect without restarting the fiber.
// ---------------------------------------------------------------------------

console.log('\n[4b] live references (the shape the loader hands apply)')
const liveConfig = Config({ fadeMs: 4000, enterMode: 'click' })
check('a Config field is a reference, not a plain value', isLive(liveConfig.fadeMs),
  'typeof ' + typeof liveConfig.fadeMs)
check('...whose snapshot is the configured value', liveConfig.fadeMs.get() === 4000,
  String(liveConfig.fadeMs.get()))

const live = mount(makeCtx(), liveConfig)
equal('configured values reach the injection', injectedConfig(render(live)),
  { ...INJECTED_DEFAULTS, fadeMs: 4000, enterMode: 'click' })

// Replay what @deepseek-ai/cordis-plugin-loader does on a volatile-only change
// (lib/index.js:410-415): commit a new snapshot into the SAME reference.
liveConfig.fadeMs[VOLATILE_REF](8000)
liveConfig.enterMode[VOLATILE_REF]('end')
equal('a committed snapshot is visible to the next index render, with no re-apply',
  [injectedConfig(render(live)).fadeMs, injectedConfig(render(live)).enterMode], [8000, 'end'])

// The three behaviour switches are volatile too, so flipping them in Settings
// reaches the next page load without restarting the kernel.
liveConfig.sound[VOLATILE_REF](false)
liveConfig.clickToEnter[VOLATILE_REF](true)
liveConfig.showHint[VOLATILE_REF](false)
equal('a committed behaviour switch reaches the injection',
  [injectedConfig(render(live)).sound, injectedConfig(render(live)).clickToEnter,
    injectedConfig(render(live)).showHint],
  [false, true, false])

liveConfig.enabled[VOLATILE_REF](false)
equal('turning it off through the reference stops the injection', render(live).length, 0)
liveConfig.enabled[VOLATILE_REF](true)
equal('and turning it back on restores it', render(live).length, 2)

liveConfig.disabledClips[VOLATILE_REF]([FIXTURE])
equal('a committed clip exclusion is visible to the manifest route', render(live).length, 2)

// ---------------------------------------------------------------------------
// 5. The manifest route: unchanged shape, unchanged cache headers.
// ---------------------------------------------------------------------------

console.log('\n[5] manifest route')
async function callManifest(bundle) {
  const route = bundle.routes.find((row) => row.path.endsWith('clips.json'))
  const headers = {}
  let body = ''
  const res = {
    writeHead: (status, extra) => { headers.status = status; Object.assign(headers, extra) },
    end: (chunk) => { if (chunk !== undefined) body += chunk.toString('utf8') },
    headersSent: false,
  }
  route.handler({ url: '/plugins/dsh-boot-animation/clips.json', method: 'GET', headers: {} }, res)
  for (let i = 0; i < 300 && body === ''; i++) await new Promise((resolve) => setTimeout(resolve, 10))
  return { headers, payload: JSON.parse(body) }
}

const manifest = await callManifest(mount(makeCtx(), Config({})))
equal('manifest status', manifest.headers.status, 200)
equal('manifest cache-control', manifest.headers['cache-control'], 'no-store')
equal('manifest content-type', manifest.headers['content-type'], 'application/json; charset=utf-8')
const row = manifest.payload.clips[0]
equal('clip row keys', Object.keys(row).sort(), ['bytes', 'enabled', 'faststart', 'name', 'src'])
equal('clip row name', row.name, FIXTURE)
check('clip row src shape',
  new RegExp('^/plugins/dsh-boot-animation/clip/' + FIXTURE + '\\?v=\\d+-\\d+$').test(row.src), row.src)
equal('clip row enabled with an empty disabledClips', row.enabled, true)
equal('clip row faststart (moov before mdat)', row.faststart, true)
check('clip row bytes > 0', row.bytes > 0, String(row.bytes))

const excluded = await callManifest(live)
const excludedFixture = excluded.payload.clips.find((clip) => clip.name === FIXTURE)
check('the fixture is in the manifest', excludedFixture !== undefined,
  excluded.payload.clips.map((clip) => clip.name).join(', '))
equal('a disabled clip is listed with enabled:false', excludedFixture?.enabled, false)
equal('...and stays in the list so the card can offer it back',
  excluded.payload.clips.filter((clip) => clip.name === FIXTURE).length, 1)

// ---------------------------------------------------------------------------
// 6. Source-level assertions on the text that ships.
// ---------------------------------------------------------------------------

console.log('\n[6] source assertions (comments stripped)')
const source = readFileSync(join(root, 'entry.js'), 'utf8')
const code = stripComments(source)
for (const gone of ['settings.register', 'settingsScope', 'settingsOwner', 'ctx.get']) {
  check('no "' + gone + '" outside comments', code.includes(gone) === false)
}
check('static schema import present', /^import z from '@deepseek-ai\/schemastery'$/m.test(code))
check('apply(ctx, config) present', /export function apply\(ctx, config\)/.test(code))
check('Config is an exported const', /export const Config = z\.object\(\{/.test(code))
// 59: the seven original fields, the three top-level form fields, the
// thirty-two template-form leaves, and the seventeen music ones.
check('every field is marked live', (code.match(/\blive\(z\./g) ?? []).length === 59,
  String((code.match(/\blive\(z\./g) ?? []).length) + ' of 59')
check('route prefix unchanged', code.includes("const ROUTE = '/plugins/dsh-boot-animation'"))
// The clip route and the template routes all answer no-store; the count covers
// the shared helpers as well as the per-route headers, so it moves whenever a
// new cacheable answer is added anywhere in the file.
check('clip responses still no-store', (code.match(/'cache-control': 'no-store'/g) ?? []).length >= 2)
check('Range handling still present', code.includes('function parseRange(header, size)'))
check('no backtick inside the injected row text', code.includes('globalThis.__DSH_BOOT_ANIM_CFG__'))
check('optional services are injected, never ctx.get',
  /ctx\.inject\(\['connection'\]/.test(code) && /ctx\.inject\(\['profileContext'\]/.test(code) === false)
check('the template form declares its own route prefix',
  code.includes("const TPL_ROUTE = `${ROUTE}/tpl`"))
check('the template root id is distinct from the clip screen\'s',
  code.includes("const TPL_ROOT_ID = 'dsh-boot-anim-tpl'"))
check('every template row escapes its JSON for the script element',
  (code.match(/safeJson\(/g) ?? []).length >= 4)
check('the runtime is served as a script-src row, not an html row',
  code.includes("kind: 'script-src', placement: 'body', src: `${TPL_ROUTE}/splash.js`"))

// ---------------------------------------------------------------------------
// 7. package.json: the schema library is a peer, not a bundled dependency.
// ---------------------------------------------------------------------------

console.log('\n[7] package.json')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
// The schema library is a DECLARED dependency, not a peer. The peer form read
// correct ("the host supplies it") and was wrong in the only place it mattered:
// a profile's pnpm-workspace.yaml sets autoInstallPeers=false, so a `dsh plugin
// add` install never resolved it, the static import in entry.js threw, and the
// plugin died before registering a single route. The declared range must carry
// .volatile() (>= 3.18.4) or the settings card silently disappears.
equal('schemastery is a declared dependency', pkg.dependencies, { '@deepseek-ai/schemastery': '^3.18.4' })
check('no schemastery peer left behind',
  pkg.peerDependencies?.['@deepseek-ai/schemastery'] === undefined,
  JSON.stringify(pkg.peerDependencies))
// What the official installer reads before and after installing: the bundle patch
// that contributes the row, and the runtime floor the plugin page gates on.
equal('dsh.bundle.patch', pkg.dsh?.bundle?.patch, './cordis.patch.yml')
check('dsh.engines.dsh declared', typeof pkg.dsh?.engines?.dsh === 'string' && pkg.dsh.engines.dsh.includes('0.2.0-rc.2'),
  JSON.stringify(pkg.dsh?.engines?.dsh))
// The plugin page renders icon + locale metadata; both must ship in the tarball.
check('icon declared', pkg.icon === 'icon.svg', String(pkg.icon))
equal('name', pkg.name, '@ljwei-stak/dsh-boot-animation')
// Deliberately not a pinned literal. This assertion read `0.1.0` until the
// release commit that bumped the package to 0.2.0, at which point the suite went
// red for a reason that had nothing to do with the code - a defect in the suite.
// What is worth checking is that the field is present and well-formed.
check('version is a semver',
  /^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(String(pkg.version)), String(pkg.version))
check('description untouched', typeof pkg.description === 'string' && pkg.description.length > 0)
equal('exports', Object.keys(pkg.exports), ['.', './client', './locale/*', './cordis.patch.yml', './package.json'])
// The docs ship too, because README.md links to them from the npm page: a
// package that carries only README.md leaves every one of those links dead for
// anyone who installs from the registry rather than from GitHub.
equal('files', pkg.files, ['assets', 'lib', 'src', 'locale', 'cordis.patch.yml', 'entry.js', 'icon.svg', 'package.json', 'README.md', 'README.zh-CN.md', 'INSTALL.md', 'MANUAL.md', 'CREDITS.md', 'AGENTS.md', 'docs'])
check('locale metadata ships',
  existsSync(join(root, 'locale', 'en.json')) && existsSync(join(root, 'locale', 'zh.json')))
check('icon file ships', existsSync(join(root, 'icon.svg')))

// The patch row's `name` is resolved as a BARE package name from the profile's
// node_modules, so it has to be the manifest name character for character. Under
// a scope the installed directory is node_modules/@scope/name and the bare form
// resolves to nothing: the entry silently fails to import and DSH reports
// "did not activate ... failed to import" while the settings card still works,
// because that one is keyed on `id`. Nothing in the harness compares the two, so
// a rename that moves either without the other is invisible until boot.
const patchText = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
// Both keys may carry the YAML list-item dash: the row reads
// `- insert:\n    - id: ...\n      name: ...`, so `id` is `- id:` but `name` is not.
const patchKey = (key) => new RegExp('^\\s*(?:- )?' + key + ':\\s*[\'"]?([^\'"\\n]+?)[\'"]?\\s*$', 'm').exec(patchText)
const patchName = patchKey('name')
equal('patch row name == package name', patchName?.[1], pkg.name)
// ...and `id` must NOT be the package name; it is the settings namespace, which
// src/client.js spells out separately.
const patchId = patchKey('id')
check('patch row id is a namespace, not the package name',
  patchId !== null && patchId[1] !== pkg.name, patchId?.[1] ?? '(none)')

// ---------------------------------------------------------------------------
// 8. Which schema library this run actually resolved.
// ---------------------------------------------------------------------------

console.log('\n[8] resolved schema library')
const resolved = fileURLToPath(import.meta.resolve('@deepseek-ai/schemastery'))
const resolvedPkg = JSON.parse(readFileSync(join(dirname(dirname(resolved)), 'package.json'), 'utf8'))
console.log('  ' + resolvedPkg.name + '@' + resolvedPkg.version + '  ->  ' + resolved)
check('resolved copy supports .volatile()', typeof z.boolean().volatile === 'function')

rmSync(scratch, { recursive: true, force: true })

console.log('\n' + (failures === 0 ? 'PASS' : 'FAIL') + ' — ' + (checks - failures) + '/' + checks + ' checks')
process.exit(failures === 0 ? 0 : 1)
