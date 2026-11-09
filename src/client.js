// dsh-boot-animation — browser half.
//
// Two jobs, in this order and with this priority:
//
//   1. Report the browser roster's activation to the injected pre-boot screen
//      (`clientReady`). That call is part of the screen's hand-off condition, so
//      it happens first, unconditionally, and cannot be delayed or prevented by
//      anything below it.
//   2. Contribute the settings card to the Plugins settings page.
//
// Everything about job 2 is optional by construction. This package does not
// declare `inject`, because a required service would leave the fiber PENDING in
// a profile that lacks it — and then job 1 would never run, the screen would
// never learn the kernel is ready, and the animation would sit there refusing to
// hand over. The services are therefore reached with the dynamic
// `ctx.inject(deps, callback)` form, which waits for them without gating `apply`:
// the callback fires once both arrive, and simply never fires if they do not.
//
// NOT `ctx.get(name)`. That was the first attempt and it silently found nothing
// in this deployment: `dsh-boot-animation` was the only client bundle in the whole
// profile reaching for `ctx.get('slots')` and `ctx.get('settingsScope')`, while
// every other plugin — dsh-image-gen, git-graph, genui, better-sidebar, and the
// harness's own packages — uses exactly the `ctx.inject` form below, and reads the
// awaited services with `owner.get(name)`. A missing service read as
// "unavailable", the registration was skipped without a word, and the card never
// appeared. `verify-client-bundle.mjs` now fails if this file goes back to it.
//
// Bundle artifact contract: the shell materializes this file as a closure
// factory (`window.__ModuleLoader__.load({ id, factory })`), so `require` is a
// parameter supplied by the shell's module table. `react` is one of the baseline
// modules every dynamic bundle may request (packages/client/web/src/platform.ts),
// so asking for it needs no declaration in package.json.

const OVERLAY = '__DSH_BOOT_ANIM__'

/** Settings namespace the Host half registers; also this card's slot key. */
const SETTINGS_NAMESPACE = 'boot-animation'

/**
 * The Plugins settings page dispatches cards by slot name. It was
 * `settings.plugin.item` in the API this plugin was first written against, and
 * `plugins.item` in the builds this card was written for (verified against
 * 0.2.0-rc.2).
 *
 * 0.2.2-rc.1 kept that slot but repurposed it: `plugins.item` entries are the
 * page's *built-in feature* group (子智能体 / 网页搜索 / Agent 循环 …), and a
 * third-party bundle's own configuration moved to two KEYED slots the package
 * page renders — `plugins.bundle.config` for the bundle's section, and
 * `plugins.row.config` for each row's 配置 page. Both are looked up by key:
 * the bundle's package name, and `<package name>#<row id>`.
 *
 * That is a discoverability break, not a cosmetic one: a card registered only
 * in `plugins.item` still renders — under 内置插件配置, beside the kernel's own
 * pages — while the plugin's OWN page, which is where a user opens the plugin
 * to configure it, shows no configuration section at all.
 */
const SLOT = 'plugins.item'

/** The package page's configuration section, keyed by the bundle's name. */
const BUNDLE_SLOT = 'plugins.bundle.config'

/** One row's configuration page, keyed by `<bundle>#<row id>`. */
const ROW_SLOT = 'plugins.row.config'

/**
 * This package's own name, which is the key the plugin manager looks the
 * bundle section up with (it matches `pkg.name` from the Host inventory).
 *
 * `build-client.mjs` asserts it equals `package.json`'s `name`, so a fork that
 * renames the package cannot ship a card keyed to a bundle nobody installed.
 */
const BUNDLE_NAME = '@ljwei-stak/dsh-boot-animation'

/** Client dictionary namespace this card's tab label is read from. */
const LOCALE_NAMESPACE = 'bootAnimation'

/** Tab label, in the two dictionaries the locale service takes. */
const DICTIONARY_ZH = { title: '启动动画' }

/** English half of the same dictionary. */
const DICTIONARY_EN = { title: 'Boot animation' }

/** Where the clip pool is published, relative to the page. */
const MANIFEST = '/plugins/dsh-boot-animation/clips.json'

/**
 * Where one clip's index table is moved to the front of its file.
 *
 * The file name travels in the query string rather than a body: the Host's own
 * handler is handed the raw request, and a query parameter needs no body parsing
 * to be certain of.
 */
const OPTIMIZE = '/plugins/dsh-boot-animation/optimize'

/** Offered dissolve lengths, in milliseconds. */
const FADE_CHOICES = [1000, 1500, 2000, 3000, 4000]

/** The three hand-off styles, with the sentence that explains each one. */
const ENTER_MODES = [
  ['tail', '片尾交叉溶解', '片尾开始溶解，影片放完时正好进界面'],
  ['end', '放完再淡', '影片完全静止在最后一帧，再淡出'],
  ['click', '点击才进', '循环播放，直到你点一下进入'],
]

/**
 * The three behaviour switches, in card order.
 *
 * Each entry is the field name, its label, and the pair of sentences under it —
 * the one for "on" and the one for "off" — because a switch whose explanation
 * does not change with its state is the reason people leave it alone.
 */
const BEHAVIOUR = [
  ['sound', '播放影片声音',
    '影片尝试带声音播放，右下角有一个开声音的按钮',
    '已彻底静音：不会尝试开声音，声音按钮也不再出现'],
  ['clickToEnter', '点鼠标直接进入',
    '按一下画面就直接进入界面，不再用第一下开声音',
    '按一下先开声音，再按一下才进入（默认）'],
  ['showHint', '显示底部提示文字',
    '画面底部显示「点击进入」这类操作提示',
    '底部不再显示操作提示，标题和进度条保留'],
]

/**
 * The two screen forms, in the order the card presents them.
 *
 * `video` is this package's original full-window clip; `template` hands the
 * boot page to the data-driven runtime under assets/splash/. The sentence under
 * each button says what choosing it MEANS, because the two forms share no
 * controls at all and a user who picks the wrong one should learn that from the
 * card rather than from a boot that looks nothing like the settings they left.
 */
const SCREEN_FORMS = [
  ['video', '影片', '满屏播放一段视频，播完交叉溶解进界面（原有形式）'],
  ['template', '模板动画', '播放模板数据驱动的动画：分幕、时间线或整页 iframe，来自 dsh-boot-suite 模板格式'],
]

/**
 * The template form's settings, with the same defaults the Host declares.
 *
 * Duplicated here on purpose. The card shows a control for every field even
 * before the settings document has been read, and a control bound to undefined
 * renders as blank — so the defaults are the card's own copy, kept identical to
 * the Host's TPL_DEFAULTS. verify-entry.mjs asserts the Host's half.
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

/** Route prefix the template form's assets live under — the Host's own. */
const TPL_ROUTE = '/plugins/dsh-boot-animation/tpl'

/** The event the runtime dispatches when a template run finishes or is skipped. */
const TPL_DONE_EVENT = 'dsh-boot-animation:tpl-done'

/** The caption-probe style the bootstrap installs; a preview re-installs it. */
const TPL_CAPTION_ID = 'dsh-boot-anim-tpl-caption'

/** Playback speeds, as multipliers. */
const TPL_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]

/** How often the template plays at all. */
const TPL_MODES = [
  ['always', '每次打开'],
  ['session', '每次会话'],
  ['daily', '每天一次'],
]

/** The template's light/dark版式. */
const TPL_THEMES = [['light', '亮色'], ['dark', '暗色']]

/** Voice languages and effects the vendored runtime understands. */
const TPL_VOICE_LANGS = [['en', '英语'], ['zh', '中文'], ['both', '中英']]
const TPL_VOICE_FX = [['none', '原声'], ['ai-mech', 'AI 机械'], ['robot', '机器人'], ['radio', '无线电'], ['oldtv', '老电视'], ['dark', '低沉']]

/** The three transition points, and the types each accepts. */
const TPL_TRANSITION_POINTS = [['transitionIn', '入场'], ['transitionJoin', '两幕之间'], ['transitionOut', '退场']]
const TPL_TRANSITIONS = [
  ['dissolve', '叠化'], ['flash', '闪白'], ['glitch', '故障'], ['scanline', '扫描线'],
  ['slide', '滑移'], ['iris', '圆形拉开'], ['black', '黑场'], ['none', '硬切'],
]

/** Stable empty snapshot, so `getSnapshot` never returns a fresh object. */
const NO_SNAPSHOT = Object.freeze({
  status: 'unavailable', value: undefined, base: undefined, user: undefined,
  revision: undefined, writable: false, mode: 'host',
})

const STYLE_ID = 'dsh-boot-animation-card-style'

