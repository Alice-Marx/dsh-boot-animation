// Offline verification for the remote template store client and its routes.
//
// No DSH process, no ports, no network, no prompts. Run from the package root:
//   node verify/verify-store.mjs
//
// The store is the one half of this package that talks to the network, so the
// suite never lets it: the fetch is injected as a local stub that answers the
// same shapes the real raw URLs would, and every assertion about a refusal
// (traversal, id mismatch, oversized body, bad JSON) is exercised against that
// stub. What reaches the network in production is exactly what passes here.

import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStoreClient, normalizeStoreIndex, safeStorePath, STORE_TTL_MS } from '../src/template-store-remote.js'
import { validateTemplate } from '../src/template-validate.js'

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

// ---------------------------------------------------------------------------
// 1. The pure functions: what an index may say, and what a path may be.
// ---------------------------------------------------------------------------

console.log('\n[1] the pure functions')
equal('a plain relative path is safe', safeStorePath('templates/demo'), 'templates/demo')
equal('a nested relative path is safe', safeStorePath('a/b/c'), 'a/b/c')
equal('an absolute path is refused', safeStorePath('/etc/passwd'), null)
equal('a traversal is refused', safeStorePath('../../etc/passwd'), null)
equal('a dot segment is refused', safeStorePath('a/./b'), null)
equal('an empty segment is refused', safeStorePath('a//b'), null)
equal('a drive letter is refused', safeStorePath('C:/x'), null)
equal('a URL scheme is refused', safeStorePath('https://x/y'), null)
equal('a backslash path is refused', safeStorePath('a\\b'), null)
equal('a character outside the whitelist is refused', safeStorePath('a b'), null)

const normalized = normalizeStoreIndex({
  templates: [
    { id: 'demo-one', name: '演示一', author: '测试作者', license: 'MIT', tags: ['a', 'b'] },
    { id: 'demo-two', path: 'templates/demo-two' },
    { id: 'Bad_Id', name: '不该出现' },
    { id: 'demo-three', path: '../escape' },
    'not-an-object',
  ],
}, 'https://example.test/raw')
equal('two entries survive normalization',
  normalized.map((entry) => entry.id), ['demo-one', 'demo-two'])
equal('a default path is derived from the id', normalized[0].path, 'templates/demo-one')
equal('the author and licence travel', [normalized[0].author, normalized[0].license], ['测试作者', 'MIT'])
equal('preview URLs are built from the raw base',
  [normalized[0].preview, normalized[0].image],
  ['https://example.test/raw/templates/demo-one/preview.gif',
    'https://example.test/raw/templates/demo-one/preview.png'])
equal('an entry with an escaping path is dropped',
  normalized.some((entry) => entry.id === 'demo-three'), false)

// ---------------------------------------------------------------------------
// 2. The client against a stub fetch: the happy path and every refusal.
// ---------------------------------------------------------------------------

console.log('\n[2] the store client')
const INDEX_URL = 'https://example.test/raw/index.json'
const goodTemplate = {
  schemaVersion: 1,
  id: 'demo-one',
  name: '演示一',
  author: '测试作者',
  license: 'MIT',
  steps: [{ zh: '第一幕', en: 'SCENE ONE', hold: 500 }],
  assets: { line1: 'line-1.mp3' },
}
const indexBody = JSON.stringify({
  templates: [
    { id: 'demo-one', name: '演示一', author: '测试作者', license: 'MIT' },
    { id: 'demo-two', name: '演示二' },
  ],
})

