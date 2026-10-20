# DSH Plugin Hub submission draft

Prepared for the [hub's submission format](https://dsh-plugin.org/submit). The fields below describe this community plugin; this document does not claim the hub has accepted or endorsed it.

## Issue title

```text
[Plugin submission] Alice-Marx/dsh-boot-animation — Chosen or random local startup videos with configurable transitions
```

## Issue body

### Repository

https://github.com/Alice-Marx/dsh-boot-animation

### One-line value

Replace the DeepSeek Harness startup page with a chosen or random local video, then transition into the app with configurable playback and fallback controls.

### Category

UI & Experience (用户界面与体验).

### Install command

```sh
dsh plugin --profile web add @ljwei-stak/dsh-boot-animation@0.4.0 --save-exact
```

Published npm package: [@ljwei-stak/dsh-boot-animation, version 0.4.0](https://www.npmjs.com/package/@ljwei-stak/dsh-boot-animation/v/0.4.0).

Desktop installation and the offline upgrade command are documented in the [README](https://github.com/Alice-Marx/dsh-boot-animation#install). Existing bundles should not receive a second manual insert entry.

### Compatibility

- Declared DSH minimum: `>=0.2.0-rc.2`.
- Node: `^22.19.0 || >=24.0.0`, ESM.
- Windows Desktop integration observed with DSH `0.2.0-rc.2` and `0.2.1-rc.2`.
- Chromium-based browsers targeted; Firefox and macOS/Linux were not independently certified in this acceptance.
- Accepted video containers: MP4, WebM, M4V, MOV, at most 256 MiB per import. Decoding depends on browser codec support; H.264/AAC MP4 is preferred.

### License

[MIT](https://github.com/Alice-Marx/dsh-boot-animation/blob/main/LICENSE). The repository license also declares the bundled MP4 work under MIT. Imported user media keeps its own rights.

### Screenshots / demo

- [Startup preview](https://github.com/Alice-Marx/dsh-boot-animation/blob/main/assets/screenshots/startup-preview.png)
- [Settings preview](https://github.com/Alice-Marx/dsh-boot-animation/blob/main/assets/screenshots/settings-preview.png)

These screenshots render the actual 0.4.0 source with real video playback and React controls in an isolated local Chromium demo. They contain sample form data, not a signed-in live DSH profile. They do not certify every host version or platform.

### Notes

The plugin is community maintained and is not affiliated with DeepSeek. It runs with the host's OS privileges, reads bundled assets, and writes/removes imported copies under the current profile's `data/dsh-boot-animation/videos`. The optional Optimize action rewrites a bundled MP4 with backups. Runtime requests are same-origin; no model API key, telemetry or external service is used by the plugin runtime. Installation uses the package registry or GitHub.

Custom media routes enforce the DSH connection rejection hook. Bundled media, manifest and Optimize handlers do not apply that same hook themselves. Exposing DSH remotely requires access control for the entire `/plugins/dsh-boot-animation/` prefix. Audio is subject to browser gesture policy.

Original upstream: https://github.com/lxj5820/dsh-boot-animation

Official host reference: https://github.com/deepseek-ai/deepseek-harness

### Pre-submission checklist

- [x] Repository is public.
- [x] GitHub topic `dsh-plugin` is present.
- [x] README includes a complete install command and profile.
- [x] Host entry exports an `apply(ctx)` function.
- [x] Repository root includes `package.json` with matching npm name/version.
- [x] Version `0.4.0` is available on npm.
- [x] Configuration, permissions, compatibility, license and screenshots are documented.

## Listing badge activation

On 2026-10-20, both the `Alice-Marx` and lowercase `alice-marx` detail URL variants returned HTTP 404. A matching canonical listing has not been verified. Keep the badge inactive until the detail page exists, then use its actual owner/slug:

```markdown
[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/your-owner/your-plugin-slug)
```

A public repository, a topic, or a generic badge SVG alone is not evidence of directory acceptance.
