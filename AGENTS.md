# AGENTS.md — dsh-boot-animation

Maintainer briefing. Written for whoever (or whatever) picks this up next: what the
package is, which two facts about DSH it depends on, the invariants that break it
silently, and how to prove a change is safe.

> **Porting note (DSH 0.2.0-rc.2).** The Host settings contract changed: a plugin
> no longer *registers* a settings namespace, it *declares* `Config`. Everything
> below reflects that. The wide `verify-*` set the README names belongs to the
> author's working copy; what actually ships here is the suites under
> [`verify/`](verify/) — see [Verifying a change](#verifying-a-change).

Human-facing usage lives in [MANUAL.md](MANUAL.md). The long forensic record —
every bug, why it happened, what the evidence was — is [docs/DEVELOPMENT_NOTES.md](docs/DEVELOPMENT_NOTES.md).
Read this file first; go to the archived development notes only for the history of a specific symptom.

## What it is

A DSH plugin that replaces the kernel's boot page with a boot screen of the user's
choosing, then dissolves into the app. No DSH source is modified: it injects rows
into `<head>` ahead of the shell, and contributes a card to Settings → Plugins.

Two screen FORMS ship, picked by the `form` setting:

| Form | What plays | Engine |
|---|---|---|
| `video` | A full-window clip from the pool, with progress and hint chrome | `src/boot-screen.js` (this package's own) |
| `template` | A data-driven animation: scene steps, a keyframed timeline, or a whole iframe document | `assets/splash/` (vendored, see [CREDITS.md](CREDITS.md)) |

The template form is what makes the plugin a host for *other people's* boot
screens: templates are pure JSON + assets, the runtime interprets them, and a
template dropped into the profile's data directory plays without a code change.

| Half | File | Job |
|---|---|---|
| Host (Node) | `entry.js` | Serves clips over HTTP with Range, serves the template form's routes, declares the `Config` schema the settings namespace is derived from, injects the pre-boot rows for the active form |
| Host custom media | `src/custom-clips.js` | Authenticated streaming import/read/removal, with persistent per-profile files outside the npm package |
| Host templates | `src/template-store.js` | Template discovery (package + profile), validation, containment, iframe capability tokens |
| Host validation | `src/template-validate.js` | The structural bounds a template document must satisfy before it is served |
| Host fence | `src/trust-fence.js` | The fail-closed browser trust fence the template routes sit behind |
| Browser (pre-boot, video) | `src/boot-screen.js` | The clip overlay itself: framework-free, injected as text, must run before the shell |
| Browser (pre-boot, template) | `assets/splash/splash.js` | The vendored template runtime: reads the injected globals, mounts, plays |
| Browser (plugin) | `src/client.js` → `lib/client.js` | Reports activation to the video overlay, replays the template runtime for a preview, and renders the settings card |

### The two DSH facts everything rests on

1. **`webserver/index-inject` is the only moment early enough.** Rows pushed into
   that table render into `<head>`, ahead of the shell module. Anything later
   cannot pre-empt the boot page. `entry.js` subscribes to it.
2. **A settings namespace is a plugin entry, and a field is served only if it is
   volatile.** The Host declares `Config` on the module namespace object; the
   entry id in the profile patch (`- insert: id: boot-animation`) *is* the
   namespace; the browser card reaches that same id through the client
   `configForms` service. `@deepseek-ai/dsh-settings` describes only an entry
   whose `Config` projects a non-empty form, and that projection keeps only
   fields marked `.volatile()` — so a schema with no volatile field yields no
   namespace, no card, and no error anywhere. `src/client.js` holds the other end
   of the pairing in `SETTINGS_NAMESPACE`, and nothing in the harness checks that
   the two strings agree.

### What `.volatile()` costs on the Host side

A volatile field does not arrive in `apply(ctx, config)` as a value: it arrives as
a stable reference (`{ get() }`) whose snapshot the loader commits in place, so
`entry.js` reads every field through `readField()` rather than directly. That is
also why a settings edit needs no restart — when only volatile values change,
`@deepseek-ai/cordis-plugin-loader` calls `updateVolatile` on the existing
reference and emits `loader/volatile-update` instead of restarting the fiber, so
the next index render already sees the stored value.

## Rules that were each learned the hard way

Every line here cost a real debugging session. They are not style preferences.

| Rule | What happens if it is broken |
|---|---|
| **Never read/write a CJK-bearing file with PowerShell** — source, data or the user's config alike. Use the file tools; verify with Node `readFileSync(..., 'utf8')`. | PowerShell 5.1 decodes BOM-less UTF-8 as GBK, and a `Set-Content` round-trip destroys every Chinese character — once collapsed `'…'` into `鈥?` and broke the script. The same rule covers files this package does not own: `cordis.patch.yml` carries a provider `displayName`, and the `Get-Content`/`Set-Content` pair in `tools/uninstall.ps1` turned it into mojibake and added a BOM. When a `.ps1` genuinely must rewrite such a file, go through .NET — `[System.IO.File]::ReadAllText($p, $utf8NoBom)` / `WriteAllText($p, $text, $utf8NoBom)` with `New-Object System.Text.UTF8Encoding($false)` — because on 5.1 `Set-Content -Encoding utf8` means *UTF-8 with BOM*, which is still a change to a file that is not the script's to change. **Not `ReadAllLines`/`WriteAllLines`:** `WriteAllLines` terminates every line with `[Environment]::NewLine`, so an LF layer came back all-CRLF — a whole-file rewrite reported as a byte-identical round-trip. |
| **A step that only checks must not repair.** | `tools/install.ps1`'s last step guesses which port dsh is on; when the guess missed it reported FAILED and rolled back a fully working install. A check that cannot tell "broken" from "not measured" has to say which one it is and leave the state alone. |
| **No backtick anywhere inside a CSS blob** (the screen's `style()` string, the card's `CSS` string). | The string ends early and the build keeps the *previous* artifact. It looks like the change had no effect. |
| **An attribute selector with a numeric value must quote it** — `[data-hint="0"]`, never `[data-hint=0]`. | An unquoted value must be a CSS identifier, and one starting with a digit is not, so Chrome drops the ENTIRE rule without a word. The switch looks wired and does nothing. `[data-shown=1]` and both `[data-attention=1]` rules in this package had never applied (only the inline `style.opacity` in `reveal()` hid it). `verify/verify-options.mjs` asserts it with a regex, comments stripped first. |
| **A scratch-copy suite must copy with `dereference: true`.** | Installed, `node_modules/@deepseek-ai/schemastery` is a symlink; `cpSync(..., { recursive: true })` preserves it, so the scratch tree points back at the real library. `verify-degraded.mjs`'s "rename `.volatile()` away" then rewrote the INSTALLED schemastery and silently disarmed every settings card in the deployment. The suites now copy real files and assert the scratch is not a link before rewriting. |
| **Read optional services with `ctx.inject([...], (owner) => owner.get(name))`.** Never `ctx.get(name)`. | `ctx.get` is a one-shot read that races activation and silently answers `undefined`; the card then never registers and there is no error anywhere. Every other client plugin in the deployment uses the `ctx.inject` form. |
| **The client half declares no `inject`.** | A required service leaves the fiber PENDING in a profile that lacks it, `apply` never runs, `clientReady` is never sent, and the animation refuses to hand over. |
| **Every settings field the card edits must be marked `.volatile()`** — and the schema library that resolves beside this package must actually have the method. | `@deepseek-ai/dsh-settings` projects volatile fields and nothing else: a `Config` with none is not described at all, so the namespace is never served, the card's `whileServed` never fires, and the settings row is simply absent with no error. `.volatile()` exists from schemastery 3.18.4. It used to be reached through a peer dependency, which the profile's `autoInstallPeers: false` never installed — a fresh `dsh plugin add` resolved no schemastery at all and the static import threw while `entry.js` was being evaluated, killing the routes and the screen too. It is now a declared `^3.18.4` dependency; `LIVE_CAPABLE` still probes instead of trusting, because a profile `pnpm.overrides` or a hand-made link can still hand it an older copy. Cross-copy use is safe by construction: the projection reads plain data (`meta.volatile`, `dict`, `toJSON()`) and the live reference is keyed by `Symbol.for('cosmokit.volatile.write')`. |
| **Read a volatile config field through `.get()`, never directly.** | `.volatile()` puts a stable reference in the applied config, not the value. Reading it directly yields an object, every type guard falls through to the defaults, and the settings page looks like it does nothing at all — while the values it writes are stored correctly. |
| **Serve clips `cache-control: no-store`, always.** | The overlay aborts the media request when it replaces the element; anything cacheable stores a truncated body. The next normal reload decodes the fragment — and a clip with `moov` at the end has no index in a fragment, so it paints nothing. A hard reload hides it. `ETag`/`no-cache` does **not** fix this: an ETag only ever claims the file has not changed, never that the copy in hand is complete. |
| **A clip's first frame must be evidenced by decoded data** (`readyState >= 2`, `loadeddata`, `canplay`, advancing time) — **not** by `requestVideoFrameCallback` alone. | The element starts at `opacity: 0` and reveal is what makes it visible, so waiting for a *composited* frame waits on the style change it is itself blocking. The screen locks on the gradient. |
| **A resolved `play()` promise is not a picture.** Keep the 6-second retry armed until a frame is really there. | A clip that starts and never paints leaves the gradient up forever, with no error and no next attempt. |
| **`faststart.mjs` must assert the RESULT** — that the output has `moov` before `mdat`. | It was written checking only the *plan* and its own payload proof, both of which are vacuously true for a file that did not move. It reported success for two sessions while writing byte-identical copies, so "I remuxed it" changed nothing. |
| **Strip comments before any regex assertion on an artifact.** | The bundles are comment-preserving concatenations, so prose explaining an old approach is matched as if it were the approach. This happened twice. |
| **The exit's audio fade must reuse the exit's own `span`** — plus `AUDIO_GRACE_MS` only for a clip that is detached and still playing, whose stop deadline stays `span + 1300`. | A fixed fade duration drifts away from a tail dissolve, whose span is the clip's remaining time; and handing the grace to the tail path leaves the track audible after the clip itself has ended. |
| **Do not hardcode a user asset's name in a test.** Read it from the manifest. | The clips get renamed; the suite then fails for a reason that has nothing to do with the code. |
| **Do not `spawnSync` with piped stdio.** Import the module and call the function. | The agent sandbox refuses a child process whose output is captured through a pipe (`EPERM`). `stdio: 'inherit'` works, which is how the author's aggregator spawns its children. |
| **Suites must be runnable together** — no interactive prompts, no fixed ports. | A suite that only passes alone is a defect in the suite. |
| **A PowerShell statement that ends in `+` does not continue onto the next line.** | `$x = 'a' + $y` is already complete, so a following line starting with `+` is parsed as a *unary* plus, throws at runtime, and — under `$ErrorActionPreference = 'Continue'` — the throw is swallowed. The value is then half-built and nothing says so: a split regex assembled this way matched the wrong block and returned a plausible count. One complete statement per line. |
| **The install/uninstall pair edits the patch layer as BYTES, and accounts for them before writing.** | `ReadAllLines`/`WriteAllLines` normalises every terminator, so "the row was removed" came with a whole-file rewrite. `ReadAllText`/`WriteAllText` keeps every other byte as it was; the byte total is asserted before the write, and the one case that cannot round-trip (a layer with no final newline) is stated rather than claimed away. |

## The template form's invariants

Everything above is the clip screen's own history. The template form added a
second set of rules, each learned from the two repositories it was ported from —
dsh-boot-suite and dsh-startup-screen spent real incidents on every one of them.

| Rule | What happens if it is broken |
|---|---|
| **The runtime is a `script-src` row, never a `<script>` inside an `html` row.** | The desktop build (file:// + IPC) renders html rows as text and never executes the tags inside them: the script sits in the document, the runtime never runs, and the boot page shows the kernel's own screen after the animation appears to be "missing". |
| **The template data travels as a script row with `safeJson`, not as a raw JSON string.** | A `</script>` inside a template's copy ends the row early and the rest of the JSON executes as markup. `validateTemplate` does not strip that; `safeJson` is what makes the row inert data. |
| **A template that cannot be read or validated falls back to the clip screen.** | The alternative is a boot page with no screen at all — the one outcome this package's whole design exists to prevent. The fallback is logged, because a user who chose a template and got a clip deserves to be able to find out why. |
| **Every route that can read the user's template directory passes the trust fence, and the fence fails closed.** | Without it such a route is readable by any page the user visits. Fail-closed is deliberate: a guard that throws, or a connection service that is not there, must refuse — the cost is a template animation without its user media, never a blank screen. |
| **The capability token is the ONLY way an iframe template's files are served; a user template is always sandboxed, including on the fallback path.** | Same-origin without a sandbox hands a third-party document the user's session. The fallback route exists for the case the token cannot be minted, and it must keep the sandbox — a fallback that dropped it would defeat the token route. |
| **The user template directory overrides the package's, same id.** | The reverse silently takes a customised template away on the next plugin update — and an editor that saves to the user directory would appear to do nothing. |
| **`dsu-lock` is removed by the runtime's `finish()` and by the bootstrap's nine-second fallback, and the fallback's criterion is the RUNNING flag, not a class.** | A lock left on makes the whole app unscrollable after the animation. The class is removed the moment the runtime loads, so a class-based criterion can never fire for the case it exists for — a runtime that never started. |
| **Nothing under `/tpl/` is cacheable.** | The runtime aborts a media request when it hands over or skips, and a stored fragment of a video is exactly the poisoning the clip route's no-store rule exists to prevent. |
| **The vendored runtime is generated, never hand-edited.** | A hand edit that is not in the script's rename map is lost on the next regeneration, and `verify-splash-vendor.mjs` then fails on a file nobody meant to change. |

The rename map in `tools/vendor-splash-runtime.mjs` is the whole isolation
story: globals, root id, route prefix, storage keys and the completion event are
this plugin's own, while the `.dsu-*` class vocabulary and the
`dsh-startup-done` / `-skip` / `-voice` / `-bgm` postMessage names are
deliberately shared — an iframe template imported from the source trees speaks
the latter, and renaming them would break every one of them.

## The music, editor and store halves

Three more capabilities came from the same two repositories. Each kept the
upstream rule that made it safe, and each added one this package learned while
porting it.

| Rule | What happens if it is broken |
|---|---|
| **A music file's stored name is generated, never taken from the request; the user's file name is display text only.** | Letting a request name become a path segment is how a traversal starts. The whitelist (`MUSIC_FILE_RE`) is matched again by the file route before anything is read. |
| **Every `/tpl/music/*` route is fenced, and fails closed.** | The music directory is profile data: an unfenced read route is a read primitive over the user's files. |
| **The music store's `remove()` answers "gone", not "deleted".** | A track whose file is already absent has reached the desired end state; answering false there makes the card re-offer a file that cannot play. Containment is the one refusal, and it is checked only when the file exists — realpath on a missing file throws, and a throw swallowed as false refuses every already-gone track. |
| **Containment on a WRITE path is proven on what exists.** | `isFileInsideRoot` realpaths both sides; a file that does not exist yet cannot be realpath'd, so checking the new file directly refuses every first write. The directory is created first, the name is a whitelisted single segment, and the directory's realpath is the proof. |
| **The editor saves into the user's template directory, with a timestamped backup of whatever it replaces.** | An edit that goes wrong must be one file away from being undone. A backup that cannot be made must still write — losing the new version is worse than losing the old one's copy. |
| **The editor page is generated, never hand-edited, and its `/config`-shaped URL sites are rewritten to plain concatenation.** | The two `API.replace('/config', …)` sites exist because upstream mounted the editor under a settings path this package does not have; left alone they are no-ops that POST to the route root. `verify-splash-vendor.mjs` asserts the rewrite. |
| **A draft lives in memory, capped at twenty, and dies with the process.** | A draft is a template being watched, not saved. Writing it to disk would make a half-edit installable. |
| **The store reads one fixed origin, on the Host side, bounded and timed out.** | The browser fetching the index would need CORS the store does not offer; an unbounded body would cost the Host memory; a hanging connection would hang a route. |
| **A store install validates the document BEFORE writing it, and checks its id against the index entry that named it.** | An index is remote data: an entry is not a promise that the document behind it is sound, and an entry that points at someone else's template is a mismatch, not an install. |
| **The store's fetch never passes an `AbortSignal`.** | In this runtime the global `fetch` and a locally constructed `AbortController` come from different realms, and the signal makes fetch reject outright — which a catch would swallow and turn every store read into a silent failure. The timeout is a race instead. |
| **A store index that cannot be fetched answers the LAST GOOD list with `ok:false`.** | A flaky network costs freshness, not the feature — an empty list would hide templates the user already knows are there. |

## Where the settings card lives

The card is one component registered into three slots, because the Plugins page
moved under it. `plugins.item` was — and on builds up to 0.2.1 still is — the
list of configuration cards. From 0.2.2-rc.1 that slot renders the *kernel's own*
feature group (子智能体 / 网页搜索 / Agent 循环 …), and a third-party bundle's
configuration moved to two keyed slots on the plugin's package page. A card
registered only in the old slot still appears, in the wrong section, while the
plugin's own page — the only place a user opens the plugin to configure it —
shows no configuration at all. That is not a cosmetic bug: it reads as "this
plugin has no settings", which is exactly how it was reported.

| Rule | What happens if it is broken |
|---|---|
| **The card registers into `plugins.bundle.config` keyed by this package's name, and into `plugins.row.config` keyed `<package>#<row id>`.** | Those two keys are the exact lookups the package page performs (`keysOf('plugins.bundle.config')`, `rowConfigKey(pkg.name, row.rowId)`); one character out and the page renders neither the section nor the row's configure button, with no error anywhere. `BUNDLE_NAME` in `src/client.js` is the key, `build-client.mjs` refuses to build when it disagrees with `package.json`, and `verify-options.mjs` asserts both spellings. |
| **A slot is claimed with `slots.inject`, never a bare `register` on a guessed timeline.** | `slots.inject(key, cb)` runs `cb` only while that slot is declared and disposes it when it collapses, so naming a slot a build does not have costs nothing. A bare `register` on a slot that build never declares throws — inside the ledger's store notification, which kills the *card that is mounted* (see the idempotency rule above). |
| **The list entry is decided one microtask after the page's declarations, and is dropped when the keyed slots exist.** | Registering all three unconditionally would put a second copy of the card in 内置插件配置, a section that belongs to the kernel's pages — a duplicate nobody asked for, in the one place it does not belong. The probe is our own `plugins.bundle.config` callback flag, not `slots.spec()` (which does not see page-mounted declarations); every declaration and every inject callback for that page runs in one synchronous batch, so one turn later the answer is final and nothing has painted. |
| **The bundle section is rendered with owner props only — no `form`.** | `renderSlot('plugins.bundle.config', { view: 'page' }, …)` passes no `form`, unlike the item and row slots. The entry's own `inject` face must therefore carry `scope: configForms.get(namespace)`, which is the same object the page would have passed as `form`; without it the card renders its defaults and every control writes nowhere. `cardForm()` already prefers `form` and falls back to `scope`, and `verify-options.mjs` asserts the face carries it. |

## Change → restart matrix

| Changed | To see it |
|---|---|
| `src/boot-screen.js` | **Reload the page.** The Host re-reads this file on every index render, so a plain F5 is enough and no restart is needed. |
| `entry.js` (routes, settings schema, injected rows) | **Restart DSH.** The running process holds the old module. |
| `src/client.js` | Rebuild (`node build-client.mjs`), then reload; if the change does not appear, restart — the initial bundle revision is allocated per process. |
| `assets/videos/*` | Reload. The manifest is read per request and clip URLs carry a content revision. |
| `assets/splash/splash.js` / `.css` | Reload. The /tpl routes re-read them per request under an mtime cache, so a regenerated runtime shows up on the next page load. |
| `assets/templates/*` | Reload for a built-in; the store re-reads template.json per request. A USER template takes effect on the next page load with no restart. |
| `src/template-store.js` / `template-validate.js` / `trust-fence.js` | **Restart DSH** — they are imported by `entry.js`. |
| `src/music-store.js` / `template-store-remote.js` / `idcard-html.js` | **Restart DSH** — imported by `entry.js`. |
| `assets/editor/editor.html` | Reload the editor page. The route re-reads it per request under the static-text cache, so a regenerated editor shows up on the next open. |

Installed state: there are two routes, and they leave different footprints.

**The package route (the one users take).** `dsh plugin --profile web add <spec>` —
or, equivalently, the official **设置 → 插件 → 添加插件** page, which accepts an npm
package name, a GitHub repository URL, a local absolute directory, or a `.tgz`.
pnpm installs the package into the profile like any dependency; because the manifest
declares `dsh.bundle.patch`, the post-install bundle reconciliation adds the package
to the profile's `dsh.profile.bundles`, and its `cordis.patch.yml` becomes a bundle
layer patch contributing the one `- insert:` row that mounts the Host half. No
profile file is edited by hand, `package.json` is untouched, and uninstalling is the
official channel's job (`dsh plugin --profile web remove`, or the page). The spec
forms the installer accepts are exactly `parseInstallSpec`'s in
`@deepseek-ai/dsh-plugin-manager`: registry name[@range], `github:`/`git://`/`git@`/
hosted-repo URL, an absolute path (`file:`/`link:`/bare), and a tarball path or URL.
A git-hosted install clones and installs dependencies; this package ships no build
scripts, so nothing needs `allowBuilds` in the profile's `pnpm-workspace.yaml`.
`dependencies` then supply `@deepseek-ai/schemastery@^3.18.4` — including on the
settings card's behalf, which used to be the manual step. One exception inside this
route: a **bare local directory** spec normalizes to `link:` (verified: the manifest
records `link:C:/...` and the profile's `node_modules` gains only the symlink, never
the linked directory's own dependencies), so that form needs the directory to already
carry its `node_modules`; every other form — registry, git, `.tgz` — really does
install the declared dependency.

**The link route (the author's and the no-restart scripts').** `tools/install.ps1`
(Windows) and `tools/install.sh` (macOS / Linux) create a directory link in the
profile, append the one-row `- insert:` block to the profile's `cordis.patch.yml`,
and chain `@deepseek-ai/schemastery` from DSH's own copy because no package manager
runs on this route — the declared dependency is never installed for a link. Each
script's `uninstall.*` reverses exactly what it did. The profile to name is the one
DSH actually runs (`desktop` for the desktop app, `web` for `dsh web`), not the
script's default.

## Verifying a change

```sh
node build-client.mjs          # only if src/client.js changed
node verify/verify-entry.mjs   # Host half: Config, injection, manifest route
node verify/verify-degraded.mjs # the old-schema-library degradation path
node verify/verify-options.mjs  # the three interaction switches, against a stub DOM
node verify/verify-custom-clips.mjs # real HTTP import/auth/Range/persistence/removal in temporary profiles
node verify/verify-template-store.mjs # template discovery/override/validation/containment/tokens/fence
node verify/verify-splash-vendor.mjs # the vendored runtime's static contract (renames, glass, templates)
node verify/verify-music.mjs  # the music store, the whitelist, the routes and the fence
node verify/verify-store.mjs  # the remote store client and the install route, against a loopback stub
```

`verify/` **is** part of this tree, and those eight suites are what it can run
offline with no DSH process, no ports and no prompts. `verify-entry.mjs` and
`verify-degraded.mjs` cover the Host half; `verify-options.mjs` runs
`src/boot-screen.js` itself in a minimal DOM, because the screen is a script text
and a grep for `cfg.sound` would pass on a file that greps it and ignores it;
`verify-template-store.mjs` exercises the store and the fence against the real
`assets/templates` tree plus a temporary user directory; `verify-splash-vendor.mjs`
asserts the shipped runtime still satisfies the vendoring contract — no stale
global, no stale route, the glass patch intact, the postMessage vocabulary left
alone; `verify-music.mjs` drives the real music routes (including the fence's
fail-closed path) against a temporary profile; `verify-store.mjs` mounts the
install route against a loopback stub that answers the shapes the real raw URLs
would, so the only network-touching half of this package is proven without a
network.

The wider `verify-*` set and the `verify-all.mjs` aggregator named in
[docs/DEVELOPMENT_NOTES.md](docs/DEVELOPMENT_NOTES.md) belong to the author's working copy and are **not** in this
tree. What `tools/` holds here is the media and preview tooling:

| Tool | What it is for |
|---|---|
| `tools/apply-faststart.mjs` / `.bat` | Plan or perform the lossless `moov` move; backs the original up under `assets/videos/originals/` |
| `tools/faststart.mjs` | The rewrite itself, driven by the two above |
| `tools/box-chain.mjs` | Top-level box order of every clip in the pool |
| `tools/mp4-info.mjs` | Duration and resolution, read from `mvhd` / `tkhd` |
| `tools/mp4-audit.mjs` | Whether each clip's index actually points into its own `mdat` |
| `tools/codec-report.mjs` | The video codec fourcc per clip |
| `tools/preview.mjs` | Local two-server preview of the injection, without restarting DSH |
| `tools/install.ps1` / `tools/uninstall.ps1` | Add or remove the profile link and the patch row. Both name the profile the running DSH uses (`desktop`, not the `web` default) and both must leave `cordis.patch.yml` byte-identical except for the row they own — UTF-8, no BOM, CJK intact. `install.ps1`'s last step only *reports* whether a dsh server answered; it does not repair, and it does not roll back on a port it could not reach. |
| `tools/install.sh` / `tools/uninstall.sh` | The macOS / Linux twins of the pair above: same two changes, same backup, same UTF-8-safe line handling, plus a schema-version probe (≥ 3.18.4 with `.volatile()`). |
| `tools/vendor-splash-runtime.mjs` | Rebuild `assets/splash/` from the source trees (default `../dsh-boot-suite` and `../dsh-startup-screen` for the glass patch). Applies the rename map in one place and asserts nothing stale survived. Never hand-edit the output — the script is the source of truth. |
| `tools/pack-templates.mjs` | Rebuild `assets/templates/` from the source tree's template library, with the curated list and the per-template validation the suite asserts. |
| `tools/vendor-editor.mjs` | Rebuild `assets/editor/editor.html` from the source tree's editor page (default `../dsh-boot-suite`). Applies the route-base rename map in one place and asserts nothing stale survived. Never hand-edit the output. |
| `tools/preview.mjs` | Local two-server preview of BOTH forms: `?` for the clip screen (as before), `?form=template&template=<id>` for the template form, served through the real store module. |

For a Host-half change the offline proof that matters is that the module still
evaluates, still exports the schema the settings service looks for, and still
injects the same two head rows:

```sh
node --check entry.js
node -e "import('./entry.js').then(m => console.log(Object.keys(m), m.Config.toJSON()))"
```

[`verify/verify-entry.mjs`](verify/verify-entry.mjs) does exactly that with a stub
Host context and re-implementations of the settings service's own predicates;
[`verify/verify-degraded.mjs`](verify/verify-degraded.mjs) proves the same module
still evaluates when the resolved schema library lacks `.volatile()`.

## When someone reports something

| Report | Look at | Most likely |
|---|---|---|
| "Only the background shows" | The hint line (it names the failed clip and reason), then the card's pool rows | A clip that never paints. The loader skips it after 6s and says so. |
| "It works after a hard reload but not a normal one" | Response headers on the clip route | Something became cacheable. It must all be `no-store`. |
| "No card in Settings" | Console for `boot-animation:` warnings | The `Config` schema was not resolved, no field is volatile (`volatileForm()` drops the entry), or the patch `id` and `SETTINGS_NAMESPACE` disagree. The warning names the first case outright. |
| "No sound" | The audio-policy path in `toggleSound` / `startClip`, then the card's **播放影片声音** switch | Expected until the first click; Chromium will not autoplay unmuted. Confirm the hint says 开声音 — with the switch off there is deliberately no sound hint and no button. |
| "The sound drags on after the picture is gone" or "the audio cuts off mid-phrase on the way out" | `fadeOutClipAudio` and the span `enter()` computed | The ramp is not running: the element was already paused/ended (nothing left to fade), it is muted (nothing audible), or the overlay was removed before the ramp finished. |
| "It never enters" | The bound table in README ("启动路径上每个走不下去的地方都有上界") | Every route has a bound; if one fired, the hint line says which. |
| "A new clip does not play" | The card's badges | `未优化` → run `tools/apply-faststart.bat`. |

## House rules for this package

- Comments and docs are English; user-facing copy inside the plugin is Chinese.
- Every tool under `tools/` is named in a root document; the table above is that
  list. (The author's working copy enforces it with a `verify-tree-hygiene.mjs`
  suite, which is not part of this tree.)
- Generated `.ps1` / `.bat` / `.cmd` are **pure ASCII** — content, not filename.
- Bundled media stays in `assets/videos/`; rewrites keep its originals in the
  ignored `originals/` subdirectory. Imports belong to
  `<profile>/data/dsh-boot-animation/videos`, never to the npm package. Access to
  private media must pass `connection.requestRejection(req)` before reading or
  writing; profile paths and media files must not follow symlinks.