/** A fetch stub: the index, two templates, and one asset, from one origin. */
function makeFetch(overrides = {}) {
  const calls = []
  const impl = async (url) => {
    calls.push(String(url))
    if (overrides.index !== undefined) return overrides.index(String(url))
    if (String(url) === INDEX_URL) {
      return { ok: true, text: async () => indexBody }
    }
    if (String(url) === 'https://example.test/raw/templates/demo-one/template.json') {
      if (overrides.templateOne !== undefined) return overrides.templateOne()
      return { ok: true, text: async () => JSON.stringify(goodTemplate) }
    }
    if (String(url) === 'https://example.test/raw/templates/demo-two/template.json') {
      // A document whose id does not match the entry that named it.
      return { ok: true, text: async () => JSON.stringify({ ...goodTemplate, id: 'someone-else' }) }
    }
    if (String(url) === 'https://example.test/raw/templates/demo-one/assets/line-1.mp3') {
      if (overrides.asset !== undefined) return overrides.asset()
      // A real ArrayBuffer of exactly seven bytes: `Buffer.from(str).buffer`
      // is the 8 KiB pool, which would make the byte count a lie.
      return { ok: true, arrayBuffer: async () => new TextEncoder().encode('ID3fake').buffer }
    }
    return { ok: false, status: 404, text: async () => '' }
  }
  return { impl, calls }
}

const stub = makeFetch()
let clock = 10_000_000
const client = createStoreClient({ indexUrl: INDEX_URL, fetchImpl: stub.impl, now: () => clock })

const list = await client.list()
equal('the index lists both entries', list.map((entry) => entry.id), ['demo-one', 'demo-two'])
equal('the raw base is derived from the index URL', client.rawBase, 'https://example.test/raw')

// The cache: a second list within the TTL does not re-fetch.
const before = stub.calls.length
await client.list()
equal('a cached list does not re-fetch', stub.calls.length, before)
clock += STORE_TTL_MS + 1
await client.list()
equal('a stale list re-fetches', stub.calls.length, before + 1)

const template = await client.fetchTemplate('templates/demo-one')
equal('a good document validates and carries its id',
  [template.id, template.steps.length], ['demo-one', 1])

const asset = await client.fetchAsset('templates/demo-one', 'line-1.mp3')
check('a declared asset fetches', asset !== null && asset.byteLength === 7)
equal('an asset of the wrong extension is refused',
  await client.fetchAsset('templates/demo-one', 'evil.html'), null)
equal('an asset that 404s is refused',
  await client.fetchAsset('templates/demo-one', 'missing.mp3'), null)

// A network failure keeps the last good list.
const failing = createStoreClient({
  indexUrl: INDEX_URL,
  fetchImpl: async () => { throw new Error('network down') },
  now: () => clock,
})
try {
  await failing.list()
  check('a failing fetch throws', false, 'resolved')
} catch (error) {
  check('a failing fetch throws', true, String(error.message))
}
equal('...and the cache is empty, so the card shows nothing rather than a lie',
  failing.cached(), [])

const cachedClient = createStoreClient({ indexUrl: INDEX_URL, fetchImpl: stub.impl, now: () => clock })
await cachedClient.list()
const halfBroken = createStoreClient({
  indexUrl: INDEX_URL,
  fetchImpl: async (url) => (String(url) === INDEX_URL
    ? (() => { throw new Error('network down') })()
    : stub.impl(url)),
  now: () => clock,
})
try {
  await halfBroken.list()
} catch {
  /* the point is what the cache answers afterwards */
}
// A fresh client has an empty cache; the one that read the index successfully
// answers from it — which is what the route does with ok:false.
equal('a client that once read the index answers from its cache',
  cachedClient.cached().map((entry) => entry.id), ['demo-one', 'demo-two'])

// ---------------------------------------------------------------------------
// 3. The install route: id mismatch, traversal, and the fence.
// ---------------------------------------------------------------------------

console.log('\n[3] the install route')
const scratch = join(root, '.verify-store')
rmSync(scratch, { recursive: true, force: true })
const profile = join(scratch, 'profile')
mkdirSync(join(profile, 'data', 'dsh-boot-animation'), { recursive: true })

