#!/usr/bin/env node
// Rebuild assets/editor/editor.html from the vendored source tree.
//
// The template editor is a vendored, ADAPTED copy of dsh-boot-suite's
// tools/editor.html (MIT, © LeeRolling / 沈宏宏). This script is the only
// supported way to produce it: it copies the pristine file and applies the
// rename map below, so the adaptation is reviewable in one place instead of
// being an unexplained divergence between two 150 KB files.
//
// Usage (from the package root):
//   node tools/vendor-editor.mjs [source-root]
//
// `source-root` defaults to ../dsh-boot-suite. The script is deterministic and
// idempotent.

import { mkdirSync, rmSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE = fileURLToPath(new URL('..', import.meta.url))
const SOURCE = process.argv[2]
  ? join(process.cwd(), process.argv[2])
  : fileURLToPath(new URL('../../dsh-boot-suite', import.meta.url))
const OUT = join(PACKAGE, 'assets', 'editor')

/**
 * What the editor's own code calls, and what this package serves.
 *
 * The editor builds every URL from one base plus a few `API.replace` sites.
 * Two of those replaces exist because upstream's settings panel mounted the
 * editor under a `/config` path; this package has no such path, so the two
 * sites are rewritten to plain concatenations rather than left as no-op
 * replaces that would POST to the route root.
 */
const RENAMES = [
  // The base everything is built from.
  ["var API = '/dsh-startup'", "var API = '/plugins/dsh-boot-animation/tpl'"],
  // The two /config-shaped replaces: plain concatenation, same destination.
  ["API.replace('/config', '/template-assets/upload')", "API + '/template-assets/upload'"],
  ["API.replace('/config', '/template-asset/')", "API + '/template-asset/'"],
  // The help text names upstream's idcard route; this package has its own.
  ['/dsh-startup/idcard', '/plugins/dsh-boot-animation/tpl/idcard'],
]

/** The banner that replaces the source file's leading comment, if any. */
const BANNER = `<!--
  dsh-boot-animation — 模板编辑器 · VENDORED + ADAPTED
  来源：dsh-boot-suite（MIT，© LeeRolling / 沈宏宏）tools/editor.html。
  本文件由 tools/vendor-editor.mjs 生成；请勿手改后不同步脚本。
  适配：API 基准改到本插件的 /tpl 路由；两处 /config 形状的 replace 改成直接拼接。
-->
`

function main() {
  const file = join(SOURCE, 'tools', 'editor.html')
  try {
    statSync(file)
  } catch {
    throw new Error('source not found: ' + file + ' (pass the sibling checkout path as argv[2])')
  }

  // The source tree is CRLF; this package is LF.
  let text = readFileSync(file, 'utf8').split('\r\n').join('\n')
  for (const [from, to] of RENAMES) {
    if (!text.includes(from)) throw new Error('expected site not found: ' + from)
    text = text.split(from).join(to)
  }
  // Nothing of the old route prefix may survive — an editor that fetched the
  // other plugin's routes would silently read the wrong data.
  if (text.includes('/dsh-startup')) throw new Error('unrenamed route prefix survived')
  if (text.includes("'/config'")) throw new Error('unrenamed /config replace survived')

  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, 'editor.html'), BANNER + text, 'utf8')

  console.log('vendored editor written to ' + OUT)
  console.log('  editor.html  ' + text.length + ' chars')
}

main()
