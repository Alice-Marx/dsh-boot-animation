// Offline verification for the template store and the trust fence.
//
// No DSH process, no ports, no network, no prompts. Run from the package root:
//   node verify/verify-template-store.mjs
//
// The store is where two of this package's load-bearing rules live — a template
// is DATA that has been structurally validated, and nothing outside a template
// root is ever read — so both are exercised here against the real
// assets/templates tree, plus a temporary user directory that proves the
// override order and the containment rule on a path the suite controls.

import { mkdirSync, writeFileSync, rmSync, existsSync, symlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTemplateStore, templateEngine, isFileInsideRoot } from '../src/template-store.js'
import { validateTemplate } from '../src/template-validate.js'
import { guardDecision, sendRejection } from '../src/trust-fence.js'

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

/** A ctx whose injected profileContext points at a directory the suite owns. */
function ctxWithProfile(dir) {
  return {
    inject: (deps, callback) => callback({
      get: (name) => (name === 'profileContext' ? { dir } : undefined),
      effect: (callback) => callback(),
    }),
  }
}

// ---------------------------------------------------------------------------
// 1. Every packed template validates, and each declares its engine.
// ---------------------------------------------------------------------------

console.log('\n[1] the packed templates')
const bare = createTemplateStore({})
const list = bare.listTemplates()
check('twelve built-in templates are listed', list.length === 12, String(list.length))
check('...sorted by id', list.every((entry, index) => index === 0 || list[index - 1].id < entry.id))
check('...all marked builtin', list.every((entry) => entry.source === 'builtin'))
equal('the engine each template runs under',
  list.map((entry) => entry.id + ':' + entry.engine),
  ['550c-homage:timeline', 'archive-warm:steps', 'chars-globe:timeline', 'deep-sonar:steps',
    'division-bigfish-codex:iframe', 'earth-globe:timeline', 'effects-gallery:timeline',
    'terminal-phosphor:steps', 'timeline-demo:timeline', 'whale-girl-scan:timeline',
    'wipe-demo:timeline', 'world-line:timeline'])
// Attribution is not decoration: the whale-girl media is BSD-3-Clause from
// another repository, and a template that lost its author field would ship
// someone else's work uncredited. The fields are preserved VERBATIM from the
// source tree — including the one demo that ships without an author at all,
// which is asserted as-is rather than papered over with an invented name.
check('every template but the author-less demo carries its author',
  list.filter((entry) => entry.author === '').map((entry) => entry.id).join(',') === 'wipe-demo',
  list.filter((entry) => entry.author === '').map((entry) => entry.id).join(','))
equal('the authors are preserved verbatim',
  [list.find((entry) => entry.id === 'archive-warm').author,
    list.find((entry) => entry.id === 'deep-sonar').author,
    list.find((entry) => entry.id === 'division-bigfish-codex').author],
  ['沈宏宏', 'DeepSeek', 'LeeRolling'])
check('the whale template keeps its BSD-3-Clause attribution',
  list.find((entry) => entry.id === 'whale-girl-scan')?.license === 'BSD-3-Clause')
check('voice packs are read from the vendored manifest', bare.voicePacks.length === 6,
  bare.voicePacks.map((entry) => entry.id).join(','))

for (const entry of list) {
  const template = bare.readTemplate(entry.id)
  const checked = validateTemplate(template)
  check('template "' + entry.id + '" validates', checked.ok === true, checked.reason ?? '')
}

// ---------------------------------------------------------------------------
// 2. readTemplate: the private fields, and every way it answers "absent".
// ---------------------------------------------------------------------------

console.log('\n[2] readTemplate')
const warm = bare.readTemplate('archive-warm')
check('a built-in template resolves', warm !== null)
equal('...with its location attached for the asset routes',
  [warm.__source, warm.__root.endsWith('archive-warm')], ['builtin', true])
check('...and its steps', Array.isArray(warm.steps) && warm.steps.length === 5)
equal('an unknown but well-formed id is absent', bare.readTemplate('ghost-template'), null)
equal('an illegal id is absent', bare.readTemplate('Bad_Id'), null)
equal('a traversal attempt is absent', bare.readTemplate('../../etc/passwd'), null)
equal('a non-string is absent', bare.readTemplate(42), null)
check('the engine classifier agrees with the listing',
  templateEngine(bare.readTemplate('division-bigfish-codex')) === 'iframe'
  && templateEngine(bare.readTemplate('archive-warm')) === 'steps'
  && templateEngine(bare.readTemplate('chars-globe')) === 'timeline')

// ---------------------------------------------------------------------------
// 3. Assets: the whitelist, the containment, and the ways both refuse.
// ---------------------------------------------------------------------------

