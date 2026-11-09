#!/usr/bin/env node
// Rebuild assets/splash/ from the vendored source tree.
//
// The runtime under assets/splash/ is a vendored, ADAPTED copy of
// dsh-boot-suite's splash runtime (MIT, © LeeRolling / 沈宏宏). This script is
// the only supported way to produce it: it copies the pristine source and then
// applies the rename map below, so the adaptation is reviewable in one place
// instead of being an unexplained divergence between two 4000-line files.
//
// Usage (from the package root):
//   node tools/vendor-splash-runtime.mjs [source-root]
//
// `source-root` defaults to ../dsh-boot-suite — the sibling checkout this
// package was ported from. The script is deterministic and idempotent: running
// it twice produces byte-identical output.
//
// What the rename map changes, and why each entry exists:
//
//   __DSH_STARTUP*          → __DSH_BOOT_ANIM_TPL_*
//     Two boot plugins in one profile would otherwise share one config global,
//     and the last injection would silently win for both.
//   dsh-startup-root        → dsh-boot-anim-tpl
//     Same reason, for the DOM: two roots with one id means one of them owns
//     every #id rule in the sheet.
//   /dsh-startup/…          → BASE + '/…'
//     The route prefix. Resolved from one injected global so the same file
//     serves any deployment.
//   dsh-startup-screen:*    → dsh-boot-animation:tpl-*
//     The session/daily "already shown" keys. Shared, they would suppress the
//     other plugin's screen for the rest of the day.
//
// What it deliberately does NOT rename:
//
//   .dsu-* class names       Shared with the source tree on purpose. Both
//                            stylesheets describe the same rules for the same
//                            class names; the root id is what scopes them, and
//                            a mechanical class rename across 1600 lines of CSS
//                            and 4000 lines of JS is a larger risk than the
//                            collision it would prevent.
//   dsh-startup-done etc.    The postMessage contract an iframe template speaks.
//                            A template from the source tree posts these names;
//                            renaming them here would break every imported
//                            template that honours the documented contract.

import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE = fileURLToPath(new URL('..', import.meta.url))
const SOURCE = process.argv[2]
  ? join(process.cwd(), process.argv[2])
  : fileURLToPath(new URL('../../dsh-boot-suite', import.meta.url))
// The liquid-glass treatment is NOT in the suite runtime; it belongs to
// dsh-startup-screen, the suite's upstream. It is ported from that tree as a
// documented patch rather than hand-written, so the shipped file stays
// generated end to end.
const SOFT_SOURCE = process.argv[3]
  ? join(process.cwd(), process.argv[3])
  : fileURLToPath(new URL('../../dsh-startup-screen', import.meta.url))
const OUT = join(PACKAGE, 'assets', 'splash')

/** Every global token the runtime reads, longest suffix first. */
const GLOBALS = [
  ['__DSH_STARTUP_TEMPLATE2__', '__DSH_BOOT_ANIM_TPL_2__'],
  ['__DSH_STARTUP_TEMPLATE__', '__DSH_BOOT_ANIM_TPL_1__'],
  ['__DSH_STARTUP_SCRIPT_URL__', '__DSH_BOOT_ANIM_TPL_SRC__'],
  ['__DSH_STARTUP_LOADED__', '__DSH_BOOT_ANIM_TPL_LOADED__'],
  ['__DSH_STARTUP_FAILED__', '__DSH_BOOT_ANIM_TPL_FAILED__'],
  ['__DSH_STARTUP_SKIP__', '__DSH_BOOT_ANIM_TPL_SKIP__'],
  ['__DSH_STARTUP_API__', '__DSH_BOOT_ANIM_TPL_API__'],
  ['__DSH_STARTUP_TPL_BASE__', '__DSH_BOOT_ANIM_TPL_BASE__'],
  ['__DSH_STARTUP_API_BASE__', '__DSH_BOOT_ANIM_TPL_BASE__'],
  ['__DSH_STARTUP_JUMP__', '__DSH_BOOT_ANIM_TPL_JUMP__'],
  ['__DSH_STARTUP_EDIT__', '__DSH_BOOT_ANIM_TPL_EDIT__'],
  ['__DSH_STARTUP_TL__', '__DSH_BOOT_ANIM_TPL_TL__'],
  ['__DSH_STARTUP__', '__DSH_BOOT_ANIM_TPL_CFG__'],
]

