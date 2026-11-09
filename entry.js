// dsh-boot-animation — Host half.
//
// Two contributions, both required for the overlay to exist at all:
//
//  1. a webserver route serving the clip pool (bytes from ./assets/videos), a
//     same-origin manifest naming them, and one on-demand route that moves a
//     clip's index table to the front of its file (the card's 优化 button), and
//  2. an index injection whose head row installs the screen before the shell
//     boots.
//
// The head row is the whole reason this is a plugin rather than a client
// component: the kernel constructs its own boot page synchronously in
// `AppWebEntry`'s constructor, which runs from the shell module script, so only a
// parser-blocking index row executes early enough to pre-empt it.
//
// Settings are the third contribution, and under DSH 0.2.0-rc.2 they are
// DECLARED rather than registered. The Host `settings` service has no
// `register(ns, schema)` method any more: a settings namespace IS a plugin entry.
// `@deepseek-ai/dsh-settings` describes every running entry whose resolved export
// carries a `Config` schema — `entry.fiber.runtime.Config`, filled from this
// module's `Config` export by `RegistryService.plugin` — keyed by the entry id in
// the profile patch, here `boot-animation`. The browser half pairs with that same
// string, through the client `configForms` service, which exposes only the
// namespaces the Host actually serves. Two consequences are load-bearing:
//
//   * `Config` must be a property of the module namespace object, so the schema
//     package has to resolve at module-evaluation time. The previous lazy import
//     degraded to "no settings card"; a static import fails the whole module —
//     which is why `@deepseek-ai/schemastery` is a plain dependency pinned at
//     `^3.18.4`. It used to be a peer dependency on the theory that "the host
//     supplies it"; that theory does not survive contact with a profile, whose
//     `pnpm-workspace.yaml` sets `autoInstallPeers: false`: the peer was never
//     installed, a fresh `dsh plugin add` resolved no schemastery at all, and the
//     import threw while `entry.js` was being evaluated — no routes, no screen,
//     no card, and no diagnostic that named the real cause. A declared dependency
//     is versioned, deterministic and has `.volatile()` from 3.18.4 on. The
//     kernel keeps its own copy; the two interoperate because the projection
//     reads plain data (`meta.volatile`, `dict`, `toJSON()`) and the live
//     reference is keyed by `Symbol.for('cosmokit.volatile.write')`, a global
//     registry symbol that does not care how many copies of the library exist.
//     `LIVE_CAPABLE` still probes for the method rather than trusting it.
//   * `describe()` reports only an entry whose Config projects a non-empty form,
//     and that projection keeps only fields marked `.volatile()`. A schema with
//     no live field is invisible to the settings page; see `LIVE_CAPABLE`.
//
// The patch id is therefore part of the contract: renaming the `- insert:` id in
// cordis.patch.yml moves the namespace and silently orphans the browser card,
// whose key is the same string.

import { readdir, stat, open } from 'node:fs/promises'
import { createReadStream, readFileSync, statSync, readFile, mkdirSync, writeFileSync, copyFileSync, readdirSync, existsSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { basename, extname, join, resolve, sep } from 'node:path'
import { randomBytes } from 'node:crypto'
import { optimizeInPlace } from './src/remux.js'
import { createCustomClips } from './src/custom-clips.js'
import { createTemplateStore, TEMPLATE_FILE_TYPES, ASSET_FILE_RE, isFileInsideRoot } from './src/template-store.js'
import { validateTemplate, TEMPLATE_ID_RE } from './src/template-validate.js'
import { createMusicStore, MUSIC_EXT_RE, MUSIC_FILE_RE, MUSIC_TYPES, MUSIC_LIMIT } from './src/music-store.js'
import { IDCARD_HTML } from './src/idcard-html.js'
import { createStoreClient, STORE_INSTALL_LIMIT, safeStorePath } from './src/template-store-remote.js'
import { rejected } from './src/trust-fence.js'
import z from '@deepseek-ai/schemastery'

/**
 * Absolute path of the pre-boot screen source.
 *
 * The script is read per index render rather than once at module load. Reading it
 * at load time would pin the served script to whatever the file held when the
 * process started, so editing a label or the exit fade would require restarting
 * dsh — the one operation this plugin's whole design tries to avoid asking for.
 */
const BOOT_SCREEN_PATH = fileURLToPath(new URL('./src/boot-screen.js', import.meta.url))

/**
 * The vendored runtime's static media, resolved from this module.
 *
 * The interface sound effects and the voice packs live beside the runtime they
 * belong to, so the whole template form is one directory the package ships.
 */
const SPLASH_ASSET_DIR = fileURLToPath(new URL('./assets/splash/assets', import.meta.url))
const SPLASH_VOICE_DIR = fileURLToPath(new URL('./assets/splash/voices', import.meta.url))

/** Video container extensions the pool accepts, in discovery order. */
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.m4v', '.mov'])

/** Route prefix both the manifest and the clip bytes live under. */
const ROUTE = '/plugins/dsh-boot-animation'

/**
 * Route prefix the template form's runtime and assets live under.
 *
 * Its own prefix rather than a share of ROUTE, for the reason the clip and
 * manifest routes are separate: the web server resolves prefixes longest-first,
 * so a prefix on ROUTE would also claim `<ROUTE>/client.js` — the URL the
 * browser fetches for this package's own client bundle. Every path under this
 * prefix belongs to the template form, and nothing else claims it.
 */
const TPL_ROUTE = `${ROUTE}/tpl`

/** DOM id the template runtime mounts its overlay under. */
const TPL_ROOT_ID = 'dsh-boot-anim-tpl'

/**
 * The two screen forms, in the order the settings card presents them.
 *
 * `video` is this package's original full-window clip; `template` is the
 * data-driven form the vendored runtime renders. The default is `video`, so a
 * profile written before this field existed behaves exactly as it did.
 */
const SCREEN_FORMS = ['video', 'template']

/** The three transition points a template run has, and the accepted types. */
const TRANSITION_TYPES = ['dissolve', 'flash', 'glitch', 'scanline', 'slide', 'iris', 'black', 'none']
const TRANSITION_DIRS = ['left', 'right', 'up', 'down']
const TPL_THEMES = ['light', 'dark']
const TPL_MODES = ['always', 'session', 'daily']
const TPL_VOICE_LANGS = ['en', 'zh', 'both']
const TPL_VOICE_FX = ['none', 'ai-mech', 'robot', 'radio', 'oldtv', 'dark']
const TPL_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/
const TPL_TEXT_MAX = 48

/**
 * The template form's settings, with the defaults the runtime also carries.
 *
 * These are the fields the Host resolves and hands to the runtime as its
 * config; the runtime merges them over its own DEFAULTS, so an absent field
 * here is the runtime's default rather than a broken screen. The values below
 * are the ones the card shows when the settings document has none.
 */
const TPL_DEFAULTS = {
  speed: 1,
  theme: 'light',
  mode: 'session',
  requireInteraction: true,
  allowSkip: true,
  sound: true,
  soundVolume: 0.5,
  voice: true,
  voiceLang: 'en',
  voicePack: 'f',
  voiceFx: 'robot',
  voiceRate: 0.88,
  voicePitch: 0.85,
  voiceVolume: 0.9,
  voiceCue: true,
  voiceLead: 240,
  identity: 'JOYCE MOORE',
  identityId: '0087',
  accessLevel: '3',
  accent: '#ff7500',
  glitchA: '#ff3b30',
  glitchB: '#2971b8',
  transitionIn: 'dissolve',
  transitionJoin: 'dissolve',
  transitionOut: 'dissolve',
  transitionMs: 600,
  transitionDir: 'left',
  glass: false,
  glassOpacity: 0.75,
  glassBlur: 22,
  glassSaturate: 160,
  glassBackdropBlur: 28,
  // ── the user's own background music ────────────────────────────────────────
  // The runtime reads these from its config; the Host only carries them. A file
  // name is a stored name (music-<stamp>-<rand>.<ext>), never a path — the
  // runtime fetches it through the /tpl/music/file route, which re-checks the
  // whitelist before touching the disk.
  bgmEnabled: false,
  bgmLoop: true,
  bgmFile: '',
  bgmFile2: '',
  bgmVolume: 0.5,
  bgmBpm: 100,
  bgmBeats1: 16,
  bgmBeats2: 32,
  bgm1Start: 0,
  bgm2Start: 0,
  bgm1FadeIn: 1,
  bgm1FadeOut: 1,
  bgm2FadeIn: 1,
  bgm2FadeOut: 2,
  bgmCrossfade: 1200,
  bgm2Loop: false,
  bgmDuck: true,
}

/**
 * The values the screen runs with when the applied config does not carry one.
 *
 * With a `Config` schema present these are unreachable in practice: Cordis
 * validates the raw profile row against the schema before `apply` runs, so every
 * field arrives already defaulted and an absent settings document and an empty
 * one resolve identically. They are kept anyway, because the fallback must not
 * depend on the schema having been resolvable — a profile that cannot load the
 * schema package still boots, and this plugin then still serves its clips.
 */
const DEFAULT_SETTINGS = {
  /**
   * Whether the screen is injected at all. Off restores DSH's own boot page: the
   * rows are simply not added, so no overlay, no clip request and no script run.
   */
  enabled: true,
  /** How long the dissolve into the app takes. */
  fadeMs: 2000,
  /** When the hand-off happens: see ENTER_MODES. */
  enterMode: 'tail',
  /** Clip file names excluded from the pool by the user. */
  disabledClips: [],
  /**
   * Whether the clip may make a sound at all.
   *
   * On, the screen tries to play unmuted and offers its sound button as the
   * gesture the audio policy asks for. Off, the screen is silenced for good: no
   * unmuted attempt, no sound button and no way to re-enable audio from the
   * overlay. Defaults to on so an existing profile behaves exactly as before.
   */
  sound: true,
  /**
   * Whether a pointer press enters immediately.
   *
   * The screen normally spends the first press unlocking audio (Chromium grants
   * sound only to a gesture, and the entering gesture cannot also be the unlock)
   * and the second press leaving. On, the first press leaves — the shortcut a
   * user wants once the clip has no sound to offer, or when they simply do not
   * care to hear it.
   */
  clickToEnter: false,
  /**
   * Whether the bottom hint line is drawn.
   *
   * Off leaves the title and the progress bar in place and only hides the
   * sentence that says what a press does, for a screen judged to be better
   * without instructions on it.
   */
  showHint: true,
  /**
   * Which screen form plays: a full-window clip, or a data-driven template.
   *
   * `video` is this package's original behaviour and the default, so a profile
   * written before the template form existed is unchanged. `template` hands the
   * boot page to the vendored runtime under assets/splash/, which renders the
   * template named by `template` (and optionally a second act named by
   * `template2`).
   */
  form: 'video',
  /** Template id for the template form's first act. */
  template: 'archive-warm',
  /** Template id for the optional second act; empty plays none. */
  template2: '',
  /** The template form's own settings; see TPL_DEFAULTS. */
  tpl: TPL_DEFAULTS,
}

/** The accepted `enterMode` values, in the order the browser card presents them. */
const ENTER_MODES = ['tail', 'end', 'click']

/**
 * Whether the resolved schemastery can mark a Config field live-editable.
 *
 * `.volatile()` is what makes `dsh-settings` project a field into the form the
 * settings page renders: `volatileForm()` keeps only fields with `meta.volatile`,
 * and `describe()` drops every entry whose projected form is empty. `.volatile()`
 * exists from schemastery 3.18.4, which this package now declares as a dependency,
 * so the normal resolution has it. What the probe still guards against is a
 * resolution that ignores that declaration — a profile lockfile pinned older
 * through `pnpm.overrides`, or a hand-made `node_modules` link installed by the
 * scripted (non-package) route — because calling the method there would throw
 * while this module is being evaluated, taking the routes and the boot screen
 * down with the settings card.
 *
 * So the method is probed once and the schema degrades to non-volatile when it is
 * absent. The cost is a hidden settings card; `apply` warns with the fix.
 */
const LIVE_CAPABLE = typeof z.boolean().volatile === 'function'

/** Mark one Config field live-editable, where the schema library allows it. */
function live(schema) {
  return LIVE_CAPABLE ? schema.volatile() : schema
}

/**
 * The well-known key cosmokit puts on a live config reference.
 *
 * `.volatile()` does not yield the value: it yields a stable reference whose
 * `get()` answers the current immutable snapshot, identified across ESM/CJS
 * copies of the library by this global-registry symbol rather than by identity.
 * A plugin therefore reads a volatile field through `get()`, exactly as the
 * shipped Host plugins do (`dsh-bash-local`: `config.timeoutMs.get()`).
 *
 * The reference is also what lets a stored edit take effect without a restart:
 * when only volatile values differ, `@deepseek-ai/cordis-plugin-loader` commits
 * the new snapshot into the SAME reference (`updateVolatile`) and emits
 * `loader/volatile-update` instead of restarting the fiber. `apply` is not run
 * again, so a value read per index render is always the stored one.
 */
const VOLATILE_REF = Symbol.for('cosmokit.volatile.write')

/** Whether a config value is a live reference rather than a plain snapshot. */
function isLive(value) {
  return typeof value === 'object' && value !== null && VOLATILE_REF in value
}

/**
 * Read one applied-config field.
 *
 * The field is a live reference when `Config` declared it volatile — the normal
 * case — and a plain value when the config arrived without schema resolution,
 * which is the same pair of shapes `dsh-settings`' own `plainConfig()` handles.
 * An absent field stays absent, leaving the per-field defaulting to its caller.
 * @param config - the applied config, possibly undefined.
 * @param key - field name.
 * @returns the current value, or undefined when the field is absent.
 */
function readField(config, key) {
  const value = config?.[key]
  return isLive(value) && typeof value.get === 'function' ? value.get() : value
}

/**
 * Resolve one template id setting to a usable id.
 *
 * An empty string is meaningful for the second act — it means "play none" — so
 * it is passed through rather than defaulted. Anything that is not a string, or
 * that carries a path, is refused and the fallback used instead: the id becomes
 * a directory name, so the same whitelist the store applies is applied here
 * too, and a value that would escape the template roots never reaches one.
 * @param value - the raw setting.
 * @param fallback - the id to use when the value is unusable.
 * @returns a template id, or '' when the fallback is ''.
 */
function templateId(value, fallback) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(value)) return fallback
  return value
}