// No backticks in this sheet: it is a plain string, but the surrounding project
// convention is that a stray backtick in a CSS blob has already cost this plugin
// one silent build failure.
//
// The token names and the geometry are copied from the harness's own plugin card
// (ui-settings-plugins/src/client/PluginCard.module.css) so this card reads as a
// shipped one rather than a guest: same border, radius, layer colours, header
// metrics and chevron motion. Each token keeps a literal fallback for a page that
// has no theme loaded.
const CSS = [
  '.dshba-card{list-style:none;border:.5px solid var(--dsw-alias-border-l4,rgba(127,127,127,.28));',
  'border-radius:16px;background:var(--dsw-alias-bg-layer-3,transparent);',
  'transition:border-color .16s,background .16s;font-family:inherit}',
  '.dshba-card:hover{border-color:var(--dsw-alias-label-dimmed,rgba(127,127,127,.5))}',
  '.dshba-card[data-open="1"]{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.07));',
  'border-color:var(--dsw-alias-label-dimmed,rgba(127,127,127,.5))}',
  '.dshba-head{width:100%;appearance:none;border:0;background:none;font:inherit;color:inherit;',
  'text-align:left;cursor:pointer;display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:12px}',
  '.dshba-head:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4f9dd9);outline-offset:-2px}',
  '.dshba-headtext{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}',
  '.dshba-name{font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary,inherit)}',
  '.dshba-desc{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.9))}',
  '.dshba-chev{flex:none;width:7px;height:7px;margin-right:3px;',
  'border-right:1.5px solid var(--dsw-alias-label-tertiary,rgba(127,127,127,.9));',
  'border-bottom:1.5px solid var(--dsw-alias-label-tertiary,rgba(127,127,127,.9));',
  'transform:rotate(45deg);transition:transform .16s}',
  '.dshba-card[data-open="1"] .dshba-chev{transform:rotate(225deg)}',
  '.dshba-body{border-top:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));',
  'margin:0 16px;padding:14px 0 10px}',
  '.dshba-sec{margin:0 0 18px}',
  '.dshba-sec:last-child{margin-bottom:4px}',
  '.dshba-h{font-size:13px;font-weight:600;line-height:1.5;margin:0 0 3px;',
  'color:var(--dsw-alias-label-primary,inherit)}',
  '.dshba-p{margin:0 0 10px;font-size:12px;line-height:1.5;',
  'color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.9))}',
  '.dshba-row{display:flex;flex-wrap:wrap;gap:6px}',
  '.dshba-switch{display:inline-flex;align-items:center;gap:9px;cursor:pointer}',
  '.dshba-switch input{margin:0;flex:none}',
  '.dshba-opt{border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.34));background:none;',
  'color:inherit;border-radius:8px;padding:5px 12px;font:inherit;font-size:12.5px;cursor:pointer}',
  '.dshba-opt:hover:not(:disabled){background:rgba(127,127,127,.14)}',
  '.dshba-opt[data-on="1"]{border-color:var(--dsw-alias-brand-primary,#07974b);',
  'color:var(--dsw-alias-brand-primary,#07974b);font-weight:600;background:rgba(7,193,96,.1)}',
  '.dshba-opt:disabled{opacity:.45;cursor:default}',
  '.dshba-clip{display:flex;align-items:center;flex-wrap:wrap;gap:9px;padding:6px 2px;border-radius:8px}',
  '.dshba-clip input{margin:0;flex:none}',
  '.dshba-nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dshba-badge{font-size:11px;line-height:1.5;padding:1px 7px;border-radius:999px;white-space:nowrap;',
  'background:rgba(127,127,127,.18);color:var(--dsw-alias-label-secondary,rgba(127,127,127,.95))}',
  '.dshba-badge.warn{background:rgba(210,120,40,.18);color:#b46214}',
  '.dshba-badge.bad{background:rgba(210,74,67,.18);color:#d24a43}',
  '.dshba-badge.ok{background:rgba(7,150,90,.18);color:#07974b}',
  '.dshba-clipline{display:flex;align-items:center;gap:9px;flex:1;min-width:0;cursor:pointer}',
  '.dshba-mini{flex:none;padding:3px 10px;font-size:11.5px}',
  '.dshba-meta{font-size:11.5px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.8));white-space:nowrap}',
  '.dshba-msg{margin-top:8px;font-size:11.5px;line-height:1.5;',
  'color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.8))}',
  '.dshba-msg.err{color:var(--dsw-alias-label-error,#d24a43)}',
  // The template editor overlay. A CENTRED DIALOG with a top gap, not a
  // full-bleed layer: the desktop build draws its own minimise / maximise /
  // close buttons OVER the page's top-right corner, so an overlay at `inset: 0`
  // put this card's 关闭 button underneath them — reported as "退出按钮和 DSH 的
  // 关闭重合了". The gap is padding on the shell, so it holds on every platform
  // whatever height that strip is.
  '.dshba-editorshell{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:stretch;',
  'justify-content:center;padding:46px 26px 26px;background:rgba(8,10,13,.62);',
  'backdrop-filter:blur(3px);overscroll-behavior:contain}',
  '.dshba-editor{display:flex;flex-direction:column;width:100%;max-width:1560px;min-height:0;',
  'border-radius:14px;overflow:hidden;border:.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.4));',
  'background:var(--dsw-alias-bg-layer-1,#101418);color:var(--dsw-alias-label-primary,#eee);',
  'box-shadow:0 24px 64px rgba(0,0,0,.5)}',
  '.dshba-editorbar{display:flex;align-items:center;gap:12px;padding:9px 12px;flex:none;',
  'border-bottom:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.34))}',
  '.dshba-editortitle{flex:none;font-size:13px;font-weight:600}',
  '.dshba-editorsub{flex:1;min-width:0;font-size:11.5px;overflow:hidden;text-overflow:ellipsis;',
  'white-space:nowrap;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.85))}',
  '.dshba-editorframe{flex:1;min-height:0;width:100%;border:0;background:#0b0e12}',
  // The template form's controls: a native select and a native range, dressed
  // with the same tokens as the option buttons so the two forms read as one
  // card. No backticks anywhere in this sheet — see the note above.
  '.dshba-sel{box-sizing:border-box;max-width:100%;font:inherit;font-size:12.5px;color:inherit;',
  'background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.07));',
  'border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.34));border-radius:8px;padding:5px 8px}',
  '.dshba-sel:disabled{opacity:.45;cursor:default}',
  '.dshba-color{inline-size:38px;block-size:26px;padding:0;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.34));',
  'border-radius:8px;background:none;cursor:pointer;vertical-align:middle}',
  '.dshba-range{flex:1;min-width:120px;accent-color:var(--dsw-alias-brand-primary,#07974b)}',
  '.dshba-inline{display:flex;align-items:center;gap:9px;flex-wrap:wrap}',
  '.dshba-val{font-size:11.5px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.8));white-space:nowrap}',
].join('')

/**
 * Install the card's stylesheet, and keep it current.
 *
 * The style element is reused by id, but its TEXT is rewritten whenever it
 * differs. Returning early on "a node with that id exists" is what made an
 * updated card render with the PREVIOUS stylesheet after the shell swapped the
 * client module under a live page: the new markup, the old rules, and a user
 * saying "还是没有改进" about a fix that was already shipping. Writing the same
 * text twice is free; keeping a stale one is not.
 */
function ensureStyle() {
  let style = document.getElementById(STYLE_ID)
  if (style === null) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)
  }
  if (style.textContent !== CSS) style.textContent = CSS
}

/** Human-readable byte count. */
function formatBytes(value) {
  if (typeof value !== 'number' || !isFinite(value) || value <= 0) return '-'
  if (value < 1024) return String(value) + ' B'
  if (value < 1024 * 1024) return (value / 1024).toFixed(0) + ' KB'
  return (value / 1024 / 1024).toFixed(2) + ' MB'
}

/** Human-readable clip length, or a status word while it is unknown. */
function formatDuration(seconds) {
  if (typeof seconds !== 'number' || !isFinite(seconds)) return '…'
  return seconds.toFixed(2) + 's'
}

/**
 * The Plugins page asks every `plugins.item` entry twice: `view: "summary"` for
 * the row's one-liner and `view: "page"` for the configuration section.
 *
 * They are two COMPONENTS rather than two branches of one, because the summary
 * answer uses no hooks at all and the page answer uses nine. One component that
 * returned early for the summary view would call a different number of hooks
 * depending on its props — a conditional hook call. React throws on that the
 * moment one instance is rendered with the other view, and what a user sees then
 * is a card that is present but dead: the page's own error boundary unmounts the
 * subtree, and every control inside stops responding.
 */

/**
 * The summary answer: one line, as a string.
 *
 * The page puts it inside a clamped `<span class="cardDesc">`
 * (-webkit-line-clamp:1) on the list and inside a `<p>` on the detail page, so
 * returning the card element here nested an `<li>` inside that span/p — invalid
 * list markup, clipped to one line. The three shipped pages (web-search,
 * agent-loop, shell) all answer this view with one line; this is the same
 * sentence the card's own header carries.
 * @returns the one-line description.
 */
function BootAnimationSummary() {
  return '影片或模板动画、声音、进入方式与素材池'
}

/**
 * The registered entry: pick the shape the page asked for.
 *
 * A component of its own, with no hooks, so that neither branch can change the
 * hook count of the other. Registering `BootAnimationCard` directly would make
 * that component call eight hooks for the page view and one for the summary view
 * — a conditional hook call, which React rejects the moment one instance is
 * rendered with the other view. What a user sees when that happens is a card
 * that is present but dead: the page's own error boundary unmounts the subtree
 * and every control inside it stops responding.
 * @param props - the slot's inject face plus the page's owner props.
 * @returns the card, or the one-line summary.
 */
function BootAnimationEntry(props) {
  return props.view === 'summary'
    ? BootAnimationSummary()
    : BootAnimationCard(props)
}

/**
 * The page's own configuration form, as an observable the card can read.
 *
 * The Plugins page hands every `plugins.item` entry a `form` prop — `{ state,
 * mutate }`, the same face the shipped configuration pages consume — in addition
 * to whatever the entry's own inject face returns. Reaching for it first is what
 * makes the controls work: on the desktop build this is the channel the kernel
 * actually wires up, and a card that writes only through `configForms` produces
 * exactly the symptom this one had — a card that renders, opens, closes, and
 * whose every setting control does nothing at all, with no error anywhere.
 *
 * Reads need a subscribe/getSnapshot pair for `useSyncExternalStore`. The page's
 * `state` is a snapshot at render time, so a form that cannot be observed falls
 * back to the injected scope, which always can. The write path needs `mutate`.
 * @param props - the slot's inject face plus the page's owner props.
 * @returns the reader/writer pair for this card.
 */
function cardForm(props) {
  const pageForm = props.form
  const scope = props.scope
  const observable = pageForm !== undefined && pageForm !== null
    && typeof pageForm.subscribe === 'function' && typeof pageForm.getSnapshot === 'function'
  const observableScope = scope !== undefined && scope !== null
    && typeof scope.subscribe === 'function' && typeof scope.getSnapshot === 'function'

  // The page's own form first, then the injected scope, then the page's static
  // snapshot: the first two can be observed, the third cannot, and a card with no
  // events at all still renders its current values instead of nothing.
  const source = observable ? pageForm : (observableScope ? scope : null)
  let fallback = NO_SNAPSHOT
  if (pageForm !== undefined && pageForm !== null && pageForm.state !== undefined) fallback = pageForm.state
  else if (scope !== undefined && scope !== null && typeof scope.getSnapshot === 'function') fallback = scope.getSnapshot()
  else if (observableScope) fallback = scope.getSnapshot()

  const mutate = (() => {
    if (pageForm !== undefined && pageForm !== null && typeof pageForm.mutate === 'function') {
      return (ops, revision) => pageForm.mutate(ops, revision)
    }
    if (scope !== undefined && scope !== null && typeof scope.mutate === 'function') {
      return (ops, revision) => scope.mutate(ops, revision)
    }
    return null
  })()

  // The RPC itself, reached directly when the form does not expose it. The kernel's
  // `mutate` answers `false` for every rejected write and swallows the reason, so
  // the only way to tell a stale-revision conflict from a refused operation is to
  // issue the same call and read the remote failure. `undefined` when this bundle
  // cannot see the service, in which case the card reports what it can.
  const remoteMutate = (() => {
    const remote = props.remote
    const settings = remote !== undefined && remote !== null ? remote.settings : undefined
    if (settings !== undefined && settings !== null && typeof settings.mutate === 'function') {
      return (namespace, ops, revision) => settings.mutate(namespace, ops, revision)
    }
    return null
  })()

  return { source, fallback, mutate, remoteMutate }
}

/**
 * The card.
 *
 * Collapsed by default, like every other card on this page: the Plugins section
 * is a list of plugins, and one that unfolds its controls on arrival pushes
 * everything below it out of view. Disclosure is card-local state — which card a
 * user has open is a reading gesture that neither the Host nor the section has
 * any stake in.
 *
 * Reads ride an observable source (see `cardForm`), whose snapshot reference is
 * stable until the fact moves, which is the contract React needs. The
 * subscription is taken directly with `useSyncExternalStore` rather than through
 * the renderer's `use<Name>` binding, because a package outside this repository
 * cannot depend on that binding existing for it.
 * @param props - the slot's inject face plus the page's owner props.
 * @returns the card element.
 */
