// Offline verification for the music store and the /tpl/music routes.
//
// No DSH process, no ports, no network, no prompts. Run from the package root:
//   node verify/verify-music.mjs
//
// The store is exercised against a temporary profile directory the suite owns,
// through the same route handlers the browser would call — including the trust
// fence, which is the one thing standing between a decorative plugin and a
// read primitive over the user's own files.

import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMusicStore, MUSIC_FILE_RE } from '../src/music-store.js'

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

const scratch = join(root, '.verify-music')
rmSync(scratch, { recursive: true, force: true })
const profile = join(scratch, 'profile')
mkdirSync(join(profile, 'data', 'dsh-boot-animation'), { recursive: true })

/** A ctx whose injected profileContext points at the temporary profile. */
function ctxWithProfile(dir) {
  return {
    inject: (deps, callback) => callback({
      get: (name) => (name === 'profileContext' ? { dir } : undefined),
      effect: (callback) => callback(),
    }),
  }
}

// ---------------------------------------------------------------------------
// 1. The store: the name whitelist, the save/resolve/remove cycle.
// ---------------------------------------------------------------------------

console.log('\n[1] the music store')
const bare = createMusicStore({})
equal('no profile directory yet: an empty list', bare.list(), [])
equal('...and no save', bare.save('x.mp3', '.mp3', Buffer.from('a')), null)
equal('...and no resolve', bare.resolveFile('music-x-abcdef.mp3'), null)

const store = createMusicStore(ctxWithProfile(profile))
equal('an empty store lists nothing', store.list(), [])

// A stored name is generated, never taken from the request: a user's file name
// is display text, and letting it become a path segment is how a traversal
// starts.
const first = store.save('我的主题曲.mp3', '.mp3', Buffer.from('ID3-not-really-audio'))
check('a save returns a whitelisted stored name', MUSIC_FILE_RE.test(first.file), first.file)
equal('...with the display name kept for the card', first.name, '我的主题曲')
equal('...and its size', first.size, 20)
const second = store.save('other.wav', '.wav', Buffer.from('RIFFfake'))
equal('a second save lists newest first', store.list().map((entry) => entry.file),
  [second.file, first.file])
check('...both files exist on disk',
  existsSync(join(profile, 'data', 'dsh-boot-animation', 'music', first.file))
  && existsSync(join(profile, 'data', 'dsh-boot-animation', 'music', second.file)))

equal('a whitelisted name resolves inside the music directory',
  store.resolveFile(first.file), join(profile, 'data', 'dsh-boot-animation', 'music', first.file))
equal('a traversal in the name does not resolve',
  store.resolveFile('../../etc/passwd'), null)
equal('a name of the wrong shape does not resolve',
  store.resolveFile('music-short.mp3'), null)
equal('a file that does not exist does not resolve',
  store.resolveFile('music-zzzzzz-zzzzzz.mp3'), null)

// The index is a cache: a file on disk the index does not know about still
// shows up, because the directory is the truth.
writeFileSync(join(profile, 'data', 'dsh-boot-animation', 'music', 'index.json'), '[]', 'utf8')
check('a wiped index is rebuilt from the directory',
  store.list().length === 2, String(store.list().length))

equal('removing one track drops it from the list',
  store.remove(first.file) && store.list().map((entry) => entry.file), [second.file])
equal('removing it again is a no-op, not an error', store.remove(first.file), true)
equal('a traversal cannot be removed', store.remove('../../etc/passwd'), false)

// ---------------------------------------------------------------------------
// 2. The routes: the fence, the upload bound, and the delete contract.
// ---------------------------------------------------------------------------

console.log('\n[2] the music routes')
const routes = []
const listeners = new Map()
const log = []
const base = {
  logger: {
    warn: (...args) => log.push(['warn', String(args[0])]),
    error: (...args) => log.push(['error', String(args[0])]),
    info: (...args) => log.push(['info', String(args[0])]),
  },
  effect: (callback) => { const disposer = callback(); return () => { if (typeof disposer === 'function') disposer() } },
  on: (event, handler) => { listeners.set(event, handler); return () => listeners.delete(event) },
  inject: (deps, callback) => {
    if (deps.includes('profileContext')) callback({ get: (name) => (name === 'profileContext' ? { dir: profile } : undefined), effect: (callback) => callback() })
    // No connection service: the fence must fail CLOSED for the music routes.
  },
  webServer: { register: (route) => { routes.push(route); return () => {} } },
}
// The module is imported from a scratch mirror, exactly as verify-entry does,
// so the same module resolution the deployment performs is what runs.
rmSync(join(root, '.verify-music', 'mirror'), { recursive: true, force: true })
mkdirSync(join(root, '.verify-music', 'mirror', 'node_modules', '@deepseek-ai'), { recursive: true })
const { cpSync } = await import('node:fs')
cpSync(join(root, 'entry.js'), join(root, '.verify-music', 'mirror', 'entry.js'))
cpSync(join(root, 'package.json'), join(root, '.verify-music', 'mirror', 'package.json'))
cpSync(join(root, 'src'), join(root, '.verify-music', 'mirror', 'src'), { recursive: true })
for (const name of ['schemastery', 'cosmokit']) {
  cpSync(join(root, 'node_modules', '@deepseek-ai', name),
    join(root, '.verify-music', 'mirror', 'node_modules', '@deepseek-ai', name), { recursive: true, dereference: true })
}
const mounted = await import(new URL('.verify-music/mirror/entry.js', new URL('../', import.meta.url)).href)
mounted.apply(base, mounted.Config({ form: 'template' }))