/**
 * Resolve the template form's settings, one field at a time.
 *
 * Each field keeps its own fallback for the same reason the seven video fields
 * do: a profile that could not resolve the schema, or a document written by an
 * older version that lacks this group entirely, must still produce a complete
 * settings object. The bounds mirror the schema's, because this is the path an
 * unresolved config takes — a value the schema would have rejected arrives here
 * raw and is clamped rather than trusted.
 * @param raw - the applied `tpl` value, possibly undefined or partial.
 * @returns the resolved template settings.
 */
function resolveTpl(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const out = { ...TPL_DEFAULTS }
  const num = (key, min, max) => {
    const value = Number(source[key])
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : TPL_DEFAULTS[key]
  }
  const bool = (key) => (typeof source[key] === 'boolean' ? source[key] : TPL_DEFAULTS[key])
  const oneOf = (key, allowed) => (allowed.includes(source[key]) ? source[key] : TPL_DEFAULTS[key])
  const color = (key) => (typeof source[key] === 'string' && TPL_COLOR_RE.test(source[key])
    ? source[key]
    : TPL_DEFAULTS[key])
  const text = (key) => (typeof source[key] === 'string' && source[key].trim() !== ''
    ? source[key].slice(0, TPL_TEXT_MAX)
    : TPL_DEFAULTS[key])
  out.speed = num('speed', 0.35, 3)
  out.theme = oneOf('theme', TPL_THEMES)
  out.mode = oneOf('mode', TPL_MODES)
  out.requireInteraction = bool('requireInteraction')
  out.allowSkip = bool('allowSkip')
  out.sound = bool('sound')
  out.soundVolume = num('soundVolume', 0, 1)
  out.voice = bool('voice')
  out.voiceLang = oneOf('voiceLang', TPL_VOICE_LANGS)
  out.voicePack = /^[a-z]$/.test(source.voicePack) ? source.voicePack : TPL_DEFAULTS.voicePack
  out.voiceFx = oneOf('voiceFx', TPL_VOICE_FX)
  out.voiceRate = num('voiceRate', 0.5, 2)
  out.voicePitch = num('voicePitch', 0, 2)
  out.voiceVolume = num('voiceVolume', 0, 1)
  out.voiceCue = bool('voiceCue')
  out.voiceLead = num('voiceLead', 0, 1200)
  out.identity = text('identity')
  out.identityId = text('identityId')
  out.accessLevel = text('accessLevel')
  out.accent = color('accent')
  out.glitchA = color('glitchA')
  out.glitchB = color('glitchB')
  out.transitionIn = oneOf('transitionIn', TRANSITION_TYPES)
  out.transitionJoin = oneOf('transitionJoin', TRANSITION_TYPES)
  out.transitionOut = oneOf('transitionOut', TRANSITION_TYPES)
  out.transitionMs = num('transitionMs', 200, 2000)
  out.transitionDir = oneOf('transitionDir', TRANSITION_DIRS)
  out.glass = bool('glass')
  out.glassOpacity = num('glassOpacity', 0.15, 0.95)
  out.glassBlur = num('glassBlur', 0, 60)
  out.glassSaturate = num('glassSaturate', 100, 200)
  out.glassBackdropBlur = num('glassBackdropBlur', 0, 80)
  // The music group. A file field is a stored name, and the whitelist is the
  // store's own — a value that does not match is dropped to the default rather
  // than passed on, because the runtime would fetch a name the route refuses.
  out.bgmEnabled = bool('bgmEnabled')
  out.bgmLoop = bool('bgmLoop')
  out.bgmFile = MUSIC_FILE_RE.test(source.bgmFile) ? source.bgmFile : TPL_DEFAULTS.bgmFile
  out.bgmFile2 = MUSIC_FILE_RE.test(source.bgmFile2) ? source.bgmFile2 : TPL_DEFAULTS.bgmFile2
  out.bgmVolume = num('bgmVolume', 0, 1)
  out.bgmBpm = num('bgmBpm', 40, 220)
  out.bgmBeats1 = num('bgmBeats1', 4, 128)
  out.bgmBeats2 = num('bgmBeats2', 4, 128)
  out.bgm1Start = num('bgm1Start', 0, 7200)
  out.bgm2Start = num('bgm2Start', 0, 7200)
  out.bgm1FadeIn = num('bgm1FadeIn', 0, 10)
  out.bgm1FadeOut = num('bgm1FadeOut', 0, 10)
  out.bgm2FadeIn = num('bgm2FadeIn', 0, 10)
  out.bgm2FadeOut = num('bgm2FadeOut', 0, 10)
  out.bgmCrossfade = num('bgmCrossfade', 0, 5000)
  out.bgm2Loop = bool('bgm2Loop')
  out.bgmDuck = bool('bgmDuck')
  // An identity with no letters (a pure-Chinese name) leaves the runtime's own
  // fallback to derive the code from; an empty id is refused outright, because
  // the runtime prints it in the sequence and a blank reads as a bug.
  if (out.identityId === '') out.identityId = TPL_DEFAULTS.identityId
  return out
}

/**
 * This entry's Host configuration schema.
 *
 * The namespace is not named here because it is no longer named anywhere on this
 * side: it is the entry id the profile patch mounts this row under,
 * `- insert: id: boot-animation`. `src/client.js` spells that same string in
 * `SETTINGS_NAMESPACE`, and nothing else checks that the two agree.
 *
 * The field names, defaults and bounds are the ones the removed
 * `settings.register(SETTINGS_NS, schema)` call declared, plus the three
 * behaviour switches added later (sound, clickToEnter, showHint), so an absent
 * settings document and an empty one still behave identically.
 *
 * Every field is volatile, because that is the only class the settings service
 * serves: it projects volatile fields and nothing else. The price is that the
 * applied config carries live references rather than plain values — see
 * `readField`.
 */
export const Config = z.object({
  enabled: live(z.boolean().default(DEFAULT_SETTINGS.enabled)),
  fadeMs: live(z.number().min(300).max(5000).default(DEFAULT_SETTINGS.fadeMs)),
  enterMode: live(z.union([...ENTER_MODES]).default(DEFAULT_SETTINGS.enterMode)),
  disabledClips: live(z.array(z.string()).default([])),
  sound: live(z.boolean().default(DEFAULT_SETTINGS.sound)),
  clickToEnter: live(z.boolean().default(DEFAULT_SETTINGS.clickToEnter)),
  showHint: live(z.boolean().default(DEFAULT_SETTINGS.showHint)),
  // ── the template form ──────────────────────────────────────────────────────
  // Four more fields, all volatile like the seven above. `form` picks the
  // screen; `template`/`template2` name the acts; `tpl` carries the template
  // form's own settings. `tpl` is a nested object whose LEAVES are volatile,
  // which is the shape the settings service projects (volatileForm keeps only
  // volatile children, and isVolatilePath walks the dict), so the card can
  // write one field at a time — `{ op: 'set', path: ['tpl', 'speed'], value }`.
  form: live(z.union([...SCREEN_FORMS]).default(DEFAULT_SETTINGS.form)),
  template: live(z.string().default(DEFAULT_SETTINGS.template)),
  template2: live(z.string().default(DEFAULT_SETTINGS.template2)),
  tpl: z.object({
    speed: live(z.number().min(0.35).max(3).default(TPL_DEFAULTS.speed)),
    theme: live(z.union([...TPL_THEMES]).default(TPL_DEFAULTS.theme)),
    mode: live(z.union([...TPL_MODES]).default(TPL_DEFAULTS.mode)),
    requireInteraction: live(z.boolean().default(TPL_DEFAULTS.requireInteraction)),
    allowSkip: live(z.boolean().default(TPL_DEFAULTS.allowSkip)),
    sound: live(z.boolean().default(TPL_DEFAULTS.sound)),
    soundVolume: live(z.number().min(0).max(1).default(TPL_DEFAULTS.soundVolume)),
    voice: live(z.boolean().default(TPL_DEFAULTS.voice)),
    voiceLang: live(z.union([...TPL_VOICE_LANGS]).default(TPL_DEFAULTS.voiceLang)),
    voicePack: live(z.string().default(TPL_DEFAULTS.voicePack)),
    voiceFx: live(z.union([...TPL_VOICE_FX]).default(TPL_DEFAULTS.voiceFx)),
    voiceRate: live(z.number().min(0.5).max(2).default(TPL_DEFAULTS.voiceRate)),
    voicePitch: live(z.number().min(0).max(2).default(TPL_DEFAULTS.voicePitch)),
    voiceVolume: live(z.number().min(0).max(1).default(TPL_DEFAULTS.voiceVolume)),
    voiceCue: live(z.boolean().default(TPL_DEFAULTS.voiceCue)),
    voiceLead: live(z.number().min(0).max(1200).default(TPL_DEFAULTS.voiceLead)),
    identity: live(z.string().default(TPL_DEFAULTS.identity)),
    identityId: live(z.string().default(TPL_DEFAULTS.identityId)),
    accessLevel: live(z.string().default(TPL_DEFAULTS.accessLevel)),
    accent: live(z.string().default(TPL_DEFAULTS.accent)),
    glitchA: live(z.string().default(TPL_DEFAULTS.glitchA)),
    glitchB: live(z.string().default(TPL_DEFAULTS.glitchB)),
    transitionIn: live(z.union([...TRANSITION_TYPES]).default(TPL_DEFAULTS.transitionIn)),
    transitionJoin: live(z.union([...TRANSITION_TYPES]).default(TPL_DEFAULTS.transitionJoin)),
    transitionOut: live(z.union([...TRANSITION_TYPES]).default(TPL_DEFAULTS.transitionOut)),
    transitionMs: live(z.number().min(200).max(2000).default(TPL_DEFAULTS.transitionMs)),
    transitionDir: live(z.union([...TRANSITION_DIRS]).default(TPL_DEFAULTS.transitionDir)),
    glass: live(z.boolean().default(TPL_DEFAULTS.glass)),
    glassOpacity: live(z.number().min(0.15).max(0.95).default(TPL_DEFAULTS.glassOpacity)),
    glassBlur: live(z.number().min(0).max(60).default(TPL_DEFAULTS.glassBlur)),
    glassSaturate: live(z.number().min(100).max(200).default(TPL_DEFAULTS.glassSaturate)),
    glassBackdropBlur: live(z.number().min(0).max(80).default(TPL_DEFAULTS.glassBackdropBlur)),
    // ── the user's own background music ───────────────────────────────────────
    // A file field carries a STORED name (music-<stamp>-<rand>.<ext>), never a
    // path: the runtime fetches it through the /tpl/music/file route, which
    // re-checks the whitelist before touching the disk. The ranges are the
    // runtime's own, so a value the schema accepts is a value it can play.
    bgmEnabled: live(z.boolean().default(TPL_DEFAULTS.bgmEnabled)),
    bgmLoop: live(z.boolean().default(TPL_DEFAULTS.bgmLoop)),
    bgmFile: live(z.string().default(TPL_DEFAULTS.bgmFile)),
    bgmFile2: live(z.string().default(TPL_DEFAULTS.bgmFile2)),
    bgmVolume: live(z.number().min(0).max(1).default(TPL_DEFAULTS.bgmVolume)),
    bgmBpm: live(z.number().min(40).max(220).default(TPL_DEFAULTS.bgmBpm)),
    bgmBeats1: live(z.number().min(4).max(128).default(TPL_DEFAULTS.bgmBeats1)),
    bgmBeats2: live(z.number().min(4).max(128).default(TPL_DEFAULTS.bgmBeats2)),
    bgm1Start: live(z.number().min(0).max(7200).default(TPL_DEFAULTS.bgm1Start)),
    bgm2Start: live(z.number().min(0).max(7200).default(TPL_DEFAULTS.bgm2Start)),
    bgm1FadeIn: live(z.number().min(0).max(10).default(TPL_DEFAULTS.bgm1FadeIn)),
    bgm1FadeOut: live(z.number().min(0).max(10).default(TPL_DEFAULTS.bgm1FadeOut)),
    bgm2FadeIn: live(z.number().min(0).max(10).default(TPL_DEFAULTS.bgm2FadeIn)),
    bgm2FadeOut: live(z.number().min(0).max(10).default(TPL_DEFAULTS.bgm2FadeOut)),
    bgmCrossfade: live(z.number().min(0).max(5000).default(TPL_DEFAULTS.bgmCrossfade)),
    bgm2Loop: live(z.boolean().default(TPL_DEFAULTS.bgm2Loop)),
    bgmDuck: live(z.boolean().default(TPL_DEFAULTS.bgmDuck)),
  }),
})