function BootAnimationCard(props) {
  const React = props.runtime
  const [open, setOpen] = React.useState(false)
  const [pool, setPool] = React.useState(null)
  const [lengths, setLengths] = React.useState({})
  const [failure, setFailure] = React.useState(null)
  const [saving, setBusy] = React.useState(false)
  const [operation, setOperation] = React.useState(null)
  const [notice, setNotice] = React.useState(null)
  const alive = React.useRef(true)
  const operationLock = React.useRef(false)
  React.useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  const busy = saving || operation !== null
  // Per-clip rewrite state, keyed by file name: absent means untouched, 'busy'
  // while the Host is working, 'done' once the file in the pool is the rewritten
  // one, 'error' when it refused and the row should stay pressable.
  const [fixing, setFixing] = React.useState({})
  // The clip whose full-screen preview is on screen right now, or null. A preview
  // covers the whole page, so this is what tells the card to stop offering another
  // one — and what the overlay's own `onDone` clears.
  const [previewing, setPreviewing] = React.useState(null)

  ensureStyle()

  const form = cardForm(props)
  const source = form.source
  const subscribe = React.useCallback(
    (listener) => (source === null ? function () {} : source.subscribe(listener)),
    [source],
  )
  const readSnapshot = React.useCallback(
    () => (source === null ? form.fallback : source.getSnapshot()),
    [source, form.fallback],
  )
  const snapshot = React.useSyncExternalStore(subscribe, readSnapshot)
  const writable = form.mutate !== null && snapshot?.writable !== false && snapshot?.status !== 'unavailable'
  const stored = (snapshot && snapshot.value) || {}
  const enabled = stored.enabled !== false
  const fadeMs = typeof stored.fadeMs === 'number' ? stored.fadeMs : 2000
  const enterMode = typeof stored.enterMode === 'string' ? stored.enterMode : 'tail'
  const disabled = Array.isArray(stored.disabledClips) ? stored.disabledClips : []
  // Each switch is read the way the Host reads it: absent means the documented
  // default, so a profile written before these fields existed renders them on.
  const sound = stored.sound !== false
  const clickToEnter = stored.clickToEnter === true
  const showHint = stored.showHint !== false
  const behaviour = { sound, clickToEnter, showHint }

  // ── the template form's fields ──────────────────────────────────────────────
  // Read the same way as the seven above: every field falls back to the
  // documented default individually, so a settings document written before the
  // template form existed renders the template section with working controls
  // rather than blanks.
  const screenForm = stored.form === 'template' ? 'template' : 'video'
  const template = typeof stored.template === 'string' && stored.template !== ''
    ? stored.template
    : 'archive-warm'
  const template2 = typeof stored.template2 === 'string' ? stored.template2 : ''
  const tpl = Object.assign({}, TPL_DEFAULTS)
  if (stored.tpl !== null && typeof stored.tpl === 'object') {
    for (const key of Object.keys(TPL_DEFAULTS)) {
      const value = stored.tpl[key]
      if (value !== undefined && value !== null && typeof value === typeof TPL_DEFAULTS[key]) {
        tpl[key] = value
      }
    }
  }
  // The template catalogue, fetched when the card opens on the template form.
  // It is the one thing this section cannot render without the Host, and its
  // absence is a sentence rather than a dead dropdown.
  const [templates, setTemplates] = React.useState(null)
  const [templatesFailed, setTemplatesFailed] = React.useState(false)
  // The editor overlay. A boolean, and it is the whole reason the editor is
  // reachable on the desktop build at all: see the section that renders it.
  const [editorOpen, setEditorOpen] = React.useState(false)
  React.useEffect(() => {
    if (!open || screenForm !== 'template' || templates !== null) return undefined
    let live = true
    fetch(TPL_ROUTE + '/templates.json', { credentials: 'same-origin', cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error('HTTP ' + String(response.status))
        return response.json()
      })
      .then((payload) => {
        if (!live) return
        setTemplates(Array.isArray(payload.templates) ? payload.templates : [])
      })
      .catch(() => {
        if (live) setTemplatesFailed(true)
      })
    return () => { live = false }
  }, [open, screenForm, templates])

  // The store's index, fetched the same way — but only when the card is opened
  // on the template form AND the user has scrolled to it... there is no scroll
  // hook here, so it is fetched with the card like the rest. The Host caches
  // the index for five minutes and answers the last good list when the network
  // is down, so this is one request per open, not per render.
  const [storeList, setStoreList] = React.useState(null)
  const [storeFailed, setStoreFailed] = React.useState(false)
  const [installing, setInstalling] = React.useState(null)
  React.useEffect(() => {
    if (!open || screenForm !== 'template' || storeList !== null) return undefined
    let live = true
    fetch(TPL_ROUTE + '/store', { credentials: 'same-origin', cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error('HTTP ' + String(response.status))
        return response.json()
      })
      .then((payload) => {
        if (!live) return
        // The Host answers ok:false with the last good list when the network
        // is down; that list is still worth showing, with a sentence.
        if (payload.ok === false) setStoreFailed(true)
        setStoreList(Array.isArray(payload.templates) ? payload.templates : [])
      })
      .catch(() => {
        if (live) setStoreFailed(true)
      })
    return () => { live = false }
  }, [open, screenForm, storeList])

  // The user's own music, fetched the same way and for the same reason: the
  // BGM section is a dead list without it, and a dead list is worse than a
  // sentence saying why.
  const [tracks, setTracks] = React.useState(null)
  const [tracksBusy, setTracksBusy] = React.useState(false)
  React.useEffect(() => {
    if (!open || screenForm !== 'template' || tracks !== null) return undefined
    let live = true
    fetch(TPL_ROUTE + '/music/list', { credentials: 'same-origin', cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error('HTTP ' + String(response.status))
        return response.json()
      })
      .then((payload) => {
        if (live) setTracks(Array.isArray(payload.files) ? payload.files : [])
      })
      .catch(() => {
        if (live) setTracks([])
      })
    return () => { live = false }
  }, [open, screenForm, tracks])

  // The pool, and each clip's real length. The length comes from a throwaway media
  // element rather than parsed out of the file: the browser's own decode is the
  // only answer that also tells the user whether this clip can play at all.
  //
  // Both effects are gated on `open` so a collapsed card costs nothing. A manifest
  // read plus three media probes per card, on a settings page that lists every
  // plugin, is not worth paying for a row nobody has opened.
  React.useEffect(() => {
    if (!open || pool !== null) return undefined
    let live = true
    fetch(MANIFEST, { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error('HTTP ' + response.status)
        return response.json()
      })
      .then((payload) => { if (live) setPool(Array.isArray(payload.clips) ? payload.clips : []) })
      .catch((error) => { if (live) setFailure('读取素材池失败：' + String(error)) })
    return () => { live = false }
  }, [open, pool])

  React.useEffect(() => {
    if (!open || pool === null) return undefined
    const probes = pool.map((clip) => {
      const element = document.createElement('video')
      element.muted = true
      element.preload = 'auto'
      const settle = (patch) => setLengths((current) => Object.assign({}, current, { [clip.name]: patch }))

      // The probe PLAYS the clip, because reading metadata proves nothing about
      // whether a picture ever appears. The first version of this only listened
      // for `loadedmetadata`, so a clip whose frames never arrive reported a
      // perfectly healthy duration — the reassuring answer this card exists to
      // not give. A presented frame is the only proof, and a clip that starts and
      // then paints nothing is reported as exactly that.
      let decided = false
      let timer = null
      const finish = (patch) => {
        if (decided) return
        decided = true
        if (timer !== null) clearTimeout(timer)
        settle(patch)
        try {
          if (typeof element.pause === 'function') element.pause()
        } catch (error) {
          /* a probe that cannot pause is already stopped */
        }
      }
      const onRefused = () => finish({ refused: true })
      const onPlayed = () => finish({ played: true })
      // Metadata first: the duration is what the row is for, and it is known long
      // before a frame is. Kept even while playability is still undecided.
      const onMeta = () => settle({ seconds: element.duration })

      element.addEventListener('error', onRefused)
      element.addEventListener('loadedmetadata', onMeta)
      timer = setTimeout(() => finish({ noFrame: true }), 8000)

      if (typeof element.requestVideoFrameCallback === 'function') {
        element.requestVideoFrameCallback(onPlayed)
      } else {
        element.addEventListener('timeupdate', () => {
          if (element.currentTime > 0) onPlayed()
        })
      }

      // `src` BEFORE `play()`. With no source, `play()` rejects with
      // NotSupportedError — which this probe reads as "the browser refused this
      // clip", so every clip came back unplayable while the animation was in fact
      // playing them perfectly well.
      element.src = clip.src
      try {
        const attempt = element.play()
        if (attempt !== undefined && typeof attempt.catch === 'function') attempt.catch(onRefused)
      } catch (error) {
        onRefused()
      }

      // Detached on purpose: nothing enters the document, so the probe costs no
      // layout and no visible element. It does play silently until it settles.
      return () => {
        decided = true
        if (timer !== null) clearTimeout(timer)
        element.removeEventListener('error', onRefused)
        try {
          if (typeof element.pause === 'function') element.pause()
        } catch (error) {
          /* already stopped */
        }
        element.removeAttribute('src')
      }
    })
    return () => { for (const dispose of probes) dispose() }
  }, [open, pool])

  /**
   * Stage one field write.
   *
   * The operation is the settings service's own `SettingsPathOp` shape — one
   * atomic `set` at a top-level path — so the same call works whether the page
   * handed us its configuration form or we fell back to the injected scope.
   *
   * The revision travels with the write because the Host refuses a mutation
   * composed against a document it has since replaced, and `mutate` reports that
   * refusal as a bare `false` — it swallows the reason. So a refusal is retried
   * once through the remote service with the SAME operation and no revision fence:
   * if the operation itself is acceptable the retry lands, and if it is not, the
   * remote failure text is shown. Either way the user sees why, instead of a
   * control that quietly does nothing — which is the failure this card was
   * reported for.
   * @param field - config field name, or a path array for a nested field such
   *   as `['tpl', 'speed']`. A plain string is the one-element path.
   * @param value - the value to store.
   */
  const write = async (field, value) => {
    if (!writable) {
      setFailure('这一页没有连上设置文档，改动不会保存。')
      return false
    }
    setBusy(true)
    setFailure(null)
    const revision = snapshot === undefined || snapshot === null ? undefined : snapshot.revision
    const ops = [{ op: 'set', path: Array.isArray(field) ? field.slice() : [field], value }]
    try {
        const accepted = await form.mutate(ops, revision)
        if (accepted !== false) return true
        if (form.remoteMutate === null) {
          throw new Error('本部署没有接受这次修改。')
        }
        // Retry through the service, unfenced, to learn WHY it was refused.
          const answer = await form.remoteMutate(SETTINGS_NAMESPACE, ops, undefined)
          if (answer !== null && typeof answer === 'object' && answer.ok === true) return true
          if (answer !== null && typeof answer === 'object' && answer.ok === false) {
            const reason = answer.error === undefined || answer.error === null
              ? '未说明原因'
              : String(answer.error.message ?? answer.error)
            throw new Error(reason)
          } else {
            throw new Error('本部署没有接受这次修改。')
          }
    } catch (error) {
      if (alive.current) setFailure('保存失败：' + String(error))
      return false
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  const toggleClip = (name, enabled) => {
    const next = enabled ? disabled.filter(entry => entry !== name) : disabled.concat([name])
    // Switching every clip off would leave the screen with nothing to play, so the
    // last enabled one cannot be turned off from here.
    if (pool !== null && !pool.some(clip => !next.includes(clip.name))) {
      setFailure('至少要留一条素材参与随机。')
      return
    }
    write('disabledClips', next)
  }

  const requestJson = async (url, options) => {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options })
    const answer = await response.json().catch(() => null)
    if (!response.ok || answer?.ok === false || answer === null) {
      throw new Error(answer?.error || ('HTTP ' + response.status))
    }
    return answer
  }

  const refreshPool = async () => {
    const answer = await requestJson(MANIFEST)
    if (!Array.isArray(answer.clips)) throw new Error('视频清单格式无效。')
    if (alive.current) setPool(answer.clips)
    return answer.clips
  }

  const selectClip = async (clip) => {
    if (busy || previewing !== null || operationLock.current || pool === null) return
    setNotice(null)
    if (await write('disabledClips', pool.filter(other => other.name !== clip.name).map(other => other.name))) {
      if (alive.current) setNotice('已设为开屏视频：' + (clip.displayName || clip.name) + '。可点预览查看效果。')
    }
  }

  const importClip = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || busy || previewing !== null || operationLock.current || !writable) return
    if (!/\.(mp4|webm|m4v|mov)$/i.test(file.name) || file.size === 0 || file.size > 256 * 1024 * 1024) {
      setFailure('请选择不超过 256 MB 的 MP4、WebM、M4V 或 MOV 视频。')
      return
    }
    operationLock.current = true
    setOperation('正在导入…')
    setFailure(null)
    setNotice(null)
    let uploaded = false
    try {
      const answer = await requestJson('/plugins/dsh-boot-animation/upload?name=' + encodeURIComponent(file.name), {
        method: 'POST', headers: { 'content-type': file.type || 'application/octet-stream' }, body: file,
      })
      uploaded = true
      const clips = await refreshPool()
      if (!alive.current) return
      if (!clips.some(clip => clip.name === answer.clip?.name)) throw new Error('导入完成，但视频清单尚未更新，请重试读取。')
      const selected = await write('disabledClips', clips.filter(clip => clip.name !== answer.clip.name).map(clip => clip.name))
      if (alive.current) setNotice(selected
        ? '视频已导入并设为开屏。可点预览查看当前效果。'
        : '视频已导入，选择设置未保存。请点「设为开屏」重试。')
    } catch (error) {
      if (alive.current) setFailure((uploaded ? '视频已导入，但设置未完成：' : '导入失败：') + String(error))
    } finally {
      operationLock.current = false
      if (alive.current) setOperation(null)
    }
  }

  const removeClip = async (clip) => {
    if (!clip.custom || busy || previewing !== null || operationLock.current || !writable || pool === null) return
    if (!globalThis.confirm('移除自定义视频「' + (clip.displayName || clip.name) + '」？')) return
    const others = pool.filter(other => other.name !== clip.name)
    if (!others.length) { setFailure('请先导入另一条视频，再移除最后一条。'); return }
    operationLock.current = true
    setOperation('正在移除…')
    setFailure(null)
    setNotice(null)
    try {
      if (!others.some(other => !disabled.includes(other.name))) {
        if (!await write('disabledClips', pool.filter(other => other.name !== others[0].name).map(other => other.name))) return
      }
      if (!alive.current) return
      await requestJson('/plugins/dsh-boot-animation/custom-clip/' + encodeURIComponent(clip.name.slice(7)), { method: 'DELETE' })
      await refreshPool()
      if (alive.current) setNotice('自定义视频已移除。')
    } catch (error) {
      if (alive.current) setFailure('移除失败：' + String(error))
    } finally {
      operationLock.current = false
      if (alive.current) setOperation(null)
    }
  }

  /**
   * Ask the Host to move one clip's index table to the front of its file.
   *
   * Nothing is refetched afterwards. The manifest's per-clip `faststart` flag is
   * patched in place instead, because re-reading the pool would re-run every media
   * probe in the effect above — each one plays its clip for up to eight seconds —
   * to learn a fact this call already knows. The clip's `src` keeps its old `?v=`
   * revision, which is right: the bytes the probe judged are the bytes the card
   * still holds, and the boot screen reads the manifest afresh on the next page
   * load, where the revision will be the new one.
   *
   * A refusal is reported with the Host's own sentence rather than a generic
   * failure: those sentences say which of the three reasons it was (too big, not
   * an mp4, self-check failed and the original was restored), and that is the part
   * the user can act on.
   * @param name - the clip's file name, exactly as the manifest published it.
   */
  const optimize = (name) => {
    setFailure(null)
    setFixing((current) => Object.assign({}, current, { [name]: 'busy' }))
    fetch(OPTIMIZE + '?name=' + encodeURIComponent(name), { method: 'POST', cache: 'no-store' })
      .then((response) => response.json()
        .catch(() => ({ ok: false, error: 'Host 回答了 HTTP ' + String(response.status) })))
      .then((answer) => {
        if (answer !== null && typeof answer === 'object' && answer.ok === true) {
          setFixing((current) => Object.assign({}, current, { [name]: 'done' }))
          setPool((current) => (current === null ? current : current.map((clip) => (
            clip.name === name ? Object.assign({}, clip, { faststart: true }) : clip
          ))))
          return
        }
        setFixing((current) => Object.assign({}, current, { [name]: 'error' }))
        const why = answer !== null && typeof answer === 'object' && answer.error !== undefined
          ? String(answer.error)
          : 'Host 没有说明原因'
        setFailure('优化 ' + name + ' 失败：' + why)
      })
      .catch((error) => {
        setFixing((current) => Object.assign({}, current, { [name]: 'error' }))
        setFailure('优化 ' + name + ' 失败：' + String(error))
      })
  }

  /**
   * Play this clip as the real boot animation, full screen, right now.
   *
   * The overlay is the one the page already carries (`__DSH_BOOT_ANIM__`, installed
   * by the injected head script): it is asked to run a second time, for this clip,
   * with the settings the card is showing at this moment — so the fade, the enter
   * mode, the hint line and the sound behaviour are the live ones rather than the
   * ones this page happened to be served with. It leaves by the same dissolve a real
   * start uses, then calls back, which is when the button becomes pressable again.
   *
   * The one failure worth naming: a page loaded BEFORE this feature existed has the
   * old overlay in memory, whose namespace has no `preview`. Saying so beats a
   * button that appears to do nothing.
   * @param name - the clip's file name, exactly as the manifest published it.
   */
  const preview = (name) => {
    const overlay = globalThis[OVERLAY]
    if (overlay === null || overlay === undefined || typeof overlay.preview !== 'function') {
      setFailure('请开启启动动画后刷新页面再预览；桌面版需从系统托盘退出后重新打开。')
      return
    }
    setFailure(null)
    setPreviewing(name)
    let started = false
    try {
      started = overlay.preview({
        name,
        fadeMs,
        enterMode,
        sound,
        clickToEnter,
        showHint,
        onDone: () => setPreviewing(null),
      }) === true
    } catch (error) {
      setPreviewing(null)
      setFailure('预览没能启动：' + String(error))
      return
    }
    if (!started) {
      setPreviewing(null)
      setFailure('已经有一个预览在跑了，等它结束再点。')
    }
  }

  /**
   * Map the card's current values onto the runtime's config shape.
   *
   * Mirrors the Host's own mapping (entry.js's templateRuntimeConfig) and must
   * stay identical to it: the runtime merges whatever it is given over its own
   * defaults, so a key the Host sends and the card does not — or the reverse —
   * is a preview that plays differently from a real boot.
   * @returns the runtime's config object.
   */
  const tplRuntimeConfig = () => ({
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
  })

  /**
   * Re-install the caption-probe style the bootstrap owns.
   *
   * A preview replays the runtime directly, without the bootstrap, so the
   * Windows caption keeps the shell's colours for the length of the replay
   * unless the style is put back first. The rule itself is the bootstrap's, and
   * the id is the one the runtime's finish() removes again.
   */
  const ensureTplCaption = () => {
    // Same rule as `ensureStyle`: a node with this id is reused, never trusted to
    // still carry the current text.
    let style = document.getElementById(TPL_CAPTION_ID)
    if (style === null) {
      style = document.createElement('style')
      style.id = TPL_CAPTION_ID
      document.head.appendChild(style)
    }
    // No backticks in a CSS blob — the project has lost a silent build to one.
    const text = 'body>span[style*="dsw-specific-sidebar-fill"]'
      + '{background-color:rgba(0,0,0,0)!important;color:#e8f2fb!important}'
    if (style.textContent !== text) style.textContent = text
  }

  /**
   * Play the selected template as the real boot animation, full screen, now.
   *
   * The runtime is the one the page already carries, and it is asked to replay
   * with the settings the card is showing at this moment — including the ones
   * not saved yet, which is the whole point: the alternative is a preview that
   * answers "what does the SAVED template look like" when the user just chose a
   * different one. The template data is fetched from the Host so the replay
   * carries the same validated JSON a real boot would.
   *
   * The runtime signals its own end with a window event, which is what
   * re-enables the button; the fallback timer exists because a runtime that
   * never started (a route that refused, a script that failed) never dispatches
   * it, and a button stuck disabled is the failure this avoids.
   */
  const previewTemplate = async () => {
    if (previewing !== null) return
    setFailure(null)
    setNotice(null)
    setPreviewing('template')
    let timer = null
    const release = () => {
      globalThis.removeEventListener(TPL_DONE_EVENT, release)
      if (timer !== null) globalThis.clearTimeout(timer)
      if (alive.current) setPreviewing(null)
    }
    globalThis.addEventListener(TPL_DONE_EVENT, release)
    // The runtime bounds its own run (a skip, an iframe's safety timer, the
    // timeline's end), so this is generous: it only fires when none of that
    // happened, which is exactly the case the event listener cannot cover.
    timer = globalThis.setTimeout(release, 150000)
    try {
      const first = await requestJson(TPL_ROUTE + '/template/' + encodeURIComponent(template))
      let second = null
      if (template2 !== '') {
        second = await requestJson(TPL_ROUTE + '/template/' + encodeURIComponent(template2))
          .catch(() => null)
      }
      if (!alive.current) return
      globalThis.__DSH_BOOT_ANIM_TPL_BASE__ = TPL_ROUTE
      globalThis.__DSH_BOOT_ANIM_TPL_CFG__ = tplRuntimeConfig()
      globalThis.__DSH_BOOT_ANIM_TPL_1__ = first.template
      if (second !== null) globalThis.__DSH_BOOT_ANIM_TPL_2__ = second.template
      else delete globalThis.__DSH_BOOT_ANIM_TPL_2__
      ensureTplCaption()
      // The button keeps focus after the click, and a space press would then
      // fire it again — a replay that appears to restart itself. Hand the key
      // to the template, which is what wants it (its tips, its easter egg).
      const active = document.activeElement
      if (active !== null && typeof active.blur === 'function') active.blur()
      const api = globalThis.__DSH_BOOT_ANIM_TPL_API__
      if (api !== null && api !== undefined && typeof api.replay === 'function') {
        api.replay()
        return
      }
      release()
      setFailure('请先让模板动画在开屏里跑过一次（或刷新页面），再点预览。')
    } catch (error) {
      release()
      setFailure('预览没能启动：' + String(error))
    }
  }

  /**
   * One behaviour switch: label, checkbox, and the sentence for the state it is
   * currently in. A plain factory rather than a component — it calls no hooks,
   * which is what lets the card's hook count stay the same for every render.
   */
  const switchRow = (field, label, onNote, offNote) => React.createElement('div', {
    className: 'dshba-sec',
    key: field,
  },
  React.createElement('label', { className: 'dshba-switch' },
    React.createElement('input', {
      type: 'checkbox',
      checked: behaviour[field],
      disabled: busy,
      onChange: (event) => write(field, event.target.checked),
    }),
    React.createElement('span', { className: 'dshba-h', style: { margin: '0' } }, label)),
  React.createElement('div', { className: 'dshba-p', style: { marginTop: '6px', marginBottom: '0' } },
    behaviour[field] ? onNote : offNote))

  const header = React.createElement('button', {
    type: 'button',
    className: 'dshba-head',
    'aria-expanded': open,
    'aria-label': (open ? '收起' : '展开') + '：启动动画',
    onClick: () => { setOpen(!open) },
  },
  React.createElement('span', { className: 'dshba-headtext' },
    React.createElement('span', { className: 'dshba-name' }, '启动动画'),
    React.createElement('span', { className: 'dshba-desc' }, '影片或模板动画、声音、进入方式与素材池')),
  React.createElement('span', { className: 'dshba-chev' }))

  try {
    if (!open) {
      return React.createElement('li', { className: 'dshba-card', 'data-open': '0' }, header)
    }

    const sections = []

    // The switch comes first because it is the only setting that changes whether
    // any of the others run at all.
    sections.push(React.createElement('div', { className: 'dshba-sec', key: 'enabled' },
      React.createElement('label', { className: 'dshba-switch' },
        React.createElement('input', {
          type: 'checkbox',
          checked: enabled,
          disabled: busy,
          onChange: (event) => write('enabled', event.target.checked),
        }),
        React.createElement('span', { className: 'dshba-h', style: { margin: '0' } }, '开启启动动画')),
      React.createElement('div', { className: 'dshba-p', style: { marginTop: '6px', marginBottom: '0' } },
        enabled
          ? '关掉并刷新页面，就会回到 DSH 原生启动页'
          : '已关闭：刷新页面后就是 DSH 原生启动页，下面的设置暂时不生效')))

    sections.push(React.createElement('div', { className: 'dshba-sec', key: 'form' },
      React.createElement('div', { className: 'dshba-h' }, '开屏形式'),
      React.createElement('div', { className: 'dshba-row' },
        SCREEN_FORMS.map(entry => React.createElement('button', {
          key: entry[0],
          type: 'button',
          className: 'dshba-opt',
          'data-on': entry[0] === screenForm ? 1 : 0,
          disabled: busy,
          onClick: () => write('form', entry[0]),
        }, entry[1]))),
      React.createElement('div', { className: 'dshba-p', style: { marginTop: '8px', marginBottom: '0' } },
        screenForm === 'template'
          ? '模板动画由数据驱动：分幕（文字/配音/按钮）、时间线（图层关键帧）或整页 iframe 都能跑。'
          + '下面的影片相关设置在这一形式下不生效。'
          : '满屏播放一段视频，播完交叉溶解进界面（插件原有形式）。')))

    if (screenForm === 'template') {
      const tplSwitch = (leaf, label, onNote, offNote) => React.createElement('div', {
        className: 'dshba-sec',
        key: 'tpl-' + leaf,
      },
      React.createElement('label', { className: 'dshba-switch' },
        React.createElement('input', {
          type: 'checkbox',
          checked: tpl[leaf],
          disabled: busy,
          onChange: (event) => write(['tpl', leaf], event.target.checked),
        }),
        React.createElement('span', { className: 'dshba-h', style: { margin: '0' } }, label)),
      React.createElement('div', { className: 'dshba-p', style: { marginTop: '6px', marginBottom: '0' } },
        tpl[leaf] ? onNote : offNote))

      const tplOptions = (leaf, label, entries, note) => React.createElement('div', {
        className: 'dshba-sec',
        key: 'tpl-' + leaf,
      },
      React.createElement('div', { className: 'dshba-h' }, label),
      React.createElement('div', { className: 'dshba-row' },
        entries.map(entry => React.createElement('button', {
          key: entry[0],
          type: 'button',
          className: 'dshba-opt',
          'data-on': entry[0] === tpl[leaf] ? 1 : 0,
          disabled: busy,
          onClick: () => write(['tpl', leaf], entry[0]),
        }, entry[1]))),
      React.createElement('div', { className: 'dshba-p', style: { marginTop: '8px', marginBottom: '0' } }, note))

      const templateOptions = templates === null
        ? [React.createElement('option', { key: 'loading', value: '' }, '正在读取模板…')]
        : templates.length === 0
          ? [React.createElement('option', { key: 'empty', value: '' }, '没有可用模板')]
          : templates.map(entry => React.createElement('option', {
            key: entry.id,
            value: entry.id,
          }, entry.name + '（' + entry.id + '）'))

      sections.push(React.createElement('div', { className: 'dshba-sec', key: 'tpl-pick' },
        React.createElement('div', { className: 'dshba-h' }, '第一幕模板'),
        React.createElement('div', { className: 'dshba-inline' },
          React.createElement('select', {
            className: 'dshba-sel',
            value: template,
            disabled: busy || templates === null || templates.length === 0,
            onChange: (event) => write('template', event.target.value),
          }, templateOptions)),
        templatesFailed
          ? React.createElement('div', { className: 'dshba-msg err' },
            '模板清单读取失败：刷新页面重试，或确认插件已正常加载。')
          : null,
        React.createElement('div', { className: 'dshba-h', style: { marginTop: '12px' } }, '第二幕模板（可选）'),
        React.createElement('div', { className: 'dshba-inline' },
          React.createElement('select', {
            className: 'dshba-sel',
            value: template2,
            disabled: busy || templates === null || templates.length === 0,
            onChange: (event) => write('template2', event.target.value),
          },
          React.createElement('option', { key: 'none', value: '' }, '不播第二幕'),
          templateOptions.filter(entry => entry.key !== 'loading' && entry.key !== 'empty'))),
        React.createElement('div', { className: 'dshba-p', style: { marginTop: '8px', marginBottom: '0' } },
          '模板是纯数据（template.json + 素材），不是代码。把自己的模板目录放进 '
          + 'DSH 配置目录的 data/dsh-boot-animation/templates/ 下就会出现在这里，'
          + '同名会覆盖内置模板。'),
        React.createElement('button', {
          type: 'button',
          className: 'dshba-opt',
          disabled: busy || previewing !== null || templates === null || templates.length === 0,
          title: '现在就把选中的模板满屏跑一遍：用的是当前设置，不等保存。',
          onClick: previewTemplate,
        }, previewing === 'template' ? '预览中…' : '预览这一模板')))

      // The editor entry. A FULL-SCREEN OVERLAY holding the editor page, not a
      // `target="_blank"` link: in the desktop shell a new-window request for the
      // app's own scheme is swallowed, so the button looked dead ("点了没反应").
      // An iframe is a same-origin GET the Host already serves, and it works the
      // same in the browser build, in the desktop shell and inside a narrow
      // settings column.
      //
      // The link stays, as a secondary control: in a browser a real tab is nicer
      // than an overlay, and it costs one line.
      sections.push(React.createElement('div', { className: 'dshba-sec', key: 'tpl-editor-link' },
        React.createElement('div', { className: 'dshba-h' }, '自己改模板'),
        React.createElement('div', { className: 'dshba-p' },
          '可视化编辑器：改文字、图层、关键帧、配色，存进用户模板目录。'
          + '改动立即能在这张卡片的上拉框里看到，也能直接预览。'),
        React.createElement('div', { className: 'dshba-inline' },
          React.createElement('button', {
            type: 'button',
            className: 'dshba-opt',
            onClick: () => setEditorOpen(true),
          }, '打开模板编辑器'),
          React.createElement('a', {
            className: 'dshba-opt',
            href: TPL_ROUTE + '/editor',
            target: '_blank',
            rel: 'noopener noreferrer',
            title: '在新标签页打开（浏览器里更好用；桌面端请用左边的按钮）',
            style: { display: 'inline-block', textDecoration: 'none' },
          }, '新标签页'))))

      // The store. The index is fetched on the Host side (so the browser needs
      // no CORS the store does not offer), and an install writes the template
      // and its declared assets into the user template directory — the same
      // place the editor saves to, so an installed template joins the dropdown
      // above immediately. Every entry carries its own author field, and the
      // card shows it: an attribution that is only in the JSON is one most
      // readers never see.
      const installFromStore = async (entry) => {
        if (busy || installing !== null || !writable) return
        setFailure(null)
        setNotice(null)
        setInstalling(entry.id)
        try {
          const answer = await requestJson(TPL_ROUTE + '/store/install', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: entry.id }),
          })
          // Refresh the template list so the new entry appears in the dropdown
          // above; the store list itself is left alone, because the entry is
          // now installed and re-offering it would only invite a second copy.
          setTemplates(null)
          const note = answer.missing && answer.missing.length > 0
            ? '已安装「' + (entry.name || entry.id) + '」，但缺少素材：' + answer.missing.join('、')
            : '已安装「' + (entry.name || entry.id) + '」，可以在上面的第一幕里选它了。'
          if (alive.current) setNotice(note)
        } catch (error) {
          if (alive.current) setFailure('安装失败：' + String(error))
        } finally {
          if (alive.current) setInstalling(null)
        }
      }

      const storeNodes = []
      if (storeList === null) {
        storeNodes.push(React.createElement('div', { className: 'dshba-msg', key: 'loading' },
          storeFailed ? '模板商店连不上，显示的是上次读到的列表。' : '正在读取模板商店…'))
      } else if (storeList.length === 0) {
        storeNodes.push(React.createElement('div', { className: 'dshba-msg', key: 'empty' },
          '商店里还没有模板。'))
      } else {
        for (const entry of storeList) {
          const installed = templates !== null && templates.some((owned) => owned.id === entry.id)
          storeNodes.push(React.createElement('div', { className: 'dshba-clip', key: entry.id },
            React.createElement('span', { className: 'dshba-nm', title: entry.description || entry.name },
              (entry.name || entry.id) + (entry.author ? ' · ' + entry.author : '')),
            installed
              ? React.createElement('span', { className: 'dshba-badge ok', key: 'have' }, '已安装')
              : React.createElement('button', {
                type: 'button',
                className: 'dshba-opt dshba-mini',
                key: 'install',
                disabled: busy || !writable || previewing !== null || installing !== null,
                title: '把模板和它自带的素材安装到本机 profile 的模板目录',
                onClick: () => installFromStore(entry),
              }, installing === entry.id ? '安装中…' : '安装')))
        }
      }
      sections.push(React.createElement('div', { className: 'dshba-sec', key: 'tpl-store' },
        React.createElement('div', { className: 'dshba-h' }, '模板商店'),
        React.createElement('div', { className: 'dshba-p' },
          '插件作者维护的公开模板，格式与本插件完全一致。'
          + '安装只是把文件写到本机 profile，不会上传任何东西。'),
        storeNodes))

      sections.push(tplOptions('speed', '播放速度',
        TPL_SPEEDS.map(speed => [String(speed), speed + '×']),
        '改动在下次刷新页面时生效；预览立即使用。'))
      sections.push(tplOptions('theme', '版式', TPL_THEMES,
        '模板自带深色底时会自动切到暗色版式，除非你在这里指定过。'))
      sections.push(tplOptions('mode', '播放时机', TPL_MODES,
        '「每次会话」指这个浏览器窗口会话；「每天一次」按自然日计算。'))

      sections.push(tplSwitch('requireInteraction', '等待用户确认',
        '序列里标了需要确认的步骤会等你按下按钮或回车',
        '不等待：每一步自动往下走（仍可 Esc 跳过）'))
      sections.push(tplSwitch('allowSkip', '允许跳过',
        '播放期间可以按 Esc 或点跳过按钮提前进入',
        '不能跳过：必须等模板自己演完'))
      sections.push(tplSwitch('sound', '界面音效',
        '播放选项音、确认音等界面音效',
        '静音：不播任何界面音效'))
      sections.push(tplSwitch('voice', '女声播报',
        '序列每一步用配音念出台词（有素材用素材，没有用系统语音）',
        '静音：只放画面，不念台词'))
      sections.push(tplOptions('voiceLang', '播报语言', TPL_VOICE_LANGS,
        '中英双语时先念英文再念中文。'))
      sections.push(tplOptions('voiceFx', '声音效果', TPL_VOICE_FX,
        '给配音加一层效果，「原声」是不加。'))

      sections.push(React.createElement('div', { className: 'dshba-sec', key: 'tpl-identity' },
        React.createElement('div', { className: 'dshba-h' }, '身份名称'),
        React.createElement('div', { className: 'dshba-inline' },
          React.createElement('input', {
            type: 'text',
            className: 'dshba-sel',
            value: tpl.identity,
            maxLength: 48,
            disabled: busy,
            onChange: (event) => write(['tpl', 'identity'], event.target.value),
          }),
          React.createElement('input', {
            type: 'text',
            className: 'dshba-sel',
            value: tpl.identityId,
            maxLength: 12,
            disabled: busy,
            title: '身份代号，显示在序列里的编号行',
            onChange: (event) => write(['tpl', 'identityId'], event.target.value),
          })),
        React.createElement('div', { className: 'dshba-p', style: { marginTop: '8px', marginBottom: '0' } },
          '序列结尾会念出这个名字；左边是名称，右边是代号。')))

      sections.push(React.createElement('div', { className: 'dshba-sec', key: 'tpl-accent' },
        React.createElement('div', { className: 'dshba-h' }, '强调色'),
        React.createElement('div', { className: 'dshba-inline' },
          [['accent', '主色'], ['glitchA', '故障色 A'], ['glitchB', '故障色 B']].map(entry =>
            React.createElement('label', { className: 'dshba-inline', key: entry[0] },
              React.createElement('input', {
                type: 'color',
                className: 'dshba-color',
                value: tpl[entry[0]],
                disabled: busy,
                onChange: (event) => write(['tpl', entry[0]], event.target.value),
              }),
              React.createElement('span', { className: 'dshba-val' }, entry[1])))),
        React.createElement('div', { className: 'dshba-p', style: { marginTop: '8px', marginBottom: '0' } },
          '模板自己没有指定颜色时才用这里的值；指定过的以模板为准。')))

      for (const point of TPL_TRANSITION_POINTS) {
        sections.push(tplOptions(point[0], point[1] + '转场', TPL_TRANSITIONS,
          point[0] === 'transitionIn'
            ? '动画开始前怎么进入。'
            : point[0] === 'transitionJoin'
              ? '第一幕结束到第二幕开始之间。'
              : '动画结束、交还给桌面时。'))
      }
      sections.push(React.createElement('div', { className: 'dshba-sec', key: 'tpl-trans-ms' },
        React.createElement('div', { className: 'dshba-h' }, '转场时长'),
        React.createElement('div', { className: 'dshba-inline' },
          React.createElement('input', {
            type: 'range',
            className: 'dshba-range',
            min: 200,
            max: 2000,
            step: 100,
            value: tpl.transitionMs,
            disabled: busy,
            onChange: (event) => write(['tpl', 'transitionMs'], Number(event.target.value)),
          }),
          React.createElement('span', { className: 'dshba-val' }, (tpl.transitionMs / 1000).toFixed(1) + ' 秒')),
        React.createElement('div', { className: 'dshba-p', style: { marginTop: '8px', marginBottom: '0' } },
          '「叠化」之外的类型都用这个时长。')))

      sections.push(tplSwitch('glass', '液态玻璃',
        '底板和黑幕变成半透明磨砂，能透出背后的界面（默认观感）',
        '不透明底板： classic 档案版的实心观感'))
      if (tpl.glass) {
        sections.push(React.createElement('div', { className: 'dshba-sec', key: 'tpl-glass' },
          React.createElement('div', { className: 'dshba-h' }, '玻璃参数'),
          React.createElement('div', { className: 'dshba-inline' },
            React.createElement('input', {
              type: 'range',
              className: 'dshba-range',
              min: 0.15,
              max: 0.95,
              step: 0.05,
              value: tpl.glassOpacity,
              disabled: busy,
              onChange: (event) => write(['tpl', 'glassOpacity'], Number(event.target.value)),
            }),
            React.createElement('span', { className: 'dshba-val' }, '不透明度 ' + tpl.glassOpacity.toFixed(2))),
          React.createElement('div', { className: 'dshba-inline', style: { marginTop: '8px' } },
            React.createElement('input', {
              type: 'range',
              className: 'dshba-range',
              min: 0,
              max: 60,
              step: 1,
              value: tpl.glassBlur,
              disabled: busy,
              onChange: (event) => write(['tpl', 'glassBlur'], Number(event.target.value)),
            }),
            React.createElement('span', { className: 'dshba-val' }, '磨砂 ' + String(tpl.glassBlur) + 'px')),
          React.createElement('div', { className: 'dshba-inline', style: { marginTop: '8px' } },
            React.createElement('input', {
              type: 'range',
              className: 'dshba-range',
              min: 0,
              max: 80,
              step: 2,
              value: tpl.glassBackdropBlur,
              disabled: busy,
              onChange: (event) => write(['tpl', 'glassBackdropBlur'], Number(event.target.value)),
            }),
            React.createElement('span', { className: 'dshba-val' }, '背景模糊 ' + String(tpl.glassBackdropBlur) + 'px')),
          React.createElement('div', { className: 'dshba-p', style: { marginTop: '8px', marginBottom: '0' } },
            '背景模糊直接糊在应用本体上，超过 60px 会糊成一片纯色。')))
    }

    // ── the user's own background music ──────────────────────────────────────
    // The runtime plays these tracks itself; the card's job is to import them
    // and pick which one plays where. The import goes to the Host's own route,
    // which stores it in the profile — never uploaded anywhere else.
    const importMusic = async (event) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file || busy || previewing !== null || !writable) return
      if (!/\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.name) || file.size === 0 || file.size > 100 * 1024 * 1024) {
        setFailure('请选择不超过 100 MB 的 MP3、WAV、OGG、M4A、AAC 或 FLAC 音频。')
        return
      }
      setFailure(null)
      setNotice(null)
      setTracksBusy(true)
      try {
        const answer = await requestJson(TPL_ROUTE + '/music/upload?name=' + encodeURIComponent(file.name), {
          method: 'POST',
          headers: { 'content-type': file.type || 'application/octet-stream' },
          body: file,
        })
        setTracks(null)
        setNotice('已导入「' + (answer.name || file.name) + '」。可在下面选作主音乐或第二段。')
      } catch (error) {
        setFailure('导入失败：' + String(error))
      } finally {
        if (alive.current) setTracksBusy(false)
      }
    }

    const removeTrack = async (track) => {
      if (busy || previewing !== null || !writable) return
      if (!globalThis.confirm('移除音乐「' + (track.name || track.file) + '」？')) return
      setFailure(null)
      setNotice(null)
      try {
        await requestJson(TPL_ROUTE + '/music/delete', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ file: track.file }),
        })
        // A removed track must stop being the selected one, or the next boot
        // asks the runtime for a file the route will refuse.
        if (tpl.bgmFile === track.file) write(['tpl', 'bgmFile'], '')
        if (tpl.bgmFile2 === track.file) write(['tpl', 'bgmFile2'], '')
        setTracks(null)
        setNotice('已移除「' + (track.name || track.file) + '」。')
      } catch (error) {
        setFailure('移除失败：' + String(error))
      }
    }

    const trackOptions = (extra) => {
      const options = []
      if (extra !== undefined) options.push(extra)
      if (tracks === null || tracks.length === 0) {
        options.push(React.createElement('option', { key: 'none', value: '', disabled: true },
          tracks === null ? '正在读取…' : '还没有导入音乐'))
        return options
      }
      for (const track of tracks) {
        options.push(React.createElement('option', { key: track.file, value: track.file },
          (track.name || track.file) + '（' + formatBytes(track.size) + '）'))
      }
      return options
    }

    const slider = (leaf, label, min, max, step, unit) => React.createElement('div', {
      className: 'dshba-inline',
      key: leaf,
    },
    React.createElement('span', { className: 'dshba-val', style: { minWidth: '88px' } }, label),
    React.createElement('input', {
      type: 'range',
      className: 'dshba-range',
      min, max, step,
      value: tpl[leaf],
      disabled: busy,
      onChange: (event) => write(['tpl', leaf], Number(event.target.value)),
    }),
    React.createElement('span', { className: 'dshba-val' }, tpl[leaf] + (unit || '')))

    sections.push(React.createElement('div', { className: 'dshba-sec', key: 'tpl-bgm' },
      React.createElement('label', { className: 'dshba-switch' },
        React.createElement('input', {
          type: 'checkbox',
          checked: tpl.bgmEnabled,
          disabled: busy,
          onChange: (event) => write(['tpl', 'bgmEnabled'], event.target.checked),
        }),
        React.createElement('span', { className: 'dshba-h', style: { margin: '0' } }, '背景音乐')),
      React.createElement('div', { className: 'dshba-p', style: { marginTop: '6px' } },
        tpl.bgmEnabled
          ? '用你自己的音乐给模板伴奏。文件只存在本机 profile 里，不上传任何服务器。'
          : '关掉时不读任何音乐文件，模板只放自己的声音。')))

    if (tpl.bgmEnabled) {
      const bgmSections = []
      bgmSections.push(React.createElement('div', { className: 'dshba-sec', key: 'tpl-bgm-import' },
        React.createElement('div', { className: 'dshba-h' }, '导入音乐'),
        React.createElement('label', { className: 'dshba-h' }, '选择音频文件',
          React.createElement('input', {
            type: 'file', accept: '.mp3,.wav,.ogg,.m4a,.aac,.flac',
            disabled: busy || !writable || previewing !== null || tracksBusy,
            onChange: importMusic,
            style: { display: 'block', maxWidth: '100%', margin: '8px 0' },
          })),
        React.createElement('div', { className: 'dshba-p' },
          '支持 MP3、WAV、OGG、M4A、AAC、FLAC，单个不超过 100 MB。'),
        tracks === null
          ? React.createElement('div', { className: 'dshba-msg' }, '正在读取已导入的音乐…')
          : tracks.length === 0
            ? React.createElement('div', { className: 'dshba-msg' }, '还没有导入过音乐。')
            : tracks.map((track) => React.createElement('div', { className: 'dshba-clip', key: track.file },
              React.createElement('span', { className: 'dshba-nm' }, track.name || track.file),
              React.createElement('span', { className: 'dshba-meta' }, formatBytes(track.size)),
              React.createElement('button', {
                type: 'button',
                className: 'dshba-opt dshba-mini',
                disabled: busy || !writable || previewing !== null,
                title: '设为主音乐（第一段）',
                onClick: () => write(['tpl', 'bgmFile'], track.file),
              }, tpl.bgmFile === track.file ? '主音乐 ✓' : '设为主音乐'),
              React.createElement('button', {
                type: 'button',
                className: 'dshba-opt dshba-mini',
                disabled: busy || !writable || previewing !== null,
                title: '设为第二段换曲',
                onClick: () => write(['tpl', 'bgmFile2'], track.file),
              }, tpl.bgmFile2 === track.file ? '第二段 ✓' : '设为第二段'),
              React.createElement('button', {
                type: 'button',
                className: 'dshba-opt dshba-mini',
                disabled: busy || !writable || previewing !== null,
                onClick: () => removeTrack(track),
              }, '移除')))))

      bgmSections.push(React.createElement('div', { className: 'dshba-sec', key: 'tpl-bgm-pick' },
        React.createElement('div', { className: 'dshba-h' }, '主音乐（第一幕）'),
        React.createElement('select', {
          className: 'dshba-sel',
          value: tpl.bgmFile,
          disabled: busy || tracks === null || tracks.length === 0,
          onChange: (event) => write(['tpl', 'bgmFile'], event.target.value),
        }, trackOptions()),
        React.createElement('div', { className: 'dshba-h', style: { marginTop: '12px' } }, '第二段（换曲，可选）'),
        React.createElement('select', {
          className: 'dshba-sel',
          value: tpl.bgmFile2,
          disabled: busy || tracks === null || tracks.length === 0,
          onChange: (event) => write(['tpl', 'bgmFile2'], event.target.value),
        }, trackOptions(React.createElement('option', { key: 'same', value: '' }, '不换曲（一直播主音乐）'))),
        React.createElement('div', { className: 'dshba-p', style: { marginTop: '8px', marginBottom: '0' } },
          '不选第二段就是单曲播到底；选了的话，第一段结束会交叉淡入第二段。')))

      bgmSections.push(React.createElement('div', { className: 'dshba-sec', key: 'tpl-bgm-mix' },
        React.createElement('div', { className: 'dshba-h' }, '音量与节奏'),
        slider('bgmVolume', '音量', 0, 1, 0.05, ''),
        slider('bgmBpm', '拍速', 40, 220, 1, ' BPM'),
        slider('bgmBeats1', '第一段拍数', 4, 128, 1, ' 拍'),
        slider('bgmBeats2', '第二段拍数', 4, 128, 1, ' 拍'),
        slider('bgm1Start', '第一段起点', 0, 7200, 5, ' 秒'),
        slider('bgm2Start', '第二段起点', 0, 7200, 5, ' 秒'),
        slider('bgmCrossfade', '交叉时长', 0, 5000, 100, ' ms'),
        React.createElement('div', { className: 'dshba-p', style: { marginTop: '8px', marginBottom: '0' } },
          '选段时长 = 拍数 × 60 ÷ 拍速；起点从音频的第几秒开始截。改完点预览即可听效果。')))

      bgmSections.push(React.createElement('div', { className: 'dshba-sec', key: 'tpl-bgm-switches' },
        React.createElement('label', { className: 'dshba-switch' },
          React.createElement('input', {
            type: 'checkbox',
            checked: tpl.bgmLoop,
            disabled: busy,
            onChange: (event) => write(['tpl', 'bgmLoop'], event.target.checked),
          }),
          React.createElement('span', { className: 'dshba-h', style: { margin: '0' } }, '整体循环')),
        React.createElement('label', { className: 'dshba-switch', style: { marginTop: '8px' } },
          React.createElement('input', {
            type: 'checkbox',
            checked: tpl.bgm2Loop,
            disabled: busy,
            onChange: (event) => write(['tpl', 'bgm2Loop'], event.target.checked),
          }),
          React.createElement('span', { className: 'dshba-h', style: { margin: '0' } }, '第二段也循环')),
        React.createElement('label', { className: 'dshba-switch', style: { marginTop: '8px' } },
          React.createElement('input', {
            type: 'checkbox',
            checked: tpl.bgmDuck,
            disabled: busy,
            onChange: (event) => write(['tpl', 'bgmDuck'], event.target.checked),
          }),
          React.createElement('span', { className: 'dshba-h', style: { margin: '0' } }, '配音时自动压低音乐')),
        React.createElement('div', { className: 'dshba-p', style: { marginTop: '6px', marginBottom: '0' } },
          '关掉「整体循环」后，拍速/拍数/选段不再参与，整首只播一遍。')))

      for (const section of bgmSections) sections.push(section)
    }
    }

    if (screenForm === 'video') {
    sections.push(React.createElement('div', { className: 'dshba-sec', key: 'behaviour-head' },
      React.createElement('div', { className: 'dshba-h' }, '交互与声音'),
      React.createElement('div', { className: 'dshba-p', style: { marginBottom: '0' } },
        '预览立即使用当前设置。桌面版下次开屏生效需从系统托盘彻底退出后重新打开。')))
    for (const entry of BEHAVIOUR) {
      sections.push(switchRow(entry[0], entry[1], entry[2], entry[3]))
    }

    sections.push(React.createElement('div', { className: 'dshba-sec', key: 'fade' },
      React.createElement('div', { className: 'dshba-h' }, '淡入时长'),
      React.createElement('div', { className: 'dshba-row' },
        FADE_CHOICES.map(choice => React.createElement('button', {
          key: choice,
          type: 'button',
          className: 'dshba-opt',
          'data-on': choice === fadeMs ? 1 : 0,
          disabled: busy,
          onClick: () => write('fadeMs', choice),
        }, (choice / 1000) + ' 秒'))),
      React.createElement('div', { className: 'dshba-p', style: { marginTop: '8px', marginBottom: '0' } },
        enterMode === 'tail'
          ? '15 秒的片子会在 ' + ((15000 - fadeMs) / 1000) + ' 秒开始溶解，15 秒正好进界面'
          : '改动在下次刷新页面时生效')))

    sections.push(React.createElement('div', { className: 'dshba-sec', key: 'mode' },
      React.createElement('div', { className: 'dshba-h' }, '进入方式'),
      React.createElement('div', { className: 'dshba-row' },
        ENTER_MODES.map(entry => React.createElement('button', {
          key: entry[0],
          type: 'button',
          className: 'dshba-opt',
          'data-on': entry[0] === enterMode ? 1 : 0,
          disabled: busy,
          onClick: () => write('enterMode', entry[0]),
        }, entry[1]))),
      React.createElement('div', { className: 'dshba-p', style: { marginTop: '8px', marginBottom: '0' } },
        (ENTER_MODES.filter(entry => entry[0] === enterMode)[0] || ['', '', ''])[2])))

    const clipNodes = []
    if (pool === null) {
      clipNodes.push(React.createElement('div', { className: 'dshba-msg', key: 'loading' }, '正在读取…'))
    } else if (pool.length === 0) {
      clipNodes.push(React.createElement('div', { className: 'dshba-msg', key: 'empty' },
        '还没有视频。使用下方「导入自己的视频」添加。'))
    } else {
      for (const clip of pool) {
        const known = lengths[clip.name] || {}
        const state = fixing[clip.name]
        // The duration is the row's primary fact, so it is shown whenever the
        // probe has it; a problem is an ADDITIONAL badge rather than a replacement
        // for it. Reporting "unplayable" in place of the length meant a probe bug
        // cost the user the information they actually came for.
        const badges = [React.createElement('span', { className: 'dshba-badge', key: 'len' },
          formatDuration(known.seconds))]
        if (clip.custom) badges.push(React.createElement('span', { className: 'dshba-badge', key: 'custom' }, '自定义'))
        if (known.refused === true) {
          badges.push(React.createElement('span', {
            className: 'dshba-badge bad',
            key: 'refused',
            title: '浏览器拒绝解码这一段：可能是编码档次不被支持，或文件不完整。',
          }, '浏览器播不了'))
        } else if (known.noFrame === true) {
          // Started, then never painted: the failure that leaves the boot screen on
          // its background. Distinct from a refused clip, and worth saying so.
          badges.push(React.createElement('span', {
            className: 'dshba-badge warn',
            key: 'noframe',
            title: '在这台浏览器里能开始播放，但 8 秒内一帧画面都没出来。'
              + '这种片子放启动动画时只会看到背景色。',
          }, '一直没有画面'))
        }
        if (clip.faststart === false) {
          badges.push(React.createElement('span', {
            className: 'dshba-badge warn',
            key: 'moov',
            title: '索引表(moov)在文件末尾：浏览器要整段下载完才出画面。'
              + (clip.custom ? '建议导出为适合网络播放的 H.264 MP4。' : '点这一行右边的「优化」可以无损前移。'),
          }, '未优化'))
        }
        if (state === 'done') {
          badges.push(React.createElement('span', { className: 'dshba-badge ok', key: 'fixed' }, '已重排'))
        }
        // The button is a SIBLING of the label, never a child of it: a button
        // nested in a label is an interactive element inside a control, and a click
        // on it then becomes a question about label activation rather than about
        // the button.
        clipNodes.push(React.createElement('div', { className: 'dshba-clip', key: clip.name },
          React.createElement('label', { className: 'dshba-clipline', title: clip.name },
            React.createElement('input', {
              type: 'checkbox',
              // Read from the SETTINGS, not from the manifest field. The manifest is
              // fetched once when the card opens, so binding the box to its `enabled`
              // value meant a write never changed what the box displayed: the change
              // persisted and only appeared after the dialog was reopened, which is
              // exactly how that was reported.
              checked: !disabled.includes(clip.name),
              disabled: busy,
              onChange: (event) => toggleClip(clip.name, event.target.checked),
            }),
            React.createElement('span', { className: 'dshba-nm' }, clip.displayName || clip.name),
            badges),
          React.createElement('button', {
            type: 'button', className: 'dshba-opt dshba-mini',
            disabled: busy || !writable || previewing !== null,
            onClick: () => selectClip(clip),
          }, '设为开屏'),
          // 预览 on EVERY row: whether a clip's index sits at the front has nothing
          // to do with how it looks as the boot animation, and the preview is the
          // only way to judge that without restarting DSH.
          React.createElement('button', {
            type: 'button',
            className: 'dshba-opt dshba-mini',
            disabled: busy || previewing !== null,
            title: '现在就把这一段当作启动动画满屏跑一遍：按当前设置演一遍真实的入场过渡。',
            onClick: () => preview(clip.name),
          }, previewing === clip.name ? '预览中…' : '预览'),
          // Only a clip the Host reported as unoptimised offers the rewrite, and it
          // stays offered after a refusal so the user can retry once they have dealt
          // with the reason. `busy` is the settings-write flag: a rewrite running
          // while the settings document is being written is not worth allowing.
          clip.faststart === false && !clip.custom
            ? React.createElement('button', {
              type: 'button',
              className: 'dshba-opt dshba-mini',
              disabled: busy || state === 'busy' || previewing !== null,
              title: '把这一段的索引表(moov)移到文件最前：无损、长度不变，'
                + '原片留在 assets/videos/originals/ 里。',
              onClick: () => optimize(clip.name),
            }, state === 'busy' ? '处理中…' : '优化')
            : null,
          clip.custom ? React.createElement('button', {
            type: 'button', className: 'dshba-opt dshba-mini',
            disabled: busy || !writable || previewing !== null,
            onClick: () => removeClip(clip),
          }, '移除') : null,
          React.createElement('span', { className: 'dshba-meta' }, formatBytes(clip.bytes))))
      }
    }

    sections.push(React.createElement('div', { className: 'dshba-sec', key: 'pool' },
      React.createElement('div', { className: 'dshba-h' }, '素材池'),
      React.createElement('div', { className: 'dshba-p' }, '只选一条固定播放，勾选多条随机播放。导入的视频独立保存，升级插件后仍保留。'),
      React.createElement('label', { className: 'dshba-h' }, '导入自己的视频',
        React.createElement('input', {
          type: 'file', accept: '.mp4,.webm,.m4v,.mov',
          disabled: busy || !writable || previewing !== null || pool === null,
          onChange: importClip,
          style: { display: 'block', maxWidth: '100%', margin: '8px 0' },
        })),
      React.createElement('div', { className: 'dshba-p' }, '支持 MP4、WebM、M4V、MOV，单个不超过 256 MB。导入后自动设为开屏视频。'),
      operation ? React.createElement('div', { className: 'dshba-msg', role: 'status' }, operation) : null,
      clipNodes))
    }

    if (notice !== null) sections.push(React.createElement('div', { className: 'dshba-msg', role: 'status', key: 'notice' }, notice))

    if (failure !== null) {
      sections.push(React.createElement('div', { className: 'dshba-msg err', key: 'failure' }, failure))
    }
    if (snapshot && snapshot.status === 'unavailable') {
      sections.push(React.createElement('div', { className: 'dshba-msg', key: 'unavailable' },
        '这一页连不上设置文档，改动不会保存。'))
    }
    if (snapshot && snapshot.writable === false) {
      sections.push(React.createElement('div', { className: 'dshba-msg', key: 'readonly' },
        '当前页面不允许写入设置文档。'))
    }

    // The editor overlay's own close path. Dropping the cached catalogue is what
    // makes a template saved in the editor appear in the dropdown behind it
    // without a page reload: the fetch effect keys on `templates === null`.
    const closeEditor = () => {
      setEditorOpen(false)
      setTemplates(null)
    }

    return React.createElement('li', { className: 'dshba-card', 'data-open': '1' },
      header,
      React.createElement('div', { className: 'dshba-body' }, sections),
      editorOpen
        ? React.createElement('div', {
          className: 'dshba-editorshell',
          role: 'dialog',
          'aria-label': '模板编辑器',
          // Clicking the backdrop (never the panel) closes, the way every dialog
          // the user already knows in this app does.
          onClick: (event) => { if (event.target === event.currentTarget) closeEditor() },
        },
        React.createElement('div', { className: 'dshba-editor' },
          React.createElement('div', { className: 'dshba-editorbar' },
            React.createElement('span', { className: 'dshba-editortitle' }, '模板编辑器'),
            React.createElement('span', { className: 'dshba-editorsub' },
              '改完点「保存到本地」，回来这张卡片的上拉框里就能选到'),
            React.createElement('button', { type: 'button', className: 'dshba-opt', onClick: closeEditor }, '关闭')),
          React.createElement('iframe', {
            className: 'dshba-editorframe',
            src: TPL_ROUTE + '/editor',
            title: '模板编辑器',
          })))
        : null)
  } catch (error) {
    // A card that cannot draw itself must still leave the settings page usable.
    return React.createElement('li', { className: 'dshba-card', 'data-open': '1' },
      header,
      React.createElement('div', { className: 'dshba-body' },
        '启动动画设置面板渲染失败：' + String(error && error.message ? error.message : error)))
  }
}

