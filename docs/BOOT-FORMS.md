# Boot forms — the three shapes this plugin can play

This is the record of what "a boot-screen form" means in this package, where each
one came from, and the exact points where the two foreign forms were adapted to
run here. It exists because the adaptation is mostly renaming, and a rename that
drifts breaks a screen with no error anywhere.

## The three forms

| Form | Source | Engine | Data |
|---|---|---|---|
| **clip** | this package's own | `src/boot-screen.js`, injected as a script row | the clip pool (`assets/videos` + profile imports) |
| **template: steps** | dsh-startup-screen's sequence, via dsh-boot-suite | the vendored runtime's scene loop | `template.json` with a `steps[]` array |
| **template: timeline** | dsh-boot-suite | the vendored runtime's keyframe engine | `template.json` with a `layers[]` array |
| **template: iframe** | dsh-boot-suite | the vendored runtime's frame host | `template.json` with `engine: 'iframe'` + a document |

The three template rows are one engine with three data shapes, which is why a
single `form: template` setting covers them and the card offers one dropdown.
`archive-warm` — the built-in default — is the dsh-startup-screen sequence
(需要访问许可 → 身份资料确认 → … → 欢迎访问), and it plays here as a steps
template.

## What the Host injects for the template form

Nine rows, in this order, from `templateRows()` in `entry.js`:

| # | Row | Why it is there |
|---|---|---|
| 1 | `style` — the critical CSS | Locks scroll, forces the black boot background, hides the kernel's boot card, positions the mount point — all before any script runs. |
| 2 | `html` head — the stylesheet link | The runtime's sheet, so the overlay is styled from its first frame. |
| 3 | `script` head — `__DSH_BOOT_ANIM_TPL_BASE__` | The route prefix. The runtime reads it to build its own asset URLs. |
| 4 | `script` head — `__DSH_BOOT_ANIM_TPL_CFG__` | The resolved settings, mapped onto the runtime's config shape. |
| 5 | `script` head — `__DSH_BOOT_ANIM_TPL_1__` | The first act's template JSON, `safeJson`-escaped. |
| 6 | `script` head — `__DSH_BOOT_ANIM_TPL_2__` | The second act's, when one is configured. |
| 7 | `html` body — the mount point | `<div id="dsh-boot-anim-tpl" class="dsu-root dsu-boot">`. |
| 8 | `script` body — the bootstrap | Decides whether this boot plays (enabled / session / daily), locks the page, restyles the Windows caption probe, arms the nine-second fallback. |
| 9 | `script-preload` + `script-src` body — the runtime | The runtime itself. `script-src`, never a `<script>` inside an html row: the desktop build renders html rows as text and would never execute it. |

Rows 3–6 are plain script rows rather than the index table's own `global` value
rows for one reason: the template data is user text, and a `</script>` inside a
step's copy would end the row early. `safeJson` escapes it.

## The adaptation points

`tools/vendor-splash-runtime.mjs` copies the pristine runtime and applies one
rename map. Everything it changes is a name; nothing it changes is behaviour.

| Renamed | From | To | Why |
|---|---|---|---|
| globals | `__DSH_STARTUP*` | `__DSH_BOOT_ANIM_TPL_*` | Two boot plugins in one profile would otherwise share one config global, and the last injection would win for both. |
| root id | `dsh-startup-root` | `dsh-boot-anim-tpl` | Same reason, for the DOM: one id means one owner of every `#id` rule in the sheet. |
| route prefix | `/dsh-startup` | `BASE` (default `/plugins/dsh-boot-animation/tpl`) | The runtime fetches its assets from this package's routes. |
| storage keys | `dsh-startup-screen:shown` / `:day` | `dsh-boot-animation:tpl-shown` / `:tpl-day` | Shared, they would suppress the other plugin's screen for the rest of the day. |
| done event | `dsh-startup:done` | `dsh-boot-animation:tpl-done` | This runtime's own signal to its own page. |
| log tag | `[dsh-startup-screen]` | `[dsh-boot-animation]` | Console lines name the plugin that emitted them. |

Deliberately NOT renamed:

- `.dsu-*` class names. Both stylesheets describe the same rules for the same
  class names; the root id is what scopes them, and a mechanical class rename
  across 1600 lines of CSS and 4000 lines of JS is a larger risk than the
  collision it would prevent.
- `dsh-startup-done` / `-skip` / `-voice` / `-bgm`. These are the postMessage
  contract an iframe template speaks. A template from the source trees honours
  them; renaming them here would break every imported template.

## The ported glass treatment

The suite runtime has no liquid glass; it belongs to the suite's upstream,
dsh-startup-screen. It ships here as a documented patch in the vendoring script —
the config keys in `DEFAULTS`, the block before `var ui = {}`, the restore call
in `finish()`, and the CSS rules appended to the sheet. It is guarded by
`C.glass`, and the Host's default for that field is off, so a defect in the patch
degrades to "no glass" rather than to a broken screen.

## What was NOT ported

| Dropped | Why |
|---|---|
| The chat wallpaper half | Not a boot screen. |

## What was ported later (after the first pass)

The first pass of this port deferred three halves, listed here as they were
dropped then. All three have since been implemented, each in the same spirit —
vendored or ported with attribution, validated, and fenced:

| Ported | Where it lives | The rule it kept |
|---|---|---|
| **Background music** (import / list / read / delete, the beat grid) | `src/music-store.js`, the `/tpl/music/*` routes | A stored name is generated, never taken from the request; every route is fenced; the directory is profile data. |
| **The template editor** | `assets/editor/editor.html` (generated by `tools/vendor-editor.mjs`), the editor routes in `entry.js` | The page is generated, never hand-edited; saves go to the user template directory with timestamped backups; drafts are in memory and capped. |
| **The template store** | `src/template-store-remote.js`, the `/tpl/store*` routes | One fixed origin, Host-side fetch, bounded and raced; the document is validated before it is written and its id checked against the index entry; a failed index answers the last good list. |

The three rules this package added while porting them are worth remembering,
because each one cost a failing suite to learn:

- **A write path's containment is proven on what exists.** `isFileInsideRoot`
  realpaths both sides; a file that does not exist yet cannot be realpath'd, so
  checking the new file directly refuses every first write. The directory is
  created first, the name is a whitelisted single segment, and the directory's
  realpath is the proof.
- **The store's fetch never passes an `AbortSignal`.** In this runtime the
  global `fetch` and a locally constructed `AbortController` come from different
  realms, and the signal makes fetch reject outright — which a catch would
  swallow and turn every store read into a silent failure. The timeout is a
  race instead.
- **The editor's `/config`-shaped URL sites are rewritten, not left as no-op
  replaces.** They exist because upstream mounted the editor under a settings
  path this package does not have; left alone they would POST to the route root.

## Where the rules live

- Validation: `src/template-validate.js` — a template is data, and these are the
  bounds that keep it data.
- Discovery and containment: `src/template-store.js` — user directory overrides
  the package's, nothing outside a template root is ever read, capability tokens
  are 32 random bytes with a ten-minute life.
- The fence: `src/trust-fence.js` — fail-closed, because a decorative plugin is
  not a reason to open a read primitive.
- The proof: `verify/verify-splash-vendor.mjs` asserts the shipped runtime still
  satisfies every row of the table above.