/** Package name the loader mounts this row as. */
export const name = 'dsh-boot-animation'

/** Services this half consumes. */
export const inject = ['webServer']

/** The clip directory, resolved from this module rather than the process cwd. */
const assetDir = fileURLToPath(new URL('./assets/videos', import.meta.url))

/** MIME type served for one clip. */
function contentType(file) {
  switch (extname(file).toLowerCase()) {
    case '.webm': return 'video/webm'
    case '.mov': return 'video/quicktime'
    default: return 'video/mp4'
  }
}

/**
 * Whether the movie box precedes the media data.
 *
 * A player cannot decode a frame until it has read `moov`, so a file whose
 * `moov` sits at the end must be fetched almost in full before anything appears
 * — the usual reason a clip shows nothing but black for a while. This is reported
 * to the browser card, which is where a user can act on it (tools/faststart.mjs
 * rewrites such a file losslessly).
 *
 * The header window is 64 KiB because the order of the first two boxes is NOT the
 * answer: all three clips in this pool carry a ~21 KiB `uuid` metadata box before
 * the media data, so a 1 KiB read saw `ftyp, uuid` and returned no verdict at all.
 * @param absolute - resolved clip path.
 * @returns true when `moov` comes first, false when `mdat` does, undefined when
 *   neither box is found within the header window.
 */
async function readFaststart(absolute) {
  let handle
  try {
    handle = await open(absolute, 'r')
    const head = Buffer.alloc(65536)
    const { bytesRead } = await handle.read(head, 0, head.length, 0)
    let offset = 0
    while (offset + 8 <= bytesRead) {
      const type = head.toString('latin1', offset + 4, offset + 8)
      if (type === 'moov') return true
      if (type === 'mdat') return false
      const size = head.readUInt32BE(offset)
      if (size < 8) break
      offset += size
    }
    return undefined
  } catch {
    // An unreadable header is not a reason to drop the clip from the pool; the
    // card simply shows no optimisation verdict for it.
    return undefined
  } finally {
    await handle?.close()
  }
}

/**
 * List the clip files currently on disk, newest first.
 *
 * The modification time travels with each path because the manifest publishes it
 * as the clip's revision: the bytes route caches immutably under a filename that
 * carries no revision of its own, so a clip replaced in place must be requested
 * under a new URL or the browser keeps serving the year-old copy it holds.
 * @returns every servable clip with its revision stamp and card metadata.
 */
async function listClips() {
  let entries
  try {
    entries = await readdir(assetDir, { withFileTypes: true })
  } catch (error) {
    // A missing directory is an empty pool, not a failure: the overlay then has
    // nothing to play and the plugin must stay invisible rather than break boot.
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const files = entries
    .filter(entry => entry.isFile() && VIDEO_EXTENSIONS.has(extname(entry.name).toLowerCase()))
    .map(entry => join(assetDir, entry.name))
  const stamped = await Promise.all(files.map(async (file) => {
    const info = await stat(file)
    return {
      file,
      // Sorted on the raw time, published rounded: two files written in the same
      // millisecond would tie on the rounded value and order nondeterministically.
      mtime: info.mtimeMs,
      revision: Math.round(info.mtimeMs),
      bytes: info.size,
      faststart: await readFaststart(file),
    }
  }))
  return stamped.sort((left, right) => right.mtime - left.mtime)
}

/** Answer one JSON response. */
function sendJson(res, status, value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.byteLength),
    'cache-control': 'no-store',
  })
  res.end(body)
}

/**
 * Parse one `Range` header against a known length.
 * @param header - raw header value, if present.
 * @param size - complete resource length.
 * @returns inclusive byte range, or undefined for a full response.
 */
function parseRange(header, size) {
  if (typeof header !== 'string') return undefined
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (match === null) return undefined
  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return undefined
  if (rawStart === '') {
    const length = Number(rawEnd)
    if (!Number.isFinite(length) || length <= 0) return undefined
    return { start: Math.max(size - length, 0), end: size - 1 }
  }
  const start = Number(rawStart)
  if (!Number.isFinite(start) || start >= size) return { unsatisfiable: true }
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  if (!Number.isFinite(end) || end < start) return { unsatisfiable: true }
  return { start, end }
}

/**
 * Stream one clip, honouring range requests so the browser can seek and so a
 * repeated load does not re-download bytes it already holds.
 * @param absolute - resolved clip path on disk.
 * @param req - incoming request.
 * @param res - outgoing response.
 */
async function serveClip(absolute, req, res) {
  const info = await stat(absolute)
  const type = contentType(absolute)
  const range = parseRange(req.headers.range, info.size)
  if (range?.unsatisfiable === true) {
    res.writeHead(416, { 'content-range': `bytes */${String(info.size)}` })
    res.end()
    return
  }

  // Nothing about a clip response may be stored, complete or not.
  //
  // The overlay replaces the media element when it hands over or skips on, which
  // aborts the in-flight request; whatever arrived is a TRUNCATED body. Any
  // directive that lets the browser keep it — `immutable`, or `no-cache` plus an
  // ETag — turns that into a poisoned cache entry: the next normal reload decodes
  // the fragment, and a clip whose `moov` sits at the end has no index in a
  // fragment, so it paints nothing while a faststart clip still plays. An ETag is
  // no defence, because it only ever claimed the FILE had not changed, never that
  // the copy in hand was complete — and answering `If-None-Match` with 304 is
  // precisely what made the browser confident in a fragment.
  //
  // The cost is that each page load streams the chosen clip again. These are local
  // files over loopback — a few tens of milliseconds — and it buys the only
  // guarantee that matters: what the player decodes is always the whole file.
  const headers = {
    'content-type': type,
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
  }

  // Streamed from disk rather than read whole and sliced. A browser playing a
  // clip issues many overlapping range requests, and reading a 10 MB file per
  // request holds the whole clip in memory on every one of them; the original
  // implementation did exactly that. Streaming also lets the response start
  // before the file is fully read, which is what keeps playback fed while the
  // element seeks into the parts it still needs.
  const from = range === undefined ? 0 : range.start
  const to = range === undefined ? info.size - 1 : range.end
  res.writeHead(range === undefined ? 200 : 206, {
    ...headers,
    'content-length': String(to - from + 1),
    ...(range === undefined ? {} : {
      'content-range': `bytes ${String(from)}-${String(to)}/${String(info.size)}`,
    }),
  })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  const stream = createReadStream(absolute, { start: from, end: to })
  stream.on('error', () => { res.destroy() })
  res.on('close', () => { stream.destroy() })
  stream.pipe(res)
}

/**
 * Resolve a requested pool path to a file inside the clip directory.
 * @param url - request URL.
 * @returns the absolute path, or undefined when the request is not a pool clip.
 */
function resolveClip(url) {
  const pathname = decodeURIComponent(url.split('?')[0])
  if (!pathname.startsWith(`${ROUTE}/clip/`)) return undefined
  const requested = basename(pathname.slice(`${ROUTE}/clip/`.length))
  if (!VIDEO_EXTENSIONS.has(extname(requested).toLowerCase())) return undefined
  const absolute = resolve(assetDir, requested)
  // Containment: a traversal attempt must not escape the clip directory.
  if (!absolute.startsWith(assetDir + sep)) return undefined
  return absolute
}

/**
 * Mount the clip route and the pre-boot index injection.
 * @param ctx - Host plugin context.
 * @param config - the applied config, already validated against `Config`. Each
 *   field arrives as a live reference carrying its defaulted value, so a profile
 *   with no settings document reads the same values as one holding an empty
 *   document.
 */