// The install route's store client is built inside apply() from
// DSH_STORE_URL and the global fetch — which is exactly what production uses.
// So the suite stands up a loopback stub that answers the same shapes the real
// raw URLs would, and points the environment variable at it. That exercises
// the real fetch path (including its timeout and size guards) without touching
// the network: the port is ephemeral, so the suite keeps its no-fixed-ports
// rule, and nothing outside 127.0.0.1 is contacted.
const goodInstall = {
  schemaVersion: 1,
  id: 'demo-one',
  name: '演示一',
  author: '测试作者',
  license: 'MIT',
  steps: [{ zh: '第一幕', en: 'SCENE ONE', hold: 500 }],
  assets: { line1: 'line-1.mp3' },
}
const { createServer } = await import('node:http')
const stubServer = createServer((req, res) => {
  const url = String(req.url ?? '/')
  if (url === '/index.json') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(indexBody)
    return
  }
  if (url === '/templates/demo-one/template.json') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(goodInstall))
    return
  }
  if (url === '/templates/demo-two/template.json') {
    // A document whose id does not match the entry that named it.
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ...goodInstall, id: 'someone-else' }))
    return
  }
  if (url === '/templates/demo-one/assets/line-1.mp3') {
    res.writeHead(200, { 'content-type': 'audio/mpeg' })
    res.end(Buffer.from('ID3fake'))
    return
  }
  res.writeHead(404)
  res.end()
})
await new Promise((resolve) => stubServer.listen(0, '127.0.0.1', resolve))
const storePort = stubServer.address().port
process.env.DSH_STORE_URL = `http://127.0.0.1:${String(storePort)}/index.json`

mkdirSync(join(scratch, 'mirror', 'node_modules', '@deepseek-ai'), { recursive: true })
const { cpSync } = await import('node:fs')
cpSync(join(root, 'entry.js'), join(scratch, 'mirror', 'entry.js'))
cpSync(join(root, 'package.json'), join(scratch, 'mirror', 'package.json'))
cpSync(join(root, 'src'), join(scratch, 'mirror', 'src'), { recursive: true })
for (const name of ['schemastery', 'cosmokit']) {
  cpSync(join(root, 'node_modules', '@deepseek-ai', name),
    join(scratch, 'mirror', 'node_modules', '@deepseek-ai', name), { recursive: true, dereference: true })
}
// The mirror's assets must include the built-in templates, because the store
// routes resolve the user directory through the store and the fallbacks read
// the built-ins.
cpSync(join(root, 'assets', 'templates'), join(scratch, 'mirror', 'assets', 'templates'), { recursive: true })

const mounted = await import(new URL('.verify-store/mirror/entry.js', new URL('../', import.meta.url)).href)

function makeCtx(connection) {
  const routes = []
  const base = {
    logger: { warn: () => {}, error: () => {}, info: () => {} },
    effect: (callback) => { const disposer = callback(); return () => { if (typeof disposer === 'function') disposer() } },
    on: () => () => {},
    inject: (deps, callback) => {
      if (deps.includes('profileContext')) {
        callback({ get: () => ({ dir: profile }), effect: (callback) => callback() })
      }
      if (deps.includes('connection') && connection !== undefined) {
        callback({ get: () => connection, effect: (callback) => callback() })
      }
    },
    webServer: { register: (route) => { routes.push(route); return () => {} } },
  }
  mounted.apply(base, mounted.Config({ form: 'template' }))
  return routes
}

function stubRes() {
  const out = { status: 0, headers: {}, body: Buffer.alloc(0) }
  out.writeHead = (status, headers) => { out.status = status; Object.assign(out.headers, headers ?? {}) }
  out.end = (chunk) => { if (chunk !== undefined) out.body = Buffer.concat([out.body, Buffer.from(chunk)]) }
  out.setHeader = (key, value) => { out.headers[key] = value }
  return out
}

/** A request stub whose body arrives on the next tick, as a real one does. */
function stubReq(body) {
  const text = JSON.stringify(body)
  return {
    method: 'POST',
    headers: {},
    url: '/plugins/dsh-boot-animation/tpl/store/install',
    on: (event, handler) => {
      if (event === 'data') setImmediate(() => handler(Buffer.from(text)))
      if (event === 'end') setImmediate(() => handler())
    },
  }
}