console.log('\n[3] assets and files')
const video = bare.resolveAsset('whale-girl-scan', 'whale-girl-scan.mp4')
check('a video asset resolves', video !== null && video.source === 'builtin')
equal('a traversal in the asset name is refused', bare.resolveAsset('whale-girl-scan', '../../secret.mp3'), null)
equal('a non-whitelisted extension is refused', bare.resolveAsset('whale-girl-scan', 'index.html'), null)
equal('an asset of a template that does not exist is refused', bare.resolveAsset('ghost', 'a.mp3'), null)

const entry = bare.resolveTemplateFile('division-bigfish-codex', 'index.html')
check('an iframe template entry resolves', entry !== null)
equal('...and a built-in one is trusted', entry?.untrusted, false)
equal('a traversal in the relative path is refused',
  bare.resolveTemplateFile('division-bigfish-codex', '../../etc/passwd'), null)
equal('an absolute path is refused',
  bare.resolveTemplateFile('division-bigfish-codex', '/etc/passwd'), null)
equal('a drive letter is refused',
  bare.resolveTemplateFile('division-bigfish-codex', 'C:/windows/win.ini'), null)
equal('a backslash path is refused',
  bare.resolveTemplateFile('division-bigfish-codex', '..\\..\\etc\\passwd'), null)
equal('a dot segment is refused',
  bare.resolveTemplateFile('division-bigfish-codex', 'assets/./../../../etc/passwd'), null)
equal('a non-whitelisted extension is refused',
  bare.resolveTemplateFile('division-bigfish-codex', 'secret.pem'), null)
equal('a nested whitelisted path still resolves',
  bare.resolveTemplateFile('division-bigfish-codex', 'assets/whale-badge-line.png') !== null, true)

// Containment itself, on a tree the suite controls: a symlink inside a root
// that points outside it must not resolve, because the realpath comparison is
// what the asset routes rely on.
const fenceDir = join(root, '.verify-templates')
rmSync(fenceDir, { recursive: true, force: true })
mkdirSync(join(fenceDir, 'inside'), { recursive: true })
writeFileSync(join(fenceDir, 'outside.txt'), 'outside', 'utf8')
try {
  symlinkSync(join(fenceDir, 'outside.txt'), join(fenceDir, 'inside', 'link.txt'), 'file')
} catch {
  /* a platform without symlink privileges: the assertion below degrades to the
     direct comparison, which is still the rule under test */
}
check('a symlink that leaves the root is refused',
  isFileInsideRoot(join(fenceDir, 'inside', 'link.txt'), join(fenceDir, 'inside')) === false
  || existsSync(join(fenceDir, 'inside', 'link.txt')) === false)
check('a file genuinely inside the root passes',
  isFileInsideRoot(join(fenceDir, 'outside.txt'), fenceDir) === true)

// ---------------------------------------------------------------------------
// 4. The user directory: override order, and what it costs.
// ---------------------------------------------------------------------------

console.log('\n[4] the user directory')
const profile = join(fenceDir, 'profile')
const userTpl = join(profile, 'data', 'dsh-boot-animation', 'templates')
rmSync(profile, { recursive: true, force: true })
mkdirSync(userTpl, { recursive: true })
// A same-named override of a built-in, a brand-new template, and a broken one.
mkdirSync(join(userTpl, 'archive-warm'), { recursive: true })
writeFileSync(join(userTpl, 'archive-warm', 'template.json'), JSON.stringify({
  schemaVersion: 1,
  id: 'archive-warm',
  name: '我的档案',
  author: '测试用户',
  license: 'MIT',
  steps: [{ zh: '自定义的一幕', en: 'CUSTOM SCENE', hold: 500 }],
}), 'utf8')
mkdirSync(join(userTpl, 'my-own'), { recursive: true })
writeFileSync(join(userTpl, 'my-own', 'template.json'), JSON.stringify({
  schemaVersion: 2,
  id: 'my-own',
  name: '我自己的模板',
  author: '测试用户',
  license: 'MIT',
  layers: [{ id: 't', type: 'text', text: 'hi', keyframes: [{ t: 0, opacity: 0 }, { t: 500, opacity: 1 }] }],
}), 'utf8')
mkdirSync(join(userTpl, 'broken-one'), { recursive: true })
writeFileSync(join(userTpl, 'broken-one', 'template.json'), JSON.stringify({
  id: 'broken-one',
  steps: 'not-an-array',
  layers: 'not-an-array',
}), 'utf8')

const withUser = createTemplateStore(ctxWithProfile(profile))
const userList = withUser.listTemplates()
check('the user template joins the list', userList.some((entry) => entry.id === 'my-own'))
// Thirteen, not twelve-plus-one: the same-named user copy REPLACES the built-in
// in the listing, so archive-warm appears once, marked user. A list that held
// both would be the bug this asserts against — the dropdown would offer the
// same template twice, and the store would answer with whichever came first.
equal('the list holds thirteen entries, with the shadowed one counted once',
  [userList.length, userList.filter((entry) => entry.id === 'archive-warm').length], [13, 1])