export function apply(ctx, config) {
  const server = ctx.webServer
  const customClips = createCustomClips(ctx, { route: ROUTE, serveClip, sendJson, readFaststart })
  // The template form's data, and the guard its user-facing routes sit behind.
  // Both are optional by construction: the store degrades to the built-in
  // templates when no profileContext arrives, and the fence fails CLOSED when no
  // connection service arrives — a route that would read user data without a
  // guard must refuse rather than open. Neither is read with `ctx.get`, which
  // races activation and silently answers undefined.
  const templates = createTemplateStore(ctx)
  const music = createMusicStore(ctx)
  let fence = null
  if (typeof ctx.inject === 'function') {
    ctx.inject(['connection'], (owner) => {
      const connection = owner?.get?.('connection')
      if (connection && typeof connection.requestRejection === 'function') {
        fence = { connection }
        owner.effect(() => () => { if (fence?.connection === connection) fence = null })
      }
    })
  }

  if (!LIVE_CAPABLE) {
    ctx.logger?.warn?.(
      'boot-animation: the resolved @deepseek-ai/schemastery has no .volatile(), so DSH '
      + 'will not serve this entry as a settings namespace and the settings card stays '
      + 'hidden. This package declares ^3.18.4 as a dependency, so a resolution without '
      + 'the method means the profile pinned an older copy (pnpm.overrides) or the '
      + 'package was linked by hand instead of installed. Reinstall the plugin so '
      + 'pnpm resolves the declared version.',
    )
  }

  /**
   * The settings the screen should run with right now.
   *
   * Read per index render rather than cached, because the boot screen is rebuilt
   * from this on the next page load — which is exactly when a new value can take
   * effect, and the loader has by then already committed a stored edit into the
   * references this reads.
   *
   * Every field falls back individually. With `Config` resolved the fallback is
   * unreachable, but it must stay so that a profile which could not load the
   * schema, and therefore receives an unresolved config, still boots a working
   * animation under the documented defaults.
   * @returns the resolved settings, with every field defaulted.
   */
  function currentSettings() {
    try {
      const enabled = readField(config, 'enabled')
      const fadeMs = readField(config, 'fadeMs')
      const enterMode = readField(config, 'enterMode')
      const disabledClips = readField(config, 'disabledClips')
      const sound = readField(config, 'sound')
      const clickToEnter = readField(config, 'clickToEnter')
      const showHint = readField(config, 'showHint')
      return {
        enabled: typeof enabled === 'boolean' ? enabled : DEFAULT_SETTINGS.enabled,
        fadeMs: typeof fadeMs === 'number' ? fadeMs : DEFAULT_SETTINGS.fadeMs,
        enterMode: ENTER_MODES.includes(enterMode) ? enterMode : DEFAULT_SETTINGS.enterMode,
        disabledClips: Array.isArray(disabledClips) ? disabledClips : [],
        sound: typeof sound === 'boolean' ? sound : DEFAULT_SETTINGS.sound,
        clickToEnter: typeof clickToEnter === 'boolean' ? clickToEnter : DEFAULT_SETTINGS.clickToEnter,
        showHint: typeof showHint === 'boolean' ? showHint : DEFAULT_SETTINGS.showHint,
        form: SCREEN_FORMS.includes(readField(config, 'form')) ? readField(config, 'form') : DEFAULT_SETTINGS.form,
        template: templateId(readField(config, 'template'), DEFAULT_SETTINGS.template),
        template2: templateId(readField(config, 'template2'), DEFAULT_SETTINGS.template2),
        tpl: resolveTpl(readField(config, 'tpl')),
      }
    } catch (error) {
      ctx.logger?.warn?.('boot-animation: settings unreadable, using defaults', error)
      return DEFAULT_SETTINGS
    }
  }

  // Two routes rather than one prefix over ROUTE. The web server resolves
  // prefixes longest-first, so a prefix on ROUTE also claims
  // `<ROUTE>/client.js` — the URL the browser fetches for this package's own
  // client bundle (client-modules serves every bundle at
  // `/plugins/<package>/client.js`). That request would answer this plugin's
  // 404, the bundle would never materialize, and the Settings card would never
  // register. An exact manifest route plus a `/clip` prefix leaves every other
  // path under ROUTE to its owner.
  ctx.effect(() => server.register({
    kind: 'exact',
    path: `${ROUTE}/clips.json`,
    handler: (req, res) => {
      void (async () => {
        const clips = [...await listClips(), ...await customClips.listClips(req)]
          .sort((left, right) => right.mtime - left.mtime)
        const disabled = new Set(currentSettings().disabledClips)
        sendJson(res, 200, {
          clips: clips.map(clip => ({
            // The revision is the size+time pair the bytes route also answers as
            // its ETag, and the URL is what makes a stale cache entry unreachable:
            // it changes whenever the file does — or whenever the scheme that
            // produced a bad entry changes. The first scheme (mtime alone) left
            // truncated `immutable` entries that a normal reload kept reusing, and
            // nothing but a hard reload could dislodge them.
            src: clip.src ?? (`${ROUTE}/clip/${encodeURIComponent(basename(clip.file))}`
              + `?v=${String(clip.revision)}-${String(clip.bytes)}`),
            name: clip.name ?? basename(clip.file),
            // Everything on disk is listed, with the pool decision carried as a
            // field. The screen plays only the enabled ones; the settings card
            // needs the whole list to offer them back.
            enabled: !disabled.has(clip.name ?? basename(clip.file)),
            bytes: clip.bytes,
            faststart: clip.faststart,
            ...(clip.custom ? { custom: true, displayName: clip.displayName } : {}),
          })),
        })
      })().catch((error) => {
        ctx.logger?.error?.('boot-animation: manifest route failed', error)
        if (!res.headersSent) sendJson(res, 500, { error: 'internal' })
        else res.end()
      })
    },
  }), 'boot-animation: manifest route')

  ctx.effect(() => server.register({
    kind: 'prefix',
    path: `${ROUTE}/clip`,
    handler: (req, res) => {
      void (async () => {
        const absolute = resolveClip(req.url ?? '')
        if (absolute === undefined) {
          sendJson(res, 404, { error: 'not found' })
          return
        }
        try {
          await serveClip(absolute, req, res)
        } catch (error) {
          if (error?.code === 'ENOENT') {
            sendJson(res, 404, { error: 'not found' })
            return
          }
          throw error
        }
      })().catch((error) => {
        ctx.logger?.error?.('boot-animation: clip route failed', error)
        if (!res.headersSent) sendJson(res, 500, { error: 'internal' })
        else res.end()
      })
    },
  }), 'boot-animation: clip route')

  /**
   * One clip's index table moved to the front, on request — the card's 优化 button.
   *
   * A prefix route with the file name in the query string, for two reasons: these
   * handlers are handed the raw request (the clip route already reads its own `?v=`
   * suffix), and an `exact` route matches the whole URL, query included. Nothing in
   * the pool is written unless this is called: the card only ever REPORTS the
   * `moov` position, and a decorative plugin that rewrote a user's media on its own
   * is the behaviour this route exists to keep out of the boot path.
   */
  const optimising = new Set()
  ctx.effect(() => server.register({
    kind: 'prefix',
    path: `${ROUTE}/optimize`,
    handler: (req, res) => {
      void (async () => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: '这个地址只接受 POST。' })
          return
        }
        const requested = new URL(req.url ?? '/', 'http://localhost').searchParams.get('name') ?? ''
        // The same containment rule as `resolveClip`: a bare file name from this
        // pool, nothing that could name a path. Comparing against `basename`
        // rejects any separator the query carried in, encoded or not.
        const name = basename(requested)
        const absolute = resolve(assetDir, name)
        if (name === '' || name !== requested
          || !VIDEO_EXTENSIONS.has(extname(name).toLowerCase())
          || !absolute.startsWith(assetDir + sep)) {
          sendJson(res, 400, { ok: false, error: '素材名不合法。' })
          return
        }
        if (optimising.has(name)) {
          sendJson(res, 409, { ok: false, error: '这一条正在处理，稍等一下再点。' })
          return
        }
        optimising.add(name)
        try {
          const result = await optimizeInPlace({
            file: absolute,
            backupDir: join(assetDir, 'originals'),
            scratchDir: join(assetDir, '.faststart-work'),
          })
          sendJson(res, 200, result)
        } finally {
          optimising.delete(name)
        }
      })().catch((error) => {
        if (res.headersSent) {
          res.end()
          return
        }
        if (error?.code === 'ENOENT') {
          sendJson(res, 404, { ok: false, error: '素材不在了。' })
          return
        }
        if (typeof error?.code === 'string' && error.code.startsWith('E_')) {
          // A refusal raised on purpose; its message is written to be shown as is.
          sendJson(res, 422, { ok: false, error: error.message })
          return
        }
        ctx.logger?.error?.('boot-animation: optimize route failed', error)
        sendJson(res, 500, { ok: false, error: 'internal' })
      })
    },
  }), 'boot-animation: optimize route')

  // ── the template form ──────────────────────────────────────────────────────
  //
  // Everything under TPL_ROUTE serves the template screen: the runtime itself,
  // the template data the card browses, and the media a template references.
  //
  // Two rules shape the group. First, nothing here may be cacheable: the
  // runtime aborts a media request when it hands over or skips, and a stored
  // fragment of a video is what the clip route's no-store rule exists to
  // prevent — the same poisoning applies to a template's own video. Second, a
  // route that can read the USER's template directory goes through the trust
  // fence, and the fence fails closed; the package's own static files do not,
  // for the same reason the bundled clips are not fenced.

  /**
   * One package-owned static file, read per request with an mtime cache.
   *
   * The cache exists so a page load does not re-read 190 KB of runtime on every
   * request, and the mtime check is what makes an edit visible without a
   * restart — the same contract src/boot-screen.js has.
   * @param relative - path relative to this module.
   * @returns the file text, or '' when it cannot be read.
   */
  function staticText(relative) {
    const file = fileURLToPath(new URL(relative, import.meta.url))
    try {
      const info = statSync(file)
      const hit = staticCache.get(relative)
      if (hit !== undefined && hit.mtimeMs === info.mtimeMs) return hit.text
      const text = readFileSync(file, 'utf8')
      staticCache.set(relative, { mtimeMs: info.mtimeMs, text })
      return text
    } catch (error) {
      process.emitWarning(`boot-animation: cannot read ${file}: ${String(error)}`)
      return ''
    }
  }
  const staticCache = new Map()

  /** Answer one text body with the headers every /tpl/ response carries. */
  function sendTplText(res, type, text) {
    const body = Buffer.from(text, 'utf8')
    res.writeHead(200, {
      'content-type': type,
      'content-length': String(body.byteLength),
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    })
    res.end(body)
  }

  // The runtime and its stylesheet. Unfenced: they are package-owned static
  // files, and without the configuration row injected alongside them they are
  // inert — the runtime returns immediately when its config global is absent.
  for (const [suffix, type] of [['splash.js', 'text/javascript; charset=utf-8'], ['splash.css', 'text/css; charset=utf-8']]) {
    ctx.effect(() => server.register({
      kind: 'exact',
      path: `${TPL_ROUTE}/${suffix}`,
      handler: (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' })
          res.end()
          return
        }
        sendTplText(res, type, staticText(`./assets/splash/${suffix}`))
      },
    }), `boot-animation: template ${suffix} route`)
  }

  // The interface sound effects and the voice packs, by whitelisted name. Also
  // unfenced, and for the same reason: the files are inside the package.
  ctx.effect(() => server.register({
    kind: 'prefix',
    path: `${TPL_ROUTE}/asset`,
    handler: (req, res) => {
      void (async () => {
        const name = basename(decodeURIComponent((req.url ?? '').split('?')[0]))
        if (!/^[a-z0-9][a-z0-9._-]{0,40}\.mp3$/i.test(name) || name.includes('..')) {
          sendJson(res, 404, { ok: false, error: '素材不存在。' })
          return
        }
        try {
          await serveClip(join(SPLASH_ASSET_DIR, name), req, res)
        } catch (error) {
          if (error?.code === 'ENOENT') {
            sendJson(res, 404, { ok: false, error: '素材不存在。' })
            return
          }
          throw error
        }
      })().catch((error) => {
        ctx.logger?.error?.('boot-animation: template asset route failed', error)
        if (!res.headersSent) sendJson(res, 500, { error: 'internal' })
        else res.end()
      })
    },
  }), 'boot-animation: template asset route')

  ctx.effect(() => server.register({
    kind: 'prefix',
    path: `${TPL_ROUTE}/voice`,
    handler: (req, res) => {
      void (async () => {
        const pathname = decodeURIComponent((req.url ?? '').split('?')[0])
        const rest = pathname.slice(`${TPL_ROUTE}/voice`.length).replace(/^\/+/, '')
        const [pack, name] = rest.split('/')
        // Both segments are whitelisted, and the pack must be one the package
        // actually ships — a template can ask for any slot name, and the answer
        // to one that does not exist is a 404 rather than a directory listing.
        if (!/^[a-z]$/.test(pack ?? '') || !/^line-[1-9]\d?\.mp3$/.test(name ?? '')
          || !templates.voicePacks.some((entry) => entry.id === pack)) {
          sendJson(res, 404, { ok: false, error: '配音不存在。' })
          return
        }
        try {
          await serveClip(join(SPLASH_VOICE_DIR, pack, name), req, res)
        } catch (error) {
          if (error?.code === 'ENOENT') {
            sendJson(res, 404, { ok: false, error: '配音不存在。' })
            return
          }
          throw error
        }
      })().catch((error) => {
        ctx.logger?.error?.('boot-animation: template voice route failed', error)
        if (!res.headersSent) sendJson(res, 500, { error: 'internal' })
        else res.end()
      })
    },
  }), 'boot-animation: template voice route')

  /**
   * The template catalogue the settings card browses.
   *
   * Fenced: the list names the user's own templates, which is profile data.
   * The boot screen does not read it — the template data travels with the
   * index rows — so a refused request costs the card its dropdown, not the
   * animation its content.
   */
  ctx.effect(() => server.register({
    kind: 'exact',
    path: `${TPL_ROUTE}/templates.json`,
    handler: (req, res) => {
      if (rejected(req, res, fence)) return
      try {
        sendJson(res, 200, {
          templates: templates.listTemplates(),
          voices: templates.voicePacks,
        })
      } catch (error) {
        ctx.logger?.error?.('boot-animation: template list route failed', error)
        sendJson(res, 500, { error: 'internal' })
      }
    },
  }), 'boot-animation: template list route')

  /**
   * One template's data, for the card's preview and the runtime's replay.
   *
   * Fenced when the template comes from the user's directory, unfenced when it
   * is a built-in one — the same line the clip route draws around the bundled
   * pool, applied per template rather than per route.
   */
  ctx.effect(() => server.register({
    kind: 'prefix',
    path: `${TPL_ROUTE}/template`,
    handler: (req, res) => {
      void (async () => {
        const requested = decodeURIComponent((req.url ?? '').split('?')[0])
          .slice(`${TPL_ROUTE}/template/`.length)
        const id = basename(requested)
        if (id === '' || id !== requested || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) {
          sendJson(res, 400, { ok: false, error: '模板名不合法。' })
          return
        }
        const template = templates.readTemplate(id)
        if (template === null) {
          sendJson(res, 404, { ok: false, error: '模板不存在。' })
          return
        }
        if (template.__source === 'user' && rejected(req, res, fence)) return
        sendJson(res, 200, { ok: true, template: publicTemplate(template) })
      })().catch((error) => {
        ctx.logger?.error?.('boot-animation: template data route failed', error)
        if (!res.headersSent) sendJson(res, 500, { error: 'internal' })
        else res.end()
      })
    },
  }), 'boot-animation: template data route')

  /**
   * One file from a template's assets/ directory — its audio, images and video.
   *
   * The store has already applied the extension whitelist and the containment
   * check, so this handler streams what it is handed. A video asset is streamed
   * with Range support by the same function the clip route uses, which is also
   * what keeps its responses uncacheable.
   */
  ctx.effect(() => server.register({
    kind: 'prefix',
    path: `${TPL_ROUTE}/template-asset`,
    handler: (req, res) => {
      void (async () => {
        const pathname = decodeURIComponent((req.url ?? '').split('?')[0])
        const rest = pathname.slice(`${TPL_ROUTE}/template-asset/`.length)
        const segments = rest.split('/')
        const id = segments[0] ?? ''
        const name = basename(segments[1] ?? '')
        const hit = templates.resolveAsset(id, name)
        if (hit === null || segments.length !== 2) {
          sendJson(res, 404, { ok: false, error: '素材不存在。' })
          return
        }
        if (hit.source === 'user' && rejected(req, res, fence)) return
        await serveClip(hit.file, req, res)
      })().catch((error) => {
        ctx.logger?.error?.('boot-animation: template asset route failed', error)
        if (!res.headersSent) sendJson(res, 500, { error: 'internal' })
        else res.end()
      })
    },
  }), 'boot-animation: template asset route')

  /**
   * The same-origin fallback for an iframe template's files.
   *
   * The frame route below is the normal path; this one exists for the case the
   * capability session could not be minted, and it therefore always answers
   * with the sandboxing headers — a fallback that dropped them would hand a
   * user template the same-origin privileges the token route exists to avoid.
   */
  ctx.effect(() => server.register({
    kind: 'prefix',
    path: `${TPL_ROUTE}/template-file`,
    handler: (req, res) => {
      void (async () => {
        const pathname = decodeURIComponent((req.url ?? '').split('?')[0])
        const rest = pathname.slice(`${TPL_ROUTE}/template-file/`.length)
        const segments = rest.split('/')
        const id = segments[0] ?? ''
        const rel = segments.slice(1).join('/')
        const hit = templates.resolveTemplateFile(id, rel)
        if (hit === null) {
          sendJson(res, 404, { ok: false, error: '文件不存在。' })
          return
        }
        if (hit.untrusted && rejected(req, res, fence)) return
        await sendTemplateFile(res, hit.file, rel, hit.untrusted, req)
      })().catch((error) => {
        ctx.logger?.error?.('boot-animation: template file route failed', error)
        if (!res.headersSent) sendJson(res, 500, { error: 'internal' })
        else res.end()
      })
    },
  }), 'boot-animation: template file route')

  /**
   * Mint one capability token for an iframe template.
   *
   * Fenced, because it is the endpoint that grants the frame route its reads.
   * The body carries only the template id; the answer is the token and whether
   * the template is a user one, which is what decides the sandbox flags.
   */
  ctx.effect(() => server.register({
    kind: 'exact',
    path: `${TPL_ROUTE}/frame-session`,
    handler: (req, res) => {
      void (async () => {
        if (rejected(req, res, fence)) return
        if ((req.method ?? 'GET').toUpperCase() !== 'POST') {
          sendJson(res, 405, { ok: false, error: '这个地址只接受 POST。' })
          return
        }
        let payload = {}
        try {
          payload = JSON.parse(await readBody(req, 8 * 1024) || '{}')
        } catch {
          sendJson(res, 400, { ok: false, error: 'invalid json' })
          return
        }
        const session = templates.createFrameSession(String(payload?.id ?? ''))
        if (session === null) {
          sendJson(res, 404, { ok: false, error: '模板不存在。' })
          return
        }
        sendJson(res, 200, { ok: true, ...session })
      })().catch((error) => {
        ctx.logger?.error?.('boot-animation: frame session route failed', error)
        if (!res.headersSent) sendJson(res, 500, { error: 'internal' })
        else res.end()
      })
    },
  }), 'boot-animation: frame session route')

  /**
   * The capability route an iframe template loads its own files from.
   *
   * Not fenced, deliberately: a sandboxed frame is an opaque origin and cannot
   * carry the SameSite=Strict cookie the fence reads, so the fence would refuse
   * every one of its requests. The token is the capability — 32 random bytes,
   * ten minutes, one template, read-only — and the CSP below is what keeps the
   * document from reaching anything else.
   */
  ctx.effect(() => server.register({
    kind: 'prefix',
    path: `${TPL_ROUTE}/frame`,
    handler: (req, res) => {
      void (async () => {
        const method = (req.method ?? 'GET').toUpperCase()
        if (method !== 'GET' && method !== 'HEAD') {
          res.writeHead(405, { allow: 'GET, HEAD' })
          res.end()
          return
        }
        const pathname = decodeURIComponent((req.url ?? '').split('?')[0])
        const rest = pathname.slice(`${TPL_ROUTE}/frame/`.length)
        const segments = rest.split('/')
        const token = segments[0] ?? ''
        const rel = segments.slice(1).join('/')
        const session = templates.frameSession(token)
        if (session === null || rel === '') {
          sendJson(res, 404, { ok: false, error: '会话不存在或已过期。' })
          return
        }
        const hit = templates.resolveTemplateFile(session.id, rel)
        if (hit === null) {
          sendJson(res, 404, { ok: false, error: '文件不存在。' })
          return
        }
        await sendTemplateFile(res, hit.file, rel, session.untrusted, req)
      })().catch((error) => {
        ctx.logger?.error?.('boot-animation: template frame route failed', error)
        if (!res.headersSent) sendJson(res, 500, { error: 'internal' })
        else res.end()
      })
    },
  }), 'boot-animation: template frame route')

  /**
   * The runtime's diagnostic channel.
   *
   * The vendored runtime posts a line per notable event (which act started,
   * which clip played, where a timeline threw). Forwarded to the Host log under
   * a budget, because a screen that fails silently is this package's recurring
   * failure mode and the runtime already knows more than the Host does. A
   * failure to log is never allowed to fail the response.
   */
  ctx.effect(() => server.register({
    kind: 'exact',
    path: `${TPL_ROUTE}/diag`,
    handler: (req, res) => {
      void (async () => {
        const text = await readBody(req, 64 * 1024)
        if (diagBudget > 0 && text !== '') {
          diagBudget -= 1
          try {
            ctx.logger?.info?.('boot-animation: ' + text.slice(0, 400))
          } catch {
            /* a logger that refuses must not break the response */
          }
        }
        res.writeHead(204, { 'cache-control': 'no-store' })
        res.end()
      })().catch(() => { if (!res.headersSent) res.writeHead(204).end() })
    },
  }), 'boot-animation: template diag route')

  // ── the user's own background music ────────────────────────────────────────
  //
  // Four routes, all fenced: every one of them reads or writes the user's own
  // files, which is exactly the case the fence exists for. The files live in
  // the profile's data directory (never the installed package), the stored
  // NAME is generated rather than taken from the request, and the runtime
  // fetches a track by that name through the file route below — the same route
  // the settings card's preview button uses.
  //
  // Ported from dsh-boot-suite (MIT, © LeeRolling / 沈宏宏); see CREDITS.md.

  /** The card's list: what is on disk, newest first. */
  ctx.effect(() => server.register({
    kind: 'exact',
    path: `${TPL_ROUTE}/music/list`,
    handler: (req, res) => {
      if (rejected(req, res, fence)) return
      try {
        sendJson(res, 200, { ok: true, files: music.list() })
      } catch (error) {
        ctx.logger?.error?.('boot-animation: music list route failed', error)
        sendJson(res, 500, { ok: false, error: '读取失败，请稍后重试。' })
      }
    },
  }), 'boot-animation: music list route')

  /**
   * One track's bytes.
   *
   * The runtime fetches this while the animation plays, so a refusal costs the
   * animation its music rather than its picture — the bgm module catches a
   * failed load and carries on silently, by design.
   */
  ctx.effect(() => server.register({
    kind: 'prefix',
    path: `${TPL_ROUTE}/music/file`,
    handler: (req, res) => {
      void (async () => {
        const name = basename(new URL(req.url ?? '/', 'http://localhost').searchParams.get('name') ?? '')
        if (rejected(req, res, fence)) return
        const absolute = music.resolveFile(name)
        if (absolute === null) {
          sendJson(res, 404, { ok: false, error: '这首音乐不在了。' })
          return
        }
        const extension = extname(absolute).toLowerCase()
        const body = readFileSync(absolute)
        res.writeHead(200, {
          'content-type': MUSIC_TYPES[extension] ?? 'application/octet-stream',
          'content-length': String(body.byteLength),
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        })
        res.end(req.method === 'HEAD' ? undefined : body)
      })().catch((error) => {
        ctx.logger?.error?.('boot-animation: music file route failed', error)
        if (!res.headersSent) sendJson(res, 500, { ok: false, error: '读取失败，请稍后重试。' })
        else res.end()
      })
    },
  }), 'boot-animation: music file route')

  /**
   * Store one uploaded track.
   *
   * The body is bounded twice — by the content-length header when the browser
   * sends one, and by the streamed byte count, because a request that lies
   * about its length is the one that matters. The extension is checked before
   * anything is written; the stored name is generated, never taken from the
   * request. The user's own file name travels as display text only.
   */
  ctx.effect(() => server.register({
    kind: 'prefix',
    path: `${TPL_ROUTE}/music/upload`,
    handler: (req, res) => {
      void (async () => {
        if (rejected(req, res, fence)) return
        if ((req.method ?? 'GET').toUpperCase() !== 'POST') {
          sendJson(res, 405, { ok: false, error: '这个地址只接受 POST。' })
          return
        }
        const requested = new URL(req.url ?? '/', 'http://localhost').searchParams.get('name') ?? ''
        const display = requested.replace(/[\\/]/g, '').trim().slice(0, 160)
        const matched = MUSIC_EXT_RE.exec(display)
        if (matched === null) {
          sendJson(res, 400, { ok: false, error: '只支持 MP3、WAV、OGG、M4A、AAC、FLAC 音频。' })
          return
        }
        const declared = req.headers['content-length']
        if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > MUSIC_LIMIT)) {
          sendJson(res, 413, { ok: false, error: '单个音频不能超过 100 MB。' })
          return
        }
        const chunks = []
        let size = 0
        for await (const chunk of req) {
          size += chunk.length
          if (size > MUSIC_LIMIT) {
            sendJson(res, 413, { ok: false, error: '单个音频不能超过 100 MB。' })
            return
          }
          chunks.push(chunk)
        }
        const bytes = Buffer.concat(chunks)
        if (bytes.byteLength === 0) {
          sendJson(res, 400, { ok: false, error: '文件是空的。' })
          return
        }
        const entry = music.save(display, matched[0].toLowerCase(), bytes)
        if (entry === null) {
          sendJson(res, 503, { ok: false, error: '当前 profile 没有可用的保存目录。' })
          return
        }
        sendJson(res, 200, { ok: true, file: entry.file, name: entry.name, size: entry.size })
      })().catch((error) => {
        ctx.logger?.error?.('boot-animation: music upload route failed', error)
        if (!res.headersSent) sendJson(res, 500, { ok: false, error: '导入失败，请稍后重试。' })
        else res.end()
      })
    },
  }), 'boot-animation: music upload route')

  /** Drop one track. A file that is already gone still clears its index entry. */
  ctx.effect(() => server.register({
    kind: 'exact',
    path: `${TPL_ROUTE}/music/delete`,
    handler: (req, res) => {
      void (async () => {
        if (rejected(req, res, fence)) return
        if ((req.method ?? 'GET').toUpperCase() !== 'POST') {
          sendJson(res, 405, { ok: false, error: '这个地址只接受 POST。' })
          return
        }
        let payload = {}
        try {
          payload = JSON.parse(await readBody(req, 8 * 1024) || '{}')
        } catch {
          sendJson(res, 400, { ok: false, error: 'invalid json' })
          return
        }
        const file = String(payload?.file ?? '')
        if (!MUSIC_FILE_RE.test(file)) {
          sendJson(res, 400, { ok: false, error: '文件名不合法。' })
          return
        }
        sendJson(res, 200, { ok: true, file, removed: music.remove(file) })
      })().catch((error) => {
        ctx.logger?.error?.('boot-animation: music delete route failed', error)
        if (!res.headersSent) sendJson(res, 500, { ok: false, error: '删除失败，请稍后重试。' })
        else res.end()
      })
    },
  }), 'boot-animation: music delete route')

  // ── the template editor ────────────────────────────────────────────────────
  //
  // The editor is a vendored static page (assets/editor/editor.html) that edits
  // a template as JSON and previews it through this same runtime. What the Host
  // provides is the six routes its code calls and the two write paths, both of
  // which land in the user's template directory and nowhere else. Ported from
  // dsh-boot-suite (MIT, © LeeRolling / 沈宏宏); see CREDITS.md.

  /** The editor page itself: a package-owned static file, inert without the routes below. */
  ctx.effect(() => server.register({
    kind: 'exact',
    path: `${TPL_ROUTE}/editor`,
    handler: (req, res) => {
      sendTplText(res, 'text/html; charset=utf-8', staticText('./assets/editor/editor.html'))
    },
  }), 'boot-animation: template editor route')

  /** The identity card, standalone. Package-owned, no user data. */
  ctx.effect(() => server.register({
    kind: 'exact',
    path: `${TPL_ROUTE}/idcard`,
    handler: (req, res) => {
      sendTplText(res, 'text/html; charset=utf-8', IDCARD_HTML)
    },
  }), 'boot-animation: template idcard route')

  /**
   * The editor's template list.
   *
   * The card reads `/tpl/templates.json`; the editor reads `/tpl/templates`.
   * Both answer the same payload, and both are fenced: the list names the
   * user's own templates, which is profile data.
   */
  ctx.effect(() => server.register({
    kind: 'exact',
    path: `${TPL_ROUTE}/templates`,
    handler: (req, res) => {
      if (rejected(req, res, fence)) return
      try {
        sendJson(res, 200, { ok: true, active: '', templates: templates.listTemplates() })
      } catch (error) {
        ctx.logger?.error?.('boot-animation: editor template list route failed', error)
        sendJson(res, 500, { ok: false, error: 'internal' })
      }
    },
  }), 'boot-animation: editor template list route')

  /** One template's data, for the editor's load button. Fenced like the list. */
  ctx.effect(() => server.register({
    kind: 'exact',
    path: `${TPL_ROUTE}/preview-template`,
    handler: (req, res) => {
      void (async () => {
        const match = /[?&]id=([a-z0-9-]+)/i.exec(String(req.url ?? ''))
        const id = match === null ? '' : match[1]
        if (!TEMPLATE_ID_RE.test(id)) {
          sendJson(res, 400, { ok: false, error: '模板名不合法。' })
          return
        }
        // Read first, fence second: a built-in template is package data, and
        // refusing it would make the editor unable to open the templates it
        // ships with. A user template is profile data, and is fenced.
        const template = templates.readTemplate(id)
        if (template === null) {
          sendJson(res, 404, { ok: false, error: '模板不存在。' })
          return
        }
        if (template.__source === 'user' && rejected(req, res, fence)) return
        sendJson(res, 200, { ok: true, template: publicTemplate(template) })
      })().catch((error) => {
        ctx.logger?.error?.('boot-animation: editor preview-template route failed', error)
        if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'internal' })
        else res.end()
      })
    },
  }), 'boot-animation: editor preview-template route')

  /**
   * Store one draft in memory.
   *
   * A draft is a template being previewed, not saved: it lives in this table,
   * capped at twenty entries, and dies with the process. The preview route
   * reads it back by id — the editor's own round trip, so a half-edited
   * template can be watched without being written to disk.
   */
  ctx.effect(() => server.register({
    kind: 'exact',
    path: `${TPL_ROUTE}/editor/draft`,
    handler: (req, res) => {
      void (async () => {
        if (rejected(req, res, fence)) return
        if ((req.method ?? 'GET').toUpperCase() !== 'POST') {
          sendJson(res, 405, { ok: false, error: '这个地址只接受 POST。' })
          return
        }
        let body = null
        try {
          body = JSON.parse(await readBody(req, 16 * 1024 * 1024))
        } catch {
          sendJson(res, 400, { ok: false, error: 'invalid json' })
          return
        }
        const checked = validateTemplate(body?.template ?? body)
        if (!checked.ok) {
          sendJson(res, 400, { ok: false, error: '模板不合法：' + checked.reason })
          return
        }
        const id = 'd' + randomBytes(6).toString('hex')
        editorDrafts.set(id, {
          template: checked.value,
          start: Number.isInteger(body?.start) ? body.start : null,
          count: Number.isInteger(body?.count) && body.count > 0 ? body.count : null,
        })
        while (editorDrafts.size > EDITOR_DRAFT_LIMIT) {
          const oldest = editorDrafts.keys().next()
          if (oldest.done) break
          editorDrafts.delete(oldest.value)
        }
        sendJson(res, 200, { ok: true, id })
      })().catch((error) => {
        ctx.logger?.error?.('boot-animation: editor draft route failed', error)
        if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'internal' })
        else res.end()
      })
    },
  }), 'boot-animation: editor draft route')

  /** Render one draft (or a built-in template) through the runtime. */
  ctx.effect(() => server.register({
    kind: 'exact',
    path: `${TPL_ROUTE}/editor/preview`,
    handler: (req, res) => {
      void (async () => {
        const url = String(req.url ?? '')
        const match = /[?&]id=([a-z0-9]+)/i.exec(url)
        const record = match === null ? null : editorDrafts.get(match[1])
        let template = null
        let jump = null
        if (record !== undefined && record !== null) {
          template = record.template
          if (Number.isInteger(record.start)) {
            jump = { start: record.start, count: record.count === null ? undefined : record.count }
          }
        } else {
          template = templates.readTemplate('archive-warm')
        }
        if (template === null) {
          sendJson(res, 404, { ok: false, error: '没有可预览的模板。' })
          return
        }
        const startMatch = /[?&]start=(\d+)/i.exec(url)
        const countMatch = /[?&]count=(\d+)/i.exec(url)
        if (jump === null && startMatch !== null) {
          jump = { start: parseInt(startMatch[1], 10), count: countMatch === null ? undefined : parseInt(countMatch[1], 10) }
        }
        sendTplText(res, 'text/html; charset=utf-8',
          previewHtml(publicTemplate(template), jump, /[?&]edit=1/.test(url)))
      })().catch((error) => {
        ctx.logger?.error?.('boot-animation: editor preview route failed', error)
        if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'internal' })
        else res.end()
      })
    },
  }), 'boot-animation: editor preview route')

  /**
   * Save one template into the user's directory.
   *
   * Fenced, and the only route in this group that writes a template.json: the
   * write goes to `<userRoot>/<id>/template.json` with a timestamped backup of
   * whatever it replaces, and the id comes from the validated document rather
   * than from the request.
   */
  ctx.effect(() => server.register({
    kind: 'exact',
    path: `${TPL_ROUTE}/templates/save`,
    handler: (req, res) => {
      void (async () => {
        if (rejected(req, res, fence)) return
        if ((req.method ?? 'GET').toUpperCase() !== 'POST') {
          sendJson(res, 405, { ok: false, error: '这个地址只接受 POST。' })
          return
        }
        let body = null
        try {
          body = JSON.parse(await readBody(req, 16 * 1024 * 1024))
        } catch {
          sendJson(res, 400, { ok: false, error: 'invalid json' })
          return
        }
        const checked = validateTemplate(body?.template ?? body)
        if (!checked.ok) {
          sendJson(res, 400, { ok: false, error: '模板不合法：' + checked.reason })
          return
        }
        const file = saveUserTemplate(templates, checked.value)
        if (file === null) {
          sendJson(res, 503, { ok: false, error: '当前 profile 没有可用的模板目录。' })
          return
        }
        sendJson(res, 200, { ok: true, id: checked.value.id, file: file.replace(/\\/g, '/') })
      })().catch((error) => {
        ctx.logger?.error?.('boot-animation: editor save route failed', error)
        if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'internal' })
        else res.end()
      })
    },
  }), 'boot-animation: editor save route')

  /**
   * Upload one asset for a user template.
   *
   * The editor sends base64 in JSON. Both the template id and the file name are
   * whitelisted and the resolved path is containment-checked, so a template can
   * give itself an audio file or an image but not a path.
   */
  ctx.effect(() => server.register({
    kind: 'exact',
    path: `${TPL_ROUTE}/template-assets/upload`,
    handler: (req, res) => {
      void (async () => {
        if (rejected(req, res, fence)) return
        if ((req.method ?? 'GET').toUpperCase() !== 'POST') {
          sendJson(res, 405, { ok: false, error: '这个地址只接受 POST。' })
          return
        }
        let body = null
        try {
          body = JSON.parse(await readBody(req, 12 * 1024 * 1024))
        } catch {
          sendJson(res, 400, { ok: false, error: 'invalid json' })
          return
        }
        const file = saveUserTemplateAsset(templates, String(body?.id ?? ''), String(body?.name ?? ''), String(body?.data ?? ''))
        if (file === null) {
          sendJson(res, 400, { ok: false, error: '素材名不合法或内容为空。' })
          return
        }
        sendJson(res, 200, { ok: true, file: file.replace(/\\/g, '/') })
      })().catch((error) => {
        ctx.logger?.error?.('boot-animation: editor asset upload route failed', error)
        if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'internal' })
        else res.end()
      })
    },
  }), 'boot-animation: editor asset upload route')

  // ── the remote template store ──────────────────────────────────────────────
  //
  // Two routes, both fenced: the index is fetched on the Host side (never the
  // browser, which would need CORS the store does not offer), and an install
  // writes into the user's template directory. What an install may fetch is
  // bounded three ways — one fixed origin, a whitelisted path, and the same
  // validateTemplate the local store applies — so a remote template is held to
  // exactly the same standard as a built-in one.
  //
  // Ported from dsh-boot-suite (MIT, © LeeRolling / 沈宏宏); see CREDITS.md.
  const store = createStoreClient({ indexUrl: process.env.DSH_STORE_URL || undefined })

  /** The store's index, cached, with the last good list on a network failure. */
  ctx.effect(() => server.register({
    kind: 'exact',
    path: `${TPL_ROUTE}/store`,
    handler: (req, res) => {
      void (async () => {
        if (rejected(req, res, fence)) return
        const force = /[?&]refresh=1/.test(String(req.url ?? ''))
        try {
          const list = await store.list(force)
          sendJson(res, 200, { ok: true, repo: store.rawBase, count: list.length, templates: list })
        } catch (error) {
          // A flaky network costs freshness, not the feature: the last good
          // list is answered with ok:false so the card can say so.
          ctx.logger?.warn?.('boot-animation: store index fetch failed: ' + String(error?.message ?? error))
          sendJson(res, 200, {
            ok: false,
            repo: store.rawBase,
            error: '模板商店连不上，显示的是上次读到的列表。',
            templates: store.cached(),
          })
        }
      })()
    },
  }), 'boot-animation: store route')

  /**
   * Install one store template into the user's directory.
   *
   * The document is fetched from the entry's own path, validated, and its id
   * checked against the index entry that named it — an index that points at a
   * different template's document is a mismatch, not an install. Declared
   * assets come with it, each bounded, because a template installed without its
   * audio plays silently.
   */
  ctx.effect(() => server.register({
    kind: 'exact',
    path: `${TPL_ROUTE}/store/install`,
    handler: (req, res) => {
      void (async () => {
        if (rejected(req, res, fence)) return
        if ((req.method ?? 'GET').toUpperCase() !== 'POST') {
          sendJson(res, 405, { ok: false, error: '这个地址只接受 POST。' })
          return
        }
        let payload = {}
        try {
          payload = JSON.parse(await readBody(req, 8 * 1024) || '{}')
        } catch {
          sendJson(res, 400, { ok: false, error: 'invalid json' })
          return
        }
        const id = String(payload?.id ?? '')
        if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) {
          sendJson(res, 400, { ok: false, error: '模板名不合法。' })
          return
        }
        const list = await store.list(false)
        const entry = list.find((candidate) => candidate.id === id)
        if (entry === undefined) {
          sendJson(res, 404, { ok: false, error: '商店里没有这个模板：' + id })
          return
        }
        if (safeStorePath(entry.path) !== entry.path) {
          sendJson(res, 400, { ok: false, error: '商店条目的路径不合法' })
          return
        }
        const template = await store.fetchTemplate(entry.path)
        if (template.id !== id) {
          sendJson(res, 400, { ok: false, error: '模板 id 与索引不一致：' + template.id + ' ≠ ' + id })
          return
        }
        const file = saveUserTemplate(templates, template)
        if (file === null) {
          sendJson(res, 503, { ok: false, error: '当前 profile 没有可用的模板目录。' })
          return
        }
        // The template's declared assets, in index order, each bounded and the
        // whole install capped. A missing asset is reported rather than
        // silently skipped — a template that lost its voice should say so.
        const got = []
        const missing = []
        if (template.assets !== null && typeof template.assets === 'object') {
          const keys = Object.keys(template.assets).slice(0, 24)
          let total = 0
          for (const key of keys) {
            const name = basename(String(template.assets[key] ?? '').replace(/\\/g, '/'))
            const bytes = await store.fetchAsset(entry.path, name)
            if (bytes === null) {
              missing.push(name || key)
              continue
            }
            total += bytes.byteLength
            if (total > STORE_INSTALL_LIMIT) {
              missing.push(name)
              break
            }
            const written = saveUserTemplateAsset(templates, id, name, bytes.toString('base64'))
            if (written === null) {
              missing.push(name)
              continue
            }
            got.push(name)
          }
        }
        sendJson(res, 200, {
          ok: true,
          id,
          assets: got,
          missing,
          from: store.rawBase + '/' + entry.path + '/',
          file: file.replace(/\\/g, '/'),
        })
      })().catch((error) => {
        ctx.logger?.error?.('boot-animation: store install route failed', error)
        if (!res.headersSent) {
          sendJson(res, 500, { ok: false, error: '安装失败：' + String(error?.message ?? error) })
        } else res.end()
      })
    },
  }), 'boot-animation: store install route')

  // `ctx.on` already returns a disposer the fiber tracks, so it is registered
  // directly rather than wrapped in an effect — matching the other subscribers
  // of this event (ui-theme, client-modules, client-connection).
  ctx.on('webserver/index-inject', (table) => {
    const settings = currentSettings()

    // Switched off means switched off: no configuration row, no screen script, no
    // overlay, and not one request for a clip. The kernel's own boot page is what
    // shows. Injecting a disabled screen and making the script bail out would look
    // the same and leave the whole thing running; this is the only version of
    // "off" that is actually off.
    if (!settings.enabled) return

    // The template form, when it can be assembled. A template that cannot be
    // read or validated falls through to the clip screen rather than leaving
    // the boot page with no screen at all — the one outcome this plugin's whole
    // design exists to prevent. The fallback is logged, because a user who
    // chose a template and got a clip deserves to be able to find out why.
    if (settings.form === 'template') {
      const rows = templateRows(templates, settings)
      if (rows !== null) {
        table.push(...rows)
        return
      }
      ctx.logger?.warn?.(
        'boot-animation: template "' + settings.template + '" could not be read or did not '
        + 'validate, so the clip screen is serving this boot instead.',
      )
    }

    // The row reads a plain global the script fills in, so the injection stays
    // JSON-serializable data and the script itself stays a static asset.
    table.push({
      kind: 'script',
      placement: 'head',
      text: `globalThis.__DSH_BOOT_ANIM_CFG__=${JSON.stringify({
        base: ROUTE,
        manifest: `${ROUTE}/clips.json`,
        holdMs: 15000,
        fadeMs: settings.fadeMs,
        enterMode: settings.enterMode,
        sound: settings.sound,
        clickToEnter: settings.clickToEnter,
        showHint: settings.showHint,
      })}`,
    })
    table.push({ kind: 'script', placement: 'head', text: bootScreenSource() })
  })
}

