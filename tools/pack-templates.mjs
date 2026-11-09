#!/usr/bin/env node
// Rebuild assets/templates/ from the vendored source tree.
//
// The built-in templates are vendored copies from dsh-boot-suite (MIT, with
// per-template licenses preserved inside each template.json — including the
// BSD-3-Clause whale-girl-scan, whose media originates from
// NativeDog1/dsh-boot-animation). This script is the supported way to produce
// the directory: it copies the curated list below, then validates every
// template it copied, so a source change that breaks the schema fails here
// instead of at boot.
//
// Usage (from the package root):
//   node tools/pack-templates.mjs [source-root]
//
// The curated list is deliberate. The source tree ships 24 templates, several
// of them multi-megabyte video acts; this package ships the ones that
// demonstrate the distinct FORMS the engine can run, and documents the import
// path for the rest (MANUAL.md: drop a directory into
// <profile>/data/dsh-boot-animation/templates/).

import { cpSync, mkdirSync, rmSync, readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateTemplate } from '../src/template-validate.js'

const PACKAGE = fileURLToPath(new URL('..', import.meta.url))
const SOURCE = process.argv[2]
  ? join(process.cwd(), process.argv[2])
  : fileURLToPath(new URL('../../dsh-boot-suite/templates', import.meta.url))
const OUT = join(PACKAGE, 'assets', 'templates')

/**
 * What ships, and the form each one demonstrates.
 *
 *   steps     — the scene-sequence engine (zh/en text, voice line, hold, progress)
 *   timeline  — the layer/keyframe engine (11 layer types, per-frame easing)
 *   iframe    — a whole document of its own, sandboxed, capability-tokened
 */
const CURATED = [
  ['archive-warm', 'steps — the classic authorisation sequence (沈宏宏)'],
  ['deep-sonar', 'steps — dark five-scene descent with voice lines'],
  ['terminal-phosphor', 'steps — terminal phosphor, six scenes'],
  ['whale-girl-scan', 'timeline — full-screen video act (BSD-3-Clause)'],
  ['550c-homage', 'timeline — character-particle globe, six segments'],
  ['chars-globe', 'timeline — minimal character globe'],
  ['earth-globe', 'timeline — rotating earth'],
  ['world-line', 'timeline — world line'],
  ['timeline-demo', 'timeline — keyframe primer'],
  ['wipe-demo', 'timeline — wipe transition primer'],
  ['effects-gallery', 'timeline — overlay effects gallery'],
  ['division-bigfish-codex', 'iframe — a whole document with an easter egg'],
]

/** Files the runtime never reads, kept out of the package. */
const EXCLUDE = new Set([
  'preview.gif',
  'preview.png',
  'preview-normal.mp4',
  'preview-easteregg.mp4',
])

function copyTemplate(id) {
  const from = join(SOURCE, id)
  const to = join(OUT, id)
  rmSync(to, { recursive: true, force: true })
  mkdirSync(to, { recursive: true })
  cpSync(from, to, {
    recursive: true,
    dereference: true,
    filter: (source) => !EXCLUDE.has(source.split(/[\\/]/).pop()),
  })
}

function directorySize(dir) {
  let total = 0
  const walk = (current) => {
    for (const entry of readdirSyncSafe(current)) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) walk(path)
      else {
        try {
          total += statSync(path).size
        } catch {
          /* a file that vanished mid-walk is not worth failing the pack over */
        }
      }
    }
  }
  walk(dir)
  return total
}

function readdirSyncSafe(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

function main() {
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })
  let failures = 0
  let bytes = 0
  for (const [id, note] of CURATED) {
    try {
      statSync(join(SOURCE, id, 'template.json'))
    } catch {
      console.error('  MISS ' + id + '   (not in ' + SOURCE + ')')
      failures += 1
      continue
    }
    copyTemplate(id)
    const raw = JSON.parse(readFileSync(join(OUT, id, 'template.json'), 'utf8'))
    const checked = validateTemplate({ ...raw, id })
    if (!checked.ok) {
      console.error('  FAIL ' + id + '   validateTemplate: ' + checked.reason)
      failures += 1
      continue
    }
    const size = directorySize(join(OUT, id))
    bytes += size
    const engine = checked.value.engine === 'iframe'
      ? 'iframe'
      : (Array.isArray(checked.value.layers) && checked.value.layers.length ? 'timeline' : 'steps')
    console.log('  ok   ' + id.padEnd(24) + engine.padEnd(9)
      + (size / 1024).toFixed(0).padStart(7) + ' KB   ' + note)
  }
  writeFileSync(join(OUT, 'README.md'), [
    '# 内置开屏模板（vendored）',
    '',
    '这些模板随插件发布，全部是**纯数据**（template.json + 素材），由',
    'assets/splash/splash.js 运行时解释执行。来源与授权见各模板 template.json',
    '内的 author / license 字段，以及包根的 CREDITS.md。',
    '',
    '| 模板 | 引擎 | 说明 |',
    '|---|---|---|',
    ...CURATED.map(([id, note]) => '| ' + id + ' | ' + note.split(' — ')[0] + ' | ' + note.split(' — ')[1] + ' |'),
    '',
    '由 tools/pack-templates.mjs 从 dsh-boot-suite 打包；改动请回源仓库后重跑。',
    '',
  ].join('\n'), 'utf8')
  console.log('packed ' + CURATED.length + ' templates, '
    + (bytes / 1024 / 1024).toFixed(1) + ' MB total'
    + (failures === 0 ? '' : ', ' + failures + ' FAILURES'))
  if (failures > 0) process.exitCode = 1
}

main()