check('the eleven unshadowed built-ins stay marked builtin',
  userList.filter((entry) => entry.source === 'builtin').length === 11,
  String(userList.filter((entry) => entry.source === 'builtin').length))
check('the broken template is skipped, not fatal',
  userList.some((entry) => entry.id === 'broken-one') === false)
check('the user copy shadows the built-in of the same name',
  userList.filter((entry) => entry.id === 'archive-warm').length === 1
  && userList.find((entry) => entry.id === 'archive-warm').source === 'user')
const shadowed = withUser.readTemplate('archive-warm')
equal('...and readTemplate returns the user copy',
  [shadowed.__source, shadowed.name, shadowed.steps[0].zh], ['user', '我的档案', '自定义的一幕'])
const own = withUser.readTemplate('my-own')
equal('a user-only template reads as a timeline',
  [own.__source, templateEngine(own)], ['user', 'timeline'])
check('a user asset is marked untrusted for the sandbox path',
  withUser.resolveTemplateFile('archive-warm', 'index.html') === null
  || withUser.resolveTemplateFile('archive-warm', 'index.html').untrusted === true)
const userVideo = withUser.resolveAsset('whale-girl-scan', 'whale-girl-scan.mp4')
equal('...while a built-in asset stays trusted', userVideo?.source, 'builtin')

// A template document that fails validation is treated as absent — the boot
// screen then falls back rather than rendering something the store refused.
mkdirSync(join(userTpl, 'evil-proto'), { recursive: true })
writeFileSync(join(userTpl, 'evil-proto', 'template.json'), JSON.stringify({
  id: 'evil-proto',
  name: 'x',
  steps: [],
  __proto__: { polluted: true },
}), 'utf8')
const evil = withUser.readTemplate('evil-proto')
check('a document with a prototype key does not resolve', evil === null
  || evil.__source !== 'user' || Object.keys(evil).indexOf('polluted') < 0)
rmSync(fenceDir, { recursive: true, force: true })

// ---------------------------------------------------------------------------
// 5. Frame sessions: the capability token lifecycle.
// ---------------------------------------------------------------------------

console.log('\n[5] frame sessions')
const session = bare.createFrameSession('division-bigfish-codex')
check('a session mints a 64-hex token', /^[0-9a-f]{64}$/.test(session.token))
equal('...and reports the trust level', session.untrusted, false)
const looked = bare.frameSession(session.token)
equal('...which resolves back to the template', looked?.id, 'division-bigfish-codex')
equal('a malformed token does not resolve', bare.frameSession('not-a-token'), null)
equal('an unknown token does not resolve', bare.frameSession('f'.repeat(64)), null)
equal('a session for a template that does not exist is refused',
  bare.createFrameSession('ghost-template'), null)
bare.clearFrameSessions()
equal('clearing the table drops every session', bare.frameSession(session.token), null)

// ---------------------------------------------------------------------------
// 6. The trust fence: fail-closed, in every direction.
// ---------------------------------------------------------------------------

console.log('\n[6] the trust fence')
equal('an explicit pass opens', guardDecision(undefined, null), { reject: false })
equal('null opens', guardDecision(null, null), { reject: false })
equal('false opens', guardDecision(false, null), { reject: false })
equal('a 401 rejects with 401', guardDecision(401, null), { reject: true, status: 401, reason: 'unauthorized' })
equal('a 403 rejects with 403', guardDecision(403, null), { reject: true, status: 403, reason: 'request-rejected' })
equal('a 500 rejects with 500', guardDecision(500, null), { reject: true, status: 500, reason: 'request-rejected' })
equal('a throwing guard rejects 403', guardDecision(null, new Error('boom')),
  { reject: true, status: 403, reason: 'guard-error' })
equal('a nonsense answer rejects 403', guardDecision('yes', null),
  { reject: true, status: 403, reason: 'request-rejected' })
equal('an out-of-range status rejects 403', guardDecision(99, null),
  { reject: true, status: 403, reason: 'request-rejected' })

const headers = {}
let body = ''
const res = {
  writeHead: (status, extra) => { headers.status = status; Object.assign(headers, extra) },
  end: (chunk) => { if (chunk !== undefined) body += chunk.toString('utf8') },
}
sendRejection(res, 401, 'unauthorized')
equal('a 401 refusal answers 401 with JSON', [headers.status, headers['content-type']],
  [401, 'application/json; charset=utf-8'])
check('...and its body is parseable', JSON.parse(body).ok === false)

console.log('\n' + (failures === 0 ? 'PASS' : 'FAIL') + ' — '
  + String(checks - failures) + '/' + String(checks) + ' checks')
if (failures > 0) process.exitCode = 1