const musicRoutes = routes.filter((route) => route.path.includes('/music/'))
equal('four music routes registered', musicRoutes.length, 4,
  musicRoutes.map((route) => route.path).join(', '))

function stubRes() {
  const out = { status: 0, headers: {}, body: Buffer.alloc(0) }
  out.writeHead = (status, headers) => { out.status = status; Object.assign(out.headers, headers ?? {}) }
  out.end = (chunk) => { if (chunk !== undefined) out.body = Buffer.concat([out.body, Buffer.from(chunk)]) }
  out.setHeader = (key, value) => { out.headers[key] = value }
  return out
}

const listRoute = musicRoutes.find((route) => route.path.endsWith('/music/list'))
const listRes = stubRes()
listRoute.handler({ url: '/plugins/dsh-boot-animation/tpl/music/list', method: 'GET', headers: {} }, listRes)
for (let i = 0; i < 200 && listRes.body.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 5))
// The fence is not armed (no connection service in the stub), so the route must
// refuse rather than open — fail-closed, exactly as the trust-fence suite
// asserts at the unit level.
equal('the list route refuses while the guard is unavailable', listRes.status, 503)
check('...and says so in JSON', JSON.parse(listRes.body.toString('utf8')).ok === false)

// A guard that answers "no rejection" opens the route. The stub's requestRejection
// answers undefined — the same answer an authenticated page gets.
const openCtx = {
  ...base,
  inject: (deps, callback) => {
    if (deps.includes('profileContext')) callback({ get: () => ({ dir: profile }), effect: (callback) => callback() })
    if (deps.includes('connection')) callback({ get: () => ({ requestRejection: () => undefined }), effect: (callback) => callback() })
  },
  webServer: { register: (route) => { routes.push(route); return () => {} } },
}
const openRoutes = []
const openBase = { ...openCtx, webServer: { register: (route) => { openRoutes.push(route); return () => {} } } }
mounted.apply(openBase, mounted.Config({ form: 'template' }))

const openList = openRoutes.find((route) => route.path.endsWith('/music/list'))
const openListRes = stubRes()
openList.handler({ url: '/plugins/dsh-boot-animation/tpl/music/list', method: 'GET', headers: {} }, openListRes)
for (let i = 0; i < 200 && openListRes.body.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 5))
equal('the same route answers once the guard opens', openListRes.status, 200)
check('...with the one remaining track', JSON.parse(openListRes.body.toString('utf8')).files.length === 1)

// A request the guard rejects is answered with the guard's own status.
const rejectCtx = {
  ...base,
  inject: (deps, callback) => {
    if (deps.includes('profileContext')) callback({ get: () => ({ dir: profile }), effect: (callback) => callback() })
    if (deps.includes('connection')) callback({ get: () => ({ requestRejection: () => 403 }), effect: (callback) => callback() })
  },
  webServer: { register: (route) => { openRoutes.push(route); return () => {} } },
}
const rejectBase = { ...rejectCtx, webServer: { register: (route) => { openRoutes.push(route); return () => {} } } }
mounted.apply(rejectBase, mounted.Config({ form: 'template' }))
const rejectList = openRoutes[openRoutes.length - 1]
const rejectRes = stubRes()
rejectList.handler({ url: '/plugins/dsh-boot-animation/tpl/music/list', method: 'GET', headers: {} }, rejectRes)
equal('a rejected request is answered with the guard\'s status', rejectRes.status, 403)

rmSync(scratch, { recursive: true, force: true })

console.log('\n' + (failures === 0 ? 'PASS' : 'FAIL') + ' — '
  + String(checks - failures) + '/' + String(checks) + ' checks')
if (failures > 0) process.exitCode = 1