/**
 * The pre-boot screen source, re-read on every index render.
 *
 * Synchronous because the injection table is collected synchronously; the file is
 * a few kilobytes and read once per page load, not per request in a hot path.
 * A missing or unreadable file must not blank the boot page: the caller then
 * serves the kernel page alone, which is the documented fallback.
 * @returns the script text, or an empty string when the source cannot be read.
 */
function bootScreenSource() {
  try {
    return readFileSync(BOOT_SCREEN_PATH, 'utf8')
  } catch (error) {
    process.emitWarning(`boot-animation: cannot read ${BOOT_SCREEN_PATH}: ${String(error)}`)
    return ''
  }
}

// ── the template form's plumbing ─────────────────────────────────────────────
//
// Everything in this section serves the `form: 'template'` screen. The row
// table it builds is the contract with the vendored runtime: the runtime reads
// the globals named here, mounts under the root id, and fetches its own assets
// under TPL_ROUTE. Renaming any of the four is a silent break — nothing on
// either side checks that they agree — which is why they are declared once,
// here, and referenced by name everywhere else.

/** Diagnostic lines the runtime may spend per process. */
const TPL_DIAG_BUDGET = 200
let diagBudget = TPL_DIAG_BUDGET

/**
 * Read one request body as UTF-8 text, bounded.
 *
 * Resolves to '' on a body that never completes rather than rejecting: every
 * caller is a route handler that has already answered or is about to, and a
 * half-read body is not a reason to take the response down with it.
 * @param req - incoming request.
 * @param limit - maximum bytes to accept.
 * @returns the body text, or '' when it is absent, oversized or unreadable.
 */
