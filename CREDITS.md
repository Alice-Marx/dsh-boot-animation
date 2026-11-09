# Credits and licences

This package runs three boot-screen forms. Two of them — the template engine and
the classic authorisation sequence — come from other people's work, vendored
with their licences intact. This file is the record of who made what, and it is
part of the package on purpose: an attribution that lives only in a commit
message is an attribution the next installer never sees.

## What this package is

`dsh-boot-animation` — MIT, © Alice-Marx. The Host half (`entry.js`, `src/`),
the clip screen (`src/boot-screen.js`), the settings card (`src/client.js`),
the template store (`src/template-store.js`), the template validator
(`src/template-validate.js`) and the trust fence (`src/trust-fence.js`) are this
package's own code.

## The vendored template runtime

`assets/splash/splash.js` and `assets/splash/splash.css` are adapted copies of
the boot-screen runtime from:

- **dsh-boot-suite** — MIT, © LeeRolling · 沈宏宏
  <https://github.com/LeeRolling/dsh-boot-suite>

The suite runtime is itself descended from:

- **dsh-startup-screen** — MIT, © 沈宏宏
  <https://github.com/6shenhonghong9/dsh-startup-screen>

Both trees are MIT-licensed, and both require the author fields to be kept
honest. What was taken, and what was changed:

| Taken | Where it lives here | Changes |
|---|---|---|
| The template runtime (steps / timeline / iframe engines, voice, sfx, transitions) | `assets/splash/splash.js` | Renamed globals (`__DSH_BOOT_ANIM_TPL_*`), root id (`dsh-boot-anim-tpl`), route prefix (`BASE`), storage keys, and the completion event. No behavioural change. |
| The runtime's stylesheet | `assets/splash/splash.css` | The root-id selectors renamed as above. |
| The liquid-glass treatment | same two files, as a documented patch | Ported from dsh-startup-screen (see below). |
| The interface sound effects (`sfx-tick.mp3`, `sfx-ticks-run.mp3`) | `assets/splash/assets/` | None. |
| The six voice packs (`f`–`k`) | `assets/splash/voices/` | None. |

The liquid-glass treatment (`dsu-glass` rules, `blurAppBackdrop` /
`restoreAppBackdrop`, the plate-transparency release) exists in
dsh-startup-screen but not in the suite, so it was ported from the former —
MIT, © 沈宏宏 — as a patch the vendoring script applies, not as a hand edit.

The rename map is deliberate and reviewable in one place:
`tools/vendor-splash-runtime.mjs`. What it does NOT rename is equally
deliberate: the `.dsu-*` class vocabulary (shared with the source trees, scoped
by the root id) and the `dsh-startup-done` / `-skip` / `-voice` / `-bgm`
postMessage names, which are the contract an iframe template speaks — a
template imported from the source trees honours those names, and renaming them
here would break every one of them.

## The built-in templates

`assets/templates/` holds curated copies from dsh-boot-suite's template
library (MIT unless the template says otherwise). Each template's own
`template.json` carries its `author`, `adaptedBy` and `license` fields, and
those are shipped verbatim — including the one demo (`wipe-demo`) that has no
author in the source, which is stated here rather than papered over with an
invented name.

| Template | Author (from its template.json) | Licence |
|---|---|---|
| `archive-warm` | 沈宏宏 | MIT |
| `deep-sonar` | DeepSeek | MIT |
| `terminal-phosphor` | DeepSeek | MIT |
| `whale-girl-scan` | 素材：NativeDog1/dsh-boot-animation（BSD-3-Clause）；模板维护：LeeRolling | BSD-3-Clause |
| `550c-homage` | DeepSeek, adaptedBy LeeRolling | MIT |
| `chars-globe` | DeepSeek | MIT |
| `earth-globe` | DeepSeek | MIT |
| `world-line` | DeepSeek | MIT |
| `timeline-demo` | DeepSeek, adaptedBy LeeRolling | MIT |
| `wipe-demo` | （源仓库未署名） | MIT |
| `effects-gallery` | DeepSeek | MIT |
| `division-bigfish-codex` | LeeRolling | MIT |

The `whale-girl-scan` media originates from **NativeDog1/dsh-boot-animation**
under BSD-3-Clause — which is this package's own upstream: the whale-girl clip
family started there. Its `NOTICE.md` ships with the template.

## The template format

The `template.json` format (schemaVersion 1 for `steps`, 2 for `layers`,
`engine: 'iframe'` for a whole document) is dsh-boot-suite's. A template is
DATA — never code — and this package's validator (`src/template-validate.js`,
ported from the suite's `lib/security.js`) is what keeps that true: a document
with a prototype key, an unbounded string, or 10 000 nodes is refused before it
reaches the browser.

## The music, editor and store halves

Three more capabilities, all ported from dsh-boot-suite (MIT, © LeeRolling /
沈宏宏) — the same project the runtime and templates come from:

| Taken | Where it lives here | Changes |
|---|---|---|
| The background-music half (import / list / read / delete, the beat grid) | `src/music-store.js`, the `/tpl/music/*` routes | The directory is the profile's data directory rather than DSH_HOME (this package's convention for user media), the API is synchronous for the same reason the template store's is, and the remove contract is "make sure it is gone" rather than "a file was deleted". |
| The template editor page | `assets/editor/editor.html` | Generated by `tools/vendor-editor.mjs`: the route base rewritten to this package's `/tpl` prefix, and the two `/config`-shaped URL sites rewritten to plain concatenation. |
| The editor's save / draft / preview / idcard routes | `entry.js`, `src/idcard-html.js` | The save writes the user template directory with timestamped backups; drafts are in memory and capped; the idcard page is shared with the local preview tool through its own module. |
| The template store half (index fetch, install) | `src/template-store-remote.js`, the `/tpl/store*` routes | The fetch is injected rather than global, so the offline suites can run; the timeout is a race rather than an AbortSignal (in this runtime a locally constructed signal is refused by the global fetch); the default index URL is the suite's own template library, overridable with `DSH_STORE_URL`. |

The store's default index is the suite's published template library
(<https://github.com/LeeRolling/dsh-boot-suite-templates>), whose entries are
already in the format this package plays. Every entry carries its own author
field, the card shows it, and installing writes files into the user's own
directory — nothing is uploaded anywhere.

## Regenerating the vendored pieces

Both vendored directories are generated, and neither should be hand-edited:

```sh
node tools/vendor-splash-runtime.mjs [dsh-boot-suite] [dsh-startup-screen]
node tools/pack-templates.mjs [dsh-boot-suite/templates]
```

Each script copies from the source tree, applies its documented adaptation,
and validates what it wrote. `verify/verify-splash-vendor.mjs` asserts the
shipped artifact still satisfies the contract.