/** Route literals, in the order they must be applied (longest prefix first). */
const ROUTES = [
  ["'/dsh-startup/template-asset/'", "BASE + '/template-asset/'"],
  ["'/dsh-startup/template-frame/'", "BASE + '/template-frame/'"],
  ["'/dsh-startup/template-file/'", "BASE + '/template-file/'"],
  ["'/dsh-startup/frame-session'", "BASE + '/frame-session'"],
  ["'/dsh-startup/splash.js?t='", "BASE + '/splash.js?t='"],
  ["'/dsh-startup/music/file?name='", "BASE + '/music/file?name='"],
  ["'/dsh-startup/voice/'", "BASE + '/voice/'"],
  ["'/dsh-startup/asset/'", "BASE + '/asset/'"],
  ["'/dsh-startup/diag'", "BASE + '/diag'"],
  // The four base-override fallbacks: the exact quoted literal. Last among the
  // route rules, because it is the shortest form and every longer literal has
  // already been rewritten by the time this one runs.
  ["'/dsh-startup'", "BASE"],
]

/** DOM ids and storage keys. */
const IDENTIFIERS = [
  ['dsh-startup-caption', 'dsh-boot-anim-tpl-caption'],
  ['dsh-startup-root', 'dsh-boot-anim-tpl'],
  ['dsh-startup-trans', 'dsh-boot-anim-tpl-trans'],
  ['dsh-startup-act2', 'dsh-boot-anim-tpl-act2'],
  ['dsh-startup-screen:shown', 'dsh-boot-animation:tpl-shown'],
  ['dsh-startup-screen:day', 'dsh-boot-animation:tpl-day'],
  // The window 'done' event, which is NOT the postMessage contract: it is this
  // runtime telling its own page the run finished. The postMessage types
  // (dsh-startup-done / -skip / -voice / -bgm) are deliberately left alone —
  // an imported template speaks them.
  ['dsh-startup:done', 'dsh-boot-animation:tpl-done'],
  ['[dsh-startup-screen]', '[dsh-boot-animation]'],
]

/** Where BASE is declared, and the one flag the bootstrap's fallback reads. */
const BASE_DECLARATION = `
  /* Route prefix for everything this runtime fetches. Injected by the Host so
     the same file serves any deployment; the literal is the package's own
     route prefix and is what an unprefixed page (the offline preview) gets. */
  var BASE = (function () {
    try { return String(window.__DSH_BOOT_ANIM_TPL_BASE__ || '') } catch (eVb) { return '' }
  })() || '/plugins/dsh-boot-animation/tpl'
`

const RUNNING_FLAG = `    runStarted = true
    try { window.__DSH_BOOT_ANIM_TPL_RUNNING__ = true } catch (eRun) { /* noop */ }`

/** The vendored banner that replaces the source file's own header. */
const BANNER = `/* ============================================================================
 * dsh-boot-animation — 开屏模板运行时（浏览器端，零依赖）· VENDORED + ADAPTED
 * ----------------------------------------------------------------------------
 * 来源：dsh-boot-suite（MIT，© LeeRolling / 沈宏宏）lib/splash.js，
 *       其上游为 dsh-startup-screen（MIT，© 沈宏宏）。
 * 本文件由 tools/vendor-splash-runtime.mjs 生成；请勿手改后不同步脚本 ——
 * 改动应做在源仓库，再重跑脚本，适配点集中在文件头的映射表里。
 *
 * 相对源仓库的适配（全部是命名隔离，没有行为变化）：
 *   · 全局 __DSH_STARTUP*        → __DSH_BOOT_ANIM_TPL_*
 *   · 根节点 id dsh-startup-root → dsh-boot-anim-tpl
 *   · 路由前缀 /dsh-startup      → BASE（默认 /plugins/dsh-boot-animation/tpl）
 *   · 存储键 dsh-startup-screen: → dsh-boot-animation:tpl-
 *   · 新增 __DSH_BOOT_ANIM_TPL_RUNNING__（bootstrap 的兜底判据）
 * 未改名：.dsu-* 类名（与源仓库共用，根 id 已区分）、
 *         postMessage 的 dsh-startup-done/skip/voice/bgm（iframe 模板契约）。
 * ========================================================================== */
`

/**
 * The liquid-glass patch, ported from dsh-startup-screen (MIT, © 沈宏宏).
 *
 * The suite runtime has no glass treatment; it belongs to the suite's upstream.
 * It ships here as a documented patch rather than a hand edit so the artifact
 * stays generated. The block is guarded by `C.glass`, and the Host's default
 * for that field is off — so a defect in the patch degrades to "no glass"
 * rather than to a broken screen.
 */