function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        req.destroy()
        resolve('')
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => resolve(''))
  })
}

/**
 * Serialize one value into a script row safely.
 *
 * The template data is user text: a `</script>` inside a step's copy would end
 * the row early and the rest of the JSON would execute as markup. Escaping `<`
 * and the two line separators is what makes the row inert data, and it is why
 * the template travels as a script row rather than through the index table's
 * own value serialization.
 * @param value - anything JSON-serializable.
 * @returns a JSON literal safe to embed in a script element.
 */
function safeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, '')
}

/** Strip the store's private location fields before the browser sees a template. */
function publicTemplate(template) {
  const { __root, __source, ...published } = template
  return published
}

/**
 * Map this plugin's settings onto the runtime's config shape.
 *
 * The runtime merges whatever it is given over its own DEFAULTS, so only the
 * fields the user can actually set are sent; everything else keeps the
 * runtime's value. `enabled` is always true here — the Host has already decided
 * the screen plays at all, and the runtime's own enabled check is what the
 * bootstrap's off path bypasses.
 * @param settings - the resolved settings.
 * @returns the runtime's config object.
 */
function templateRuntimeConfig(settings) {
  const tpl = settings.tpl
  return {
    enabled: true,
    mode: tpl.mode,
    theme: tpl.theme,
    speed: tpl.speed,
    requireInteraction: tpl.requireInteraction,
    allowSkip: tpl.allowSkip,
    sound: tpl.sound,
    soundVolume: tpl.soundVolume,
    voice: tpl.voice,
    voiceLang: tpl.voiceLang,
    voicePack: tpl.voicePack,
    voiceFx: tpl.voiceFx,
    voiceRate: tpl.voiceRate,
    voicePitch: tpl.voicePitch,
    voiceVolume: tpl.voiceVolume,
    voiceCue: tpl.voiceCue,
    voiceLead: tpl.voiceLead,
    identity: tpl.identity,
    identityId: tpl.identityId,
    accessLevel: tpl.accessLevel,
    accent: tpl.accent,
    glitchA: tpl.glitchA,
    glitchB: tpl.glitchB,
    transitionIn: tpl.transitionIn,
    transitionJoin: tpl.transitionJoin,
    transitionOut: tpl.transitionOut,
    transitionMs: tpl.transitionMs,
    transitionDir: tpl.transitionDir,
    glass: tpl.glass,
    glassOpacity: tpl.glassOpacity,
    glassBlur: tpl.glassBlur,
    glassSaturate: tpl.glassSaturate,
    glassBackdropBlur: tpl.glassBackdropBlur,
    // The music group travels whole: the runtime's own bgm module reads these
    // keys from the config it is handed, and a file name the Host does not
    // forward is a track the runtime never asks for.
    bgmEnabled: tpl.bgmEnabled,
    bgmLoop: tpl.bgmLoop,
    bgmFile: tpl.bgmFile,
    bgmFile2: tpl.bgmFile2,
    bgmVolume: tpl.bgmVolume,
    bgmBpm: tpl.bgmBpm,
    bgmBeats1: tpl.bgmBeats1,
    bgmBeats2: tpl.bgmBeats2,
    bgm1Start: tpl.bgm1Start,
    bgm2Start: tpl.bgm2Start,
    bgm1FadeIn: tpl.bgm1FadeIn,
    bgm1FadeOut: tpl.bgm1FadeOut,
    bgm2FadeIn: tpl.bgm2FadeIn,
    bgm2FadeOut: tpl.bgm2FadeOut,
    bgmCrossfade: tpl.bgmCrossfade,
    bgm2Loop: tpl.bgm2Loop,
    bgmDuck: tpl.bgmDuck,
  }
}