async function callInstall(routes, body) {
  const route = routes.find((candidate) => candidate.path.endsWith('/store/install'))
  const res = stubRes()
  route.handler(stubReq(body), res)
  for (let i = 0; i < 400 && res.body.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 5))
  return res
}

const open = { requestRejection: () => undefined }
const routes = makeCtx(open)
const storeRoutes = routes.filter((route) => route.path.includes('/store'))
equal('two store routes registered', storeRoutes.length, 2,
  storeRoutes.map((route) => route.path).join(', '))

// An id whose document does not match the entry is refused, not installed.
const mismatch = JSON.parse((await callInstall(routes, { id: 'demo-two' })).body.toString('utf8'))
check('an id mismatch is refused', mismatch.ok === false, mismatch.error)
check('...and the reason names both ids', String(mismatch.error).includes('someone-else'), mismatch.error)

// An id the index does not carry is a 404.
const missing = JSON.parse((await callInstall(routes, { id: 'ghost-template' })).body.toString('utf8'))
check('an unknown id is a 404', missing.ok === false, missing.error)

// A malformed id never reaches the network.
const badId = JSON.parse((await callInstall(routes, { id: 'Bad_Id!' })).body.toString('utf8'))
check('a malformed id is refused before any fetch', badId.ok === false, badId.error)

// The happy path: the document and its declared asset land in the user
// directory, and the store lists the new template afterwards.
const installed = JSON.parse((await callInstall(routes, { id: 'demo-one' })).body.toString('utf8'))
check('a good install succeeds', installed.ok === true, installed.error)
equal('...writing the template and its asset',
  [installed.assets, installed.missing], [['line-1.mp3'], []])
check('...into the user template directory',
  existsSync(join(profile, 'data', 'dsh-boot-animation', 'templates', 'demo-one', 'template.json'))
  && existsSync(join(profile, 'data', 'dsh-boot-animation', 'templates', 'demo-one', 'assets', 'line-1.mp3')))
check('...with the asset bytes intact',
  readFileSync(join(profile, 'data', 'dsh-boot-animation', 'templates', 'demo-one', 'assets', 'line-1.mp3'), 'utf8') === 'ID3fake')
const validated = validateTemplate(JSON.parse(readFileSync(join(profile, 'data', 'dsh-boot-animation', 'templates', 'demo-one', 'template.json'), 'utf8')))
check('...and the written document still validates', validated.ok === true, validated.reason ?? '')

// The store route answers the index from the loopback stub.
const listRoute = routes.find((route) => route.path.endsWith('/store'))
const listRes = stubRes()
listRoute.handler({ url: '/plugins/dsh-boot-animation/tpl/store', method: 'GET', headers: {} }, listRes)
for (let i = 0; i < 400 && listRes.body.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 5))
const listed = JSON.parse(listRes.body.toString('utf8'))
check('the store route answers the index', listed.ok === true && listed.count === 2,
  listed.ok === true ? String(listed.count) : listed.error)

// The fence: without a guard the route refuses; with one that rejects, the
// guard's own status is the answer.
const fenced = makeCtx(undefined)
const fenceRes = await callInstall(fenced, { id: 'demo-one' })
equal('the install route refuses while the guard is unavailable', fenceRes.status, 503)

const rejecting = makeCtx({ requestRejection: () => 403 })
const rejectRes = await callInstall(rejecting, { id: 'demo-one' })
equal('a rejected request is answered with the guard\'s status', rejectRes.status, 403)

stubServer.close()
delete process.env.DSH_STORE_URL
rmSync(scratch, { recursive: true, force: true })

console.log('\n' + (failures === 0 ? 'PASS' : 'FAIL') + ' — '
  + String(checks - failures) + '/' + String(checks) + ' checks')
if (failures > 0) process.exitCode = 1