const GLASS_DEFAULTS = `    /* 液态玻璃（移植自 dsh-startup-screen）：只让背景层半透明 + 磨砂 */
    glass: false,
    glassOpacity: 0.75,
    glassBlur: 22,
    glassSaturate: 160,
    glassBackdropBlur: 28`

const GLASS_BLOCK = `
  /* ── 液态玻璃（移植自 dsh-startup-screen，MIT © 沈宏宏）──────────────────
     只让「背景层」（底板 / 黑幕）半透明 + 磨砂；文字、线条、鲸鱼标识、读数
     保持实心 —— 稿面主体保留，只是能透过它看到背后的界面。
     背景模糊不依赖 backdrop-filter：跨堆叠上下文时它会被静默忽略，
     所以直接给 body 里除自己以外的根节点加 filter，finish 时还原。 */
  var blurredNodes = []
  function blurAppBackdrop(px) {
    try {
      if (!document.body || !document.body.children) return
      for (var gi = 0; gi < document.body.children.length; gi++) {
        var gnode = document.body.children[gi]
        if (!gnode || !gnode.style || gnode.id === ROOT_ID) continue
        blurredNodes.push({ node: gnode, filter: gnode.style.filter || '' })
        gnode.style.transition = 'filter 420ms ease'
        gnode.style.filter = px > 0 ? 'blur(' + px + 'px)' : ''
      }
    } catch (eGb) { /* 兜底不抛 */ }
  }
  function restoreAppBackdrop() {
    for (var ri = 0; ri < blurredNodes.length; ri++) {
      var grit = blurredNodes[ri]
      try {
        grit.node.style.filter = grit.filter
        grit.node.style.transition = ''
      } catch (eGr) { /* noop */ }
    }
    blurredNodes.length = 0
  }

  if (C.glass) {
    root.classList.add('dsu-glass')
    root.style.setProperty('--dsu-glass-alpha', String(clamp01(C.glassOpacity, 0.15, 0.95)))
    root.style.setProperty('--dsu-glass-blur', clamp01(C.glassBlur, 0, 60) + 'px')
    root.style.setProperty('--dsu-glass-sat', clamp01(C.glassSaturate, 100, 200) + '%')
    /* 底板铺满之后再放开透明：DSH 0.2.1 起启动期 body 被强制白底，
       一上来透明就会在首帧露出白色，看起来就是「闪一下」。 */
    root.style.setProperty('--dsu-backdrop-blur', clamp01(C.glassBackdropBlur, 0, 80) + 'px')
    if (clamp01(C.glassBackdropBlur, 0, 80) > 0) blurAppBackdrop(Math.min(60, clamp01(C.glassBackdropBlur, 0, 80)))
  } else {
    root.classList.remove('dsu-glass')
  }
`

/** Apply every rename, then assert none of the old names survived. */
function adapt(source) {
  // The source tree is CRLF; this package is LF. Normalised on read so every
  // pattern below may be written with \n, and so the shipped artifact matches
  // the rest of the tree rather than being the one CRLF file in it.
  let text = source.split('\r\n').join('\n')
  for (const [from, to] of GLOBALS) {
    if (!text.includes(from)) throw new Error('expected global not found: ' + from)
    text = text.split(from).join(to)
  }
  for (const [from, to] of ROUTES) {
    if (!text.includes(from)) throw new Error('expected route not found: ' + from)
    text = text.split(from).join(to)
  }
  for (const [from, to] of IDENTIFIERS) {
    text = text.split(from).join(to)
  }
  // Prose: the source's comments name the old route prefix. Rewritten so the
  // shipped file describes the routes this package actually serves.
  text = text.split('/dsh-startup').join('/plugins/dsh-boot-animation/tpl')
  // The route prefix is gone from the source text; anything left is a missed
  // site and must fail the build rather than ship a runtime that fetches the
  // other plugin's routes.
  if (text.includes('/dsh-startup')) throw new Error('unrenamed route prefix survived')
  if (/__DSH_STARTUP/.test(text)) throw new Error('unrenamed global survived')
  if (text.includes('dsh-startup-root')) throw new Error('unrenamed root id survived')

  // Banner: replace the source file's header block (everything before the IIFE).
  const iife = text.indexOf('(function () {')
  if (iife < 0) throw new Error('runtime IIFE not found')
  text = BANNER + text.slice(iife)

  // BASE, declared right after the root id so every use below it resolves.
  const rootId = "  var ROOT_ID = 'dsh-boot-anim-tpl'"
  if (!text.includes(rootId)) throw new Error('root id declaration not found')
  text = text.replace(rootId, rootId + '\n' + BASE_DECLARATION)

  // The flag the bootstrap's 9-second fallback waits on.
  if (!text.includes('    runStarted = true\n')) throw new Error('run() entry not found')
  text = text.replace('    runStarted = true\n', RUNNING_FLAG + '\n')

  // Glass: the config keys the runtime merges, the block itself, and the
  // restore call in finish(). Three anchored insertions, each asserted.
  // The DEFAULTS anchor includes the object's closing brace, because the last
  // property in it carries no comma — appending after the bare property would
  // produce exactly the syntax error this shape prevents.
  const defaultsTail = "    transitionDir: 'left'\n  }"
  if (!text.includes(defaultsTail)) throw new Error('DEFAULTS tail not found')
  text = text.replace(defaultsTail, "    transitionDir: 'left',\n" + GLASS_DEFAULTS + '\n  }')

  const uiAnchor = '\n  var ui = {}\n'
  if (!text.includes(uiAnchor)) throw new Error('ui anchor not found')
  text = text.replace(uiAnchor, '\n' + GLASS_BLOCK + uiAnchor)

  const invalidate = '    invalidateRun()   /* 取消体系：本次播放的延时任务全部作废 */\n'
  if (!text.includes(invalidate)) throw new Error('finish() invalidateRun not found')
  text = text.replace(invalidate, invalidate
    + '    try { restoreAppBackdrop() } catch (eGlassRestore) { /* noop */ }\n')
  return text
}