/**
 * Read one awaited service from the injected owner context.
 *
 * `get` first, because that is the form every working plugin in this deployment
 * uses and the property proxy is topology-sensitive; the property is the fallback
 * for a context that has the service declared.
 * @param owner - the context passed to the inject callback.
 * @param name - service name.
 * @returns the service, or undefined when it is not reachable.
 */
function serviceAt(owner, name) {
  try {
    if (owner !== null && owner !== undefined && typeof owner.get === 'function') {
      const value = owner.get(name)
      if (value !== undefined && value !== null) return value
    }
  } catch (error) {
    // A global-store miss is the expected miss; the property may still answer.
  }
  try {
    return owner === null || owner === undefined ? undefined : owner[name]
  } catch (error) {
    return undefined
  }
}

/**
 * Report activation, then contribute the settings card if the shell is willing.
 * @param ctx - Client plugin context.
 */
exports.apply = function apply(ctx) {
  // 1. Priority one, and it must not be able to fail for any other reason.
  try {
    const overlay = globalThis[OVERLAY]
    // A missing overlay means the Host half contributed nothing (for example a
    // static deployment whose boot payload carries no injection), in which case
    // the kernel boot page is the only screen and there is nothing to hand over.
    if (overlay !== undefined && typeof overlay.clientReady === 'function') {
      overlay.clientReady()
    }
  } catch (error) {
    // Never break the client roster over a decorative overlay.
    console.warn('boot-animation: client half failed', error)
  }

  // 2. Optional, and reached with the dynamic `ctx.inject` rather than `ctx.get`
  //    or a declared `inject`; see the module header for both reasons.
  try {
    let React = null
    try {
      React = require('react')
    } catch (error) {
      React = null
    }
    if (React === null || typeof React.createElement !== 'function') return
    if (ctx === undefined || ctx === null || typeof ctx.inject !== 'function') return

    ctx.inject(['slots', 'locale', 'configForms'], (owner) => {
      try {
        const slots = serviceAt(owner, 'slots')
        const locale = serviceAt(owner, 'locale')
        const forms = serviceAt(owner, 'configForms')
        if (slots === undefined || slots === null || typeof slots.inject !== 'function') return
        // `configForms` replaced the older `settingsScope` service and owns both
        // the per-namespace scope and the "is the Host serving it at all" gate.
        if (forms === undefined || forms === null || typeof forms.get !== 'function') return
        if (typeof forms.whileServed !== 'function') return

        if (locale !== undefined && locale !== null && typeof locale.register === 'function') {
          const dictionaries = () => locale.register(LOCALE_NAMESPACE, {
            zh: DICTIONARY_ZH,
            en: DICTIONARY_EN,
          })
          if (typeof owner.effect === 'function') owner.effect(dictionaries, 'boot-animation: dictionaries')
          else dictionaries()
        }
        const t = locale !== undefined && locale !== null && typeof locale.bind === 'function'
          ? locale.bind(LOCALE_NAMESPACE)
          : function (key) { return DICTIONARY_ZH[key] === undefined ? key : DICTIONARY_ZH[key] }

        // `whileServed` is the modern gate: the tab is contributed only while the
        // Host actually serves this namespace, so a profile with no settings
        // provider (or one whose schema package is missing) shows no tab at all
        // rather than an inert one.
        //
        // The registered component is a dispatcher, because the page asks for two
        // different things through the same entry: `view: "summary"` for the row's
        // one-liner and `view: "page"` for the configuration section. The view is an
        // owner prop, not part of this face — `runInject` calls `inject` with only
        // `(bindingKey, actions)`, so it cannot be read here — and the two render
        // shapes use a different number of hooks, so they are two components and
        // the dispatcher picks between them at render time.
        //
        // Registration is IDEMPOTENT, and that is load-bearing. `slots.register`
        // throws when a list slot already holds an entry with the same id and
        // priority:
        //
        //   list slot "plugins.item" already has an entry with id "boot-animation"
        //
        // and that throw lands inside the slot ledger's store notification. React's
        // own subscription rides the same notification, so a duplicate registration
        // does not merely log a line: it kills the card's updates while leaving the
        // rendered DOM in place — a card that is visible and completely dead to both
        // the mouse and the keyboard, with every control still enabled. Measured on
        // the live desktop build: the header's click handler ran (a capture-phase
        // listener saw the event) and the state never moved.
        //
        // `slots.inject(key, …)` only forbids a duplicate KEY, not a duplicate ENTRY,
        // so it cannot provide this. Disposing the previous registration before
        // registering again, plus owning the failure so it never reaches the store,
        // is what makes a re-entry harmless.
        let registrations = []
        let serving = false
        let bundleDeclared = false

        /**
         * Register the card into one slot, once that slot is declared.
         *
         * `slots.inject` is what makes a build-independent card possible: it runs
         * the callback only while the slot exists, so a name this build never
         * declares registers nothing and costs nothing. The returned handle owns
         * both the wait and the registration.
         * @param name - slot name.
         * @param options - the slot's own entry options (id for a list slot, key for a keyed one).
         * @param onDeclare - told when this build declares the slot, before the entry is written.
         * @returns the disposer, or null when the wait itself could not be installed.
         */
        const registerInto = function (name, options, onDeclare) {
          try {
            return slots.inject(name, () => {
              if (typeof onDeclare === 'function') onDeclare()
              try {
                return slots.register({
                  name,
                  ...options,
                  locale: LOCALE_NAMESPACE,
                  // Read lazily: the scope binds when the slot actually renders.
                  inject: () => ({ runtime: React, scope: forms.get(SETTINGS_NAMESPACE) }),
                }, BootAnimationEntry)
              } catch (error) {
                // A racing registration must not become an exception in the ledger's
                // notification: answer a no-op disposer and log, so the card that IS
                // mounted keeps its updates.
                console.warn('boot-animation: settings card not registered into ' + name, error)
                return function () {}
              }
            })
          } catch (error) {
            console.warn('boot-animation: settings card not registered into ' + name, error)
            return null
          }
        }

        const contribute = function () {
          if (registrations.length > 0) return
          serving = true
          bundleDeclared = false

          // The plugin's own page (0.2.2-rc.1 and later): the bundle's section,
          // keyed exactly as the page looks it up — `pkg.name`.
          registrations.push(registerInto(BUNDLE_SLOT, { key: BUNDLE_NAME }, () => {
            bundleDeclared = true
          }))

          // The same card one level down, on the row's 配置 page, keyed
          // `<package name>#<row id>`. Registering both is deliberate: the
          // bundle section is what a user finds first, and the row page is the
          // only place that gets the page's own `form` prop.
          registrations.push(registerInto(ROW_SLOT, {
            key: BUNDLE_NAME + '#' + SETTINGS_NAMESPACE,
          }))

          // The list entry this card was written for. On a build that declares
          // the keyed slots it is a SECOND copy in 内置插件配置 — a section that
          // belongs to the kernel's own pages — so it is dropped there, and on
          // every older build it stays the only door.
          //
          // Which build this is can only be told once the page has declared its
          // slots, and each `slots.inject` callback for that page runs in the
          // same synchronous batch as the declarations. One microtask later the
          // answer is final and nothing has painted, so the dropped entry is
          // never visible.
          void Promise.resolve().then(() => {
            if (!serving || bundleDeclared) return
            registrations.push(registerInto(SLOT, {
              id: SETTINGS_NAMESPACE,
              order: 60,
              label: () => t('title'),
            }))
          })
        }
        const withdraw = function () {
          serving = false
          const live = registrations
          registrations = []
          for (const dispose of live) {
            try {
              if (typeof dispose === 'function') dispose()
            } catch (error) {
              console.warn('boot-animation: settings card not withdrawn', error)
            }
          }
        }
        const serve = function () {
          return forms.whileServed([SETTINGS_NAMESPACE], function () {
            contribute()
            return withdraw
          })
        }
        if (typeof owner.effect === 'function') owner.effect(serve, 'boot-animation: settings page')
        else serve()

        // The card is silent when it works, which is exactly the state that used to
        // be indistinguishable from "the services never arrived". Diagnostic mode
        // says which one happened.
        if (typeof location !== 'undefined' && String(location.search).indexOf('dshbootdiag=1') >= 0) {
          console.info('[boot-animation] settings card registered into ' + BUNDLE_SLOT
            + ' and ' + ROW_SLOT + (bundleDeclared ? '' : ', with the ' + SLOT + ' fallback'))
        }
      } catch (error) {
        console.warn('boot-animation: settings card not registered', error)
      }
    })
  } catch (error) {
    // The card is a convenience; the animation is the feature.
    console.warn('boot-animation: settings card wiring failed', error)
  }
}