/**
 * The styles the template form needs before anything else loads.
 *
 * Four jobs, in the order they matter: lock scrolling so the app underneath
 * cannot be dragged into view mid-animation; force the boot background black
 * so the first frame is not DSH's white; hide the kernel's own boot card, which
 * would otherwise flash before the overlay exists; and give the mount point its
 * own full-window box so the overlay is positioned before its stylesheet
 * arrives. No backticks anywhere in the blob — the project has already lost one
 * silent build failure to one.
 */
const TPL_CRITICAL_CSS = [
  'html.dsu-lock,html.dsu-lock body{overflow:hidden!important}',
  'html.dsu-lock body{background-color:#000!important}',
  ':root{--dsh-boot-bg:#000}',
  'html.dsu-lock [data-dsh-boot]{display:none!important}',
  `#${TPL_ROOT_ID}.dsu-boot{position:fixed;inset:0;z-index:2147483000;background:#000}`,
].join('')

/**
 * The mount-point bootstrap.
 *
 * Runs before the runtime and decides whether this boot plays the animation at
 * all: the enabled switch, and the session/daily modes that keep a template
 * from replaying on every reload. It also arms the last-resort timer — if the
 * runtime never starts (a blocked request, a syntax error, a route that
 * answered 404), the overlay is removed after nine seconds and the app is let
 * through. The criterion is the runtime's own running flag rather than a class
 * name, because the class is removed the moment the runtime loads.
 *
 * The Windows caption probe is restyled here rather than by the runtime: the
 * desktop preload measures it during DOMContentLoaded, so a style added at
 * mount time is measured too late and the caption keeps the shell's colours for
 * the first frames of the animation.
 */
const TPL_BOOTSTRAP = `(function(){try{
var c=globalThis.__DSH_BOOT_ANIM_TPL_CFG__||{};
var root=document.getElementById('${TPL_ROOT_ID}');
var off=!c.enabled;
if(!off&&c.mode==='session'&&sessionStorage.getItem('dsh-boot-animation:tpl-shown')==='1')off=true;
if(!off&&c.mode==='daily'&&localStorage.getItem('dsh-boot-animation:tpl-day')===new Date().toISOString().slice(0,10))off=true;
if(off){globalThis.__DSH_BOOT_ANIM_TPL_SKIP__=true;if(root&&root.parentNode)root.parentNode.removeChild(root);}
else{
document.documentElement.classList.add('dsu-lock');
document.documentElement.style.overflow='hidden';
if(document.body)document.body.style.overflow='hidden';
if(!document.getElementById('${TPL_ROOT_ID}-caption')){var st=document.createElement('style');st.id='${TPL_ROOT_ID}-caption';st.textContent='body>span[style*="dsw-specific-sidebar-fill"]{background-color:rgba(0,0,0,0)!important;color:#e8f2fb!important}';document.head.appendChild(st);}
setTimeout(function(){try{
if(globalThis.__DSH_BOOT_ANIM_TPL_RUNNING__===true)return;
var r=document.getElementById('${TPL_ROOT_ID}');
if(r&&r.parentNode)r.parentNode.removeChild(r);
document.documentElement.classList.remove('dsu-lock');
if(document.body)document.body.style.overflow='';
globalThis.__DSH_BOOT_ANIM_TPL_FAILED__=true;
}catch(e){}},9000);}
}catch(e){}})()`