function copyTree(from, to) {
  rmSync(to, { recursive: true, force: true })
  mkdirSync(to, { recursive: true })
  cpSync(from, to, { recursive: true, dereference: true })
}

function main() {
  for (const rel of ['lib/splash.js', 'lib/splash.css']) {
    const file = join(SOURCE, rel)
    try {
      statSync(file)
    } catch {
      throw new Error('source not found: ' + file + ' (pass the sibling checkout path as argv[2])')
    }
  }

  // Static media: the interface sound effects and the six voice packs. Copied
  // with Node, never with a shell: the tree holds CJK-named metadata and a
  // PowerShell round-trip destroys it.
  copyTree(join(SOURCE, 'lib', 'assets', 'voices'), join(OUT, 'voices'))
  mkdirSync(join(OUT, 'assets'), { recursive: true })
  for (const name of ['sfx-tick.mp3', 'sfx-ticks-run.mp3']) {
    cpSync(join(SOURCE, 'lib', 'assets', name), join(OUT, 'assets', name))
  }

  const js = adapt(readFileSync(join(SOURCE, 'lib', 'splash.js'), 'utf8'))
  writeFileSync(join(OUT, 'splash.js'), js, 'utf8')

  const css = readFileSync(join(SOURCE, 'lib', 'splash.css'), 'utf8').split('\r\n').join('\n')
  let cssOut = css
  for (const [from, to] of IDENTIFIERS) {
    cssOut = cssOut.split(from).join(to)
  }
  if (cssOut.includes('dsh-startup-root')) throw new Error('unrenamed root id survived in CSS')

  // Glass CSS: the block from the upstream tree, extracted between its own
  // markers so a drift in the source fails here instead of shipping half of it.
  const softCss = readFileSync(join(SOFT_SOURCE, 'lib', 'splash.css'), 'utf8').split('\r\n').join('\n')
  const cssStart = softCss.indexOf('/* ── 液态玻璃（可选图层）')
  const cssEnd = softCss.indexOf('.dsu-backdrop {')
  if (cssStart < 0 || cssEnd < 0) throw new Error('glass CSS markers not found in ' + SOFT_SOURCE)
  const cssClose = softCss.indexOf('\n}\n', cssEnd)
  if (cssClose < 0) throw new Error('glass CSS block not closed')
  let glassCss = softCss.slice(cssStart, cssClose + 3)
  for (const [from, to] of IDENTIFIERS) {
    glassCss = glassCss.split(from).join(to)
  }
  cssOut += '\n/* ── 液态玻璃（移植自 dsh-startup-screen，MIT © 沈宏宏）────────────── */\n'
    + glassCss.trimEnd() + '\n'
  writeFileSync(join(OUT, 'splash.css'), cssOut, 'utf8')

  console.log('vendored runtime written to ' + OUT)
  console.log('  splash.js  ' + js.length + ' chars')
  console.log('  splash.css ' + cssOut.length + ' chars (glass +' + glassCss.length + ')')
}

main()