/**
 * Build the injection rows for the template form.
 *
 * Returns null when the first act cannot be read or validated — the caller then
 * serves the clip screen instead, because a boot page with no screen is the one
 * outcome this plugin exists to prevent. A second act that is missing is not a
 * failure: the runtime treats an absent second template as "play none", which
 * is what a user who cleared the field asked for.
 *
 * The row order is the contract. The configuration and template globals must be
 * set before the runtime runs, the runtime must run before the shell module so
 * it owns the viewport first, and the stylesheet link must be in the head so
 * the overlay is styled from its first frame.
 * @param store - the template store.
 * @param settings - the resolved settings.
 * @returns the rows, or null when the first act is unavailable.
 */
function templateRows(store, settings) {
  const first = store.readTemplate(settings.template)
  if (first === null) return null
  const second = settings.template2 === '' ? null : store.readTemplate(settings.template2)

  const rows = [
    // The first-frame styles, then the runtime's stylesheet. Both before any
    // script, so the overlay is never unstyled.
    { kind: 'style', text: TPL_CRITICAL_CSS },
    { kind: 'html', placement: 'head', html: `<link rel="stylesheet" href="${TPL_ROUTE}/splash.css">` },
    // The route prefix first: the runtime reads it to build its own asset URLs,
    // and a page that somehow loads the runtime without it falls back to this
    // package's own prefix anyway.
    { kind: 'script', placement: 'head', text: `globalThis.__DSH_BOOT_ANIM_TPL_BASE__=${safeJson(TPL_ROUTE)}` },
    { kind: 'script', placement: 'head', text: `globalThis.__DSH_BOOT_ANIM_TPL_CFG__=${safeJson(templateRuntimeConfig(settings))}` },
    { kind: 'script', placement: 'head', text: `globalThis.__DSH_BOOT_ANIM_TPL_1__=${safeJson(publicTemplate(first))}` },
  ]
  if (second !== null) {
    rows.push({ kind: 'script', placement: 'head', text: `globalThis.__DSH_BOOT_ANIM_TPL_2__=${safeJson(publicTemplate(second))}` })
  }
  rows.push(
    // The mount point, the bootstrap that decides whether to play, then the
    // runtime. `script-src` rather than a script tag inside an html row,
    // because the desktop build renders html rows as text and never executes
    // the tags inside them — the runtime would simply never run.
    { kind: 'html', placement: 'body', html: `<div id="${TPL_ROOT_ID}" class="dsu-root dsu-boot"></div>` },
    { kind: 'script', placement: 'body', text: TPL_BOOTSTRAP },
    { kind: 'script-preload', src: `${TPL_ROUTE}/splash.js` },
    { kind: 'script-src', placement: 'body', src: `${TPL_ROUTE}/splash.js` },
  )
  return rows
}

/**
 * Stream one file from a template's own directory.
 *
 * The store has already whitelisted the extension and proved containment, so
 * this answers what it is handed — with two exceptions that are about the
 * RESPONSE rather than the file. An html document from a user template is
 * sandboxed and given a CSP that allows nothing but its own token origin: the
 * template is a document this package did not write, and loading it with DSH's
 * privileges would hand it the user's session. An svg gets the same treatment
 * when opened as a document, because an svg can carry script.
 * @param res - outgoing response.
 * @param file - absolute path, already contained.
 * @param rel - the template-relative path, for the extension.
 * @param untrusted - true when the template came from the user's directory.
 * @param req - incoming request, for the host the CSP names.
 */
async function sendTemplateFile(res, file, rel, untrusted, req) {
  const extension = rel.slice(rel.lastIndexOf('.')).toLowerCase()
  const type = TEMPLATE_FILE_TYPES[extension] ?? 'application/octet-stream'
  const bytes = await readFile(file)
  const headers = {
    'content-type': type,
    'content-length': String(bytes.byteLength),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  }
  if (extension === '.svg') {
    // As a document an svg executes its scripts; as an <img> source it does
    // not, and that is the only way a template is meant to use one.
    headers['content-security-policy'] = "default-src 'none'; style-src 'unsafe-inline'; img-src data:"
  }
  if (untrusted && extension === '.html') {
    // The frame's origin, derived from the request rather than assumed: a
    // Host header that is not a plain host:port cannot name an origin, and the
    // answer to that is a CSP that allows no origin at all.
    const host = String(req?.headers?.host ?? '')
    const origin = /^[A-Za-z0-9._\-:[\]]+$/.test(host)
      ? `${req?.socket?.encrypted ? 'https://' : 'http://'}${host}`
      : "'none'"
    headers['content-security-policy'] = "default-src 'none'; script-src 'unsafe-inline' " + origin
      + "; style-src 'unsafe-inline' " + origin
      + "; img-src " + origin + ' data: blob:'
      + '; media-src ' + origin + ' data: blob:'
      + '; font-src ' + origin + ' data:'
      + "; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri " + origin
  }
  if ((req.method ?? 'GET').toUpperCase() === 'HEAD') {
    res.writeHead(200, headers)
    res.end()
    return
  }
  res.writeHead(200, headers)
  res.end(bytes)
}

// ── the template editor ──────────────────────────────────────────────────────
//
// The editor is a vendored static page (assets/editor/editor.html, generated by
// tools/vendor-editor.mjs) that edits a template as JSON and previews it
// through this same runtime. What the Host provides is the six routes its code
// calls, a small in-memory draft table, and the two write paths — saving a
// template and uploading an asset — both of which land in the USER's template
// directory and nowhere else.
//
// Ported from dsh-boot-suite (MIT, © LeeRolling / 沈宏宏); see CREDITS.md.

/** Editor drafts, in memory: a draft is a template being previewed, not saved. */
const editorDrafts = new Map()
const EDITOR_DRAFT_LIMIT = 20

/**
 * The editor's preview page: the runtime, the template, and nothing else.
 *
 * The template under edit travels as a global — the same contract the boot
 * injection uses — so what the editor previews is what a real boot plays.
 * `jump` starts mid-sequence (the editor's per-scene play button) and `edit`
 * tells the runtime it is being watched rather than booted.
 * @param tpl - the validated template.
 * @param jump - `{ start, count }`, or null.
 * @param edit - true when the editor asked for the edit variant.
 * @returns the page HTML.
 */
function previewHtml(tpl, jump, edit) {
  const safe = safeJson(tpl)
  const jumpJs = jump !== null && typeof jump.start === 'number'
    ? 'window.__DSH_BOOT_ANIM_TPL_JUMP__=' + safeJson({
        start: Math.max(0, Math.min(23, jump.start | 0)),
        count: typeof jump.count === 'number' && jump.count > 0 ? Math.min(24, jump.count | 0) : undefined,
      }) + ';'
    : ''
  const editJs = edit === true ? 'window.__DSH_BOOT_ANIM_TPL_EDIT__=1;' : ''
  const jumpTag = jump !== null && typeof jump.start === 'number'
    ? 'jump:' + String(jump.start) + ':' + (jump.count === undefined ? '-' : String(jump.count))
    : 'jump:-'
  // A fixed runtime config, not the user's: the editor previews the TEMPLATE,
  // and the settings the card holds would answer a different question.
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
    + '<title>' + jumpTag + '</title>'
    + '<link rel="stylesheet" href="' + TPL_ROUTE + '/splash.css">'
    + '<style>html.dsu-lock,html.dsu-lock body{overflow:hidden!important}'
    + '#' + TPL_ROOT_ID + '.dsu-boot{position:fixed;inset:0;z-index:2147483000;background:#000}'
    + '.dsu-skip,.dsu-hint{display:none!important}body{margin:0}</style></head><body>'
    + '<div id="' + TPL_ROOT_ID + '" class="dsu-root dsu-boot"></div>'
    + '<script>window.__DSH_BOOT_ANIM_TPL_BASE__=' + safeJson(TPL_ROUTE) + ';'
    + 'window.__DSH_BOOT_ANIM_TPL_CFG__=' + safeJson({
      enabled: true, mode: 'always', theme: 'light', speed: 1,
      requireInteraction: false, allowSkip: false, sound: false, voice: false,
      identity: 'JOYCE MOORE', identityId: '0087', accessLevel: '3',
      accent: '#ff7500', glitchA: '#ff3b30', glitchB: '#2971b8',
    }) + ';'
    + 'window.__DSH_BOOT_ANIM_TPL_1__=' + safe + ';' + jumpJs + editJs + '</script>'
    + '<script src="' + TPL_ROUTE + '/splash.js"></script></body></html>'
}

/**
 * Write one template into the user's template directory.
 *
 * Backed up first: the previous file is copied to `backups/template-<stamp>.json`
 * and the oldest beyond thirty are dropped, so an edit that goes wrong is one
 * file away from being undone. A write that cannot be backed up still writes —
 * losing the new version is worse than losing the old one's copy.
 * @param store - the template store, for its user root.
 * @param template - the validated template.
 * @returns the written file path, or null when there is no user directory.
 */
function saveUserTemplate(store, template) {
  const root = store.userRoot
  if (root === '') return null
  const dir = join(root, template.id)
  const file = join(dir, 'template.json')
  mkdirSync(dir, { recursive: true })
  try {
    if (existsSync(file)) {
      const backupDir = join(dir, 'backups')
      mkdirSync(backupDir, { recursive: true })
      const info = statSync(file)
      const when = new Date(info.mtimeMs || Date.now())
      const pad = (value) => String(value).padStart(2, '0')
      const stamp = String(when.getFullYear()) + pad(when.getMonth() + 1) + pad(when.getDate())
        + '-' + pad(when.getHours()) + pad(when.getMinutes()) + pad(when.getSeconds())
      copyFileSync(file, join(backupDir, 'template-' + stamp + '.json'))
      const olds = readdirSync(backupDir).filter((name) => name.startsWith('template-')).sort()
      while (olds.length > 30) {
        try {
          unlinkSync(join(backupDir, olds.shift()))
        } catch {
          /* a backup that will not delete is not worth failing the save over */
        }
      }
    }
  } catch {
    // A backup that cannot be made must not cost the user their edit.
  }
  writeFileSync(file, JSON.stringify(template, null, 2) + '\n', 'utf8')
  return file
}

/**
 * Write one asset into a user template's assets/ directory.
 *
 * The body arrives as base64 in JSON (the editor's own transport). Both the
 * template id and the file name are whitelisted, and the resolved path is
 * containment-checked before anything is written — a template id that passed
 * the whitelist is still a path segment.
 * @param store - the template store, for its user root.
 * @param id - template id.
 * @param name - asset file name.
 * @param base64 - the file body.
 * @returns the written file path, or null when it does not resolve inside.
 */
function saveUserTemplateAsset(store, id, name, base64) {
  const root = store.userRoot
  if (root === '' || !TEMPLATE_ID_RE.test(id)) return null
  if (typeof name !== 'string' || !ASSET_FILE_RE.test(name) || name.includes('..')) return null
  const dir = join(root, id, 'assets')
  const file = join(dir, name)
  // The directory is created BEFORE the containment check, not after: the
  // check realpaths both sides, and a directory that does not exist yet cannot
  // be realpath'd — which would refuse every first asset of a new template.
  // The mkdir is safe on its own: the root is the user template directory, the
  // id has passed its whitelist, and 'assets' is a literal segment.
  mkdirSync(dir, { recursive: true })
  // Containment is proven on what EXISTS: the file itself is new, so realpath
  // cannot resolve it — but the directory can, and the name is a whitelisted
  // single segment (no separators are in its alphabet), so a file joined onto
  // a contained directory is contained by construction.
  if (!isFileInsideRoot(dir, join(root, id))) return null
  let bytes
  try {
    bytes = Buffer.from(base64, 'base64')
  } catch {
    return null
  }
  if (bytes.byteLength === 0 || bytes.byteLength > 8 * 1024 * 1024) return null
  writeFileSync(file, bytes)
  return file
}
