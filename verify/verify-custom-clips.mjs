// Exercise real HTTP handlers against disposable profile storage.
import assert from 'node:assert/strict'
import { createServer, request } from 'node:http'
import { mkdtemp, mkdir, readdir, readFile, writeFile, access, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import * as plugin from '../entry.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const scratch = await mkdtemp(join(tmpdir(), 'dsh-boot-custom-'))
const profile = join(scratch, 'profile')
await mkdir(profile)
const headers = { 'x-test-auth': 'yes' }
const route = '/plugins/dsh-boot-animation'
const fixture = Buffer.concat([Buffer.from([0, 0, 0, 20]), Buffer.from('ftypisom'), Buffer.alloc(8), Buffer.from([0, 0, 0, 8]), Buffer.from('moov')])
const servers = []
let checks = 0
const check = (label, condition) => { assert.ok(condition, label); checks++; console.log('ok ' + label) }
const exists = async path => access(path).then(() => true, () => false)

async function mount(dir, config = {}, optional = true) {
  const routes = [], disposers = [], listeners = new Map()
  const effect = fn => { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose) }
  const services = {
    profileContext: { dir },
    connection: { requestRejection: req => req.headers['x-test-auth'] === 'yes'
      ? (req.headers['x-test-forbidden'] ? 403 : undefined) : 401 },
  }
  const ctx = {
    effect, on: (name, fn) => { listeners.set(name, fn) },
    webServer: { register: row => { routes.push(row); return () => { routes.splice(routes.indexOf(row), 1) } } },
    logger: { error: (...args) => { console.error(...args) }, warn: () => {} },
    ...(optional ? { inject: (names, callback) => callback({ get: name => services[name], effect }) } : {}),
  }
  plugin.apply(ctx, plugin.Config(config))
  const injections = []
  listeners.get('webserver/index-inject')(injections)
  const server = createServer((req, res) => {
    const selected = routes.slice().sort((a, b) => b.path.length - a.path.length)
      .find(row => row.kind === 'exact' ? req.url === row.path : req.url.startsWith(row.path))
    if (selected) selected.handler(req, res)
    else { res.writeHead(404); res.end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  servers.push({ server, disposers })
  const base = `http://127.0.0.1:${server.address().port}`
  const call = (path, options = {}) => fetch(base + route + path, { headers, ...options })
  const manifest = () => call('/clips.json').then(response => response.json()).then(answer => answer.clips)
  return { base, call, manifest, injections }
}

try {
  const app = await mount(profile)
  const initial = await app.manifest()
  check('boot head injections preserved', app.injections.length === 2)
  check('reading manifest does not create media directories', !await exists(join(profile, 'data')))
  const originalNames = initial.map(clip => clip.name).sort()
  for (const [label, name, body, auth, expected] of [
    ['unauthorized', 'private.mp4', fixture, {}, 401],
    ['forbidden', 'private.mp4', fixture, { ...headers, 'x-test-forbidden': 'yes' }, 403],
    ['unsupported extension', 'clip.txt', fixture, headers, 400],
    ['path traversal', '../clip.mp4', fixture, headers, 400],
    ['bad magic', 'bad.mp4', Buffer.from('not a video'), headers, 400],
    ['empty file', 'empty.mp4', Buffer.alloc(0), headers, 400],
  ]) {
    const response = await app.call('/upload?name=' + encodeURIComponent(name), { method: 'POST', body, headers: auth })
    check(label + ' rejected', response.status === expected)
    await response.arrayBuffer()
  }
  check('rejected requests do not create user storage', !await exists(join(profile, 'data')))

  const oversized = await new Promise((resolve, reject) => {
    const req = request(app.base + route + '/upload?name=large.mp4', {
      method: 'POST', headers: { ...headers, 'content-length': String(256 * 1024 * 1024 + 1) },
    }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)) })
    req.on('error', reject)
    req.setTimeout(3000, () => req.destroy(new Error('early rejection timeout')))
    req.end()
  })
  check('oversized declared upload rejected before reading body', oversized === 413)
  check('oversized upload did not create directories', !await exists(join(profile, 'data')))

  async function upload(name, bytes = fixture) {
    const response = await app.call('/upload?name=' + encodeURIComponent(name), { method: 'POST', body: bytes })
    const answer = await response.json()
    assert.equal(response.status, 200, JSON.stringify(answer))
    return answer.clip
  }
  const first = await upload('my_intro.mp4')
  const second = await upload('my_intro.mp4')
  check('duplicate original name creates distinct files', first.name !== second.name)
  check('original readable filename preserved', first.displayName === 'my_intro.mp4' && first.custom === true)
  check('upload JSON contains no absolute disk path', !('file' in first) && !('mtime' in first))
  const dir = join(profile, 'data', 'dsh-boot-animation', 'videos')
  check('both stored originals retain exact bytes', (await readFile(join(dir, first.name.slice(7)))).equals(fixture)
    && (await readFile(join(dir, second.name.slice(7)))).equals(fixture))
  check('temporary uploads cleaned', (await readdir(dir)).every(name => !name.startsWith('.upload-')))
  check('manifest merges custom and bundled media', (await app.manifest()).length === initial.length + 2)
  const mov = await upload('quicktime.mov', Buffer.concat([Buffer.from([0, 0, 0, 8]), Buffer.from('wide')]))
  const webm = await upload('intro.webm', Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
  check('legacy QuickTime MOV and WebM container headers accepted', mov.custom && webm.custom)

  const interrupted = request(app.base + route + '/upload?name=interrupted.mp4', { method: 'POST', headers })
  interrupted.on('error', () => {})
  interrupted.write(fixture)
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await readdir(dir)).some(name => name.startsWith('.upload-'))) break
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  interrupted.destroy()
  for (let attempt = 0; attempt < 100; attempt++) {
    if (!(await readdir(dir)).some(name => name.startsWith('.upload-'))) break
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  check('interrupted upload removes temporary file', !(await readdir(dir)).some(name => name.startsWith('.upload-')))
  const anonymous = await app.call('/clips.json', { headers: {} }).then(response => response.json())
  check('anonymous manifest does not disclose imported names', anonymous.clips.every(clip => !clip.custom))

  const range = await fetch(app.base + first.src, { headers: { ...headers, range: 'bytes=0-15' } })
  check('custom video Range is exact', range.status === 206 && Buffer.from(await range.arrayBuffer()).equals(fixture.subarray(0, 16)))
  check('custom Range headers preserved', range.headers.get('content-range') === `bytes 0-15/${fixture.length}` && range.headers.get('cache-control') === 'no-store')
  const head = await fetch(app.base + first.src, { method: 'HEAD', headers })
  check('HEAD reports correct size without body', head.status === 200 && Number(head.headers.get('content-length')) === fixture.length && (await head.arrayBuffer()).byteLength === 0)
  const noAuth = await fetch(app.base + first.src)
  check('custom playback requires authentication', noAuth.status === 401)
  await noAuth.arrayBuffer()

  const next = await mount(profile, { disabledClips: [first.name] })
  const nextClips = await next.manifest()
  check('media survives a fresh plugin instance', nextClips.some(clip => clip.name === first.name))
  check('custom media honors saved selection', nextClips.find(clip => clip.name === first.name).enabled === false)
  const otherDir = join(scratch, 'other-profile')
  await mkdir(otherDir)
  const other = await mount(otherDir)
  check('profiles have separate custom pools', (await other.manifest()).every(clip => !clip.custom))
  const fallback = await mount(profile, {}, false)
  check('missing optional services fail closed', (await fallback.call('/upload?name=one.mp4', { method: 'POST', body: fixture })).status === 404)

  for (const suffix of ['%ZZ.mp4', encodeURIComponent('../outside.mp4')]) {
    const response = await app.call('/custom-clip/' + suffix, { method: 'DELETE' })
    check('malformed/traversal deletion rejected', response.status === 400 || response.status === 404)
    await response.arrayBuffer()
  }
  const outside = join(scratch, 'outside.mp4')
  await writeFile(outside, 'keep me')
  const linkName = randomUUID() + '_linked.mp4'
  try {
    await symlink(outside, join(dir, linkName), 'file')
    const response = await app.call('/custom-clip/' + linkName, { method: 'DELETE' })
    check('symlink cannot be deleted through media API', response.status === 404)
    await response.arrayBuffer()
    check('outside file unaffected', (await readFile(outside, 'utf8')) === 'keep me')
  } catch (error) {
    if (error.code !== 'EPERM' && error.code !== 'EACCES') throw error
    console.log('SKIP symlink: Windows did not allow creating the fixture')
  }

  const removed = await app.call('/custom-clip/' + encodeURIComponent(first.name.slice(7)), { method: 'DELETE' })
  check('custom removal succeeds', removed.status === 200)
  await removed.arrayBuffer()
  check('removed clip leaves pool', !(await app.manifest()).some(clip => clip.name === first.name))
  check('bundled media unchanged', JSON.stringify((await app.manifest()).filter(clip => !clip.custom).map(clip => clip.name).sort()) === JSON.stringify(originalNames))

  if (initial.length) {
    const source = initial.reduce((a, b) => a.bytes < b.bytes ? a : b)
    const real = await readFile(join(root, 'assets', 'videos', source.name))
    const imported = await upload('real-playback.mp4', real)
    const response = await fetch(app.base + imported.src, { headers: { ...headers, range: 'bytes=0-4095' } })
    check('real bundled video imports and streams without corruption', response.status === 206 && Buffer.from(await response.arrayBuffer()).equals(real.subarray(0, 4096)))
  }
  console.log(`PASS — ${checks}/${checks} custom media checks`)
} finally {
  for (const { server, disposers } of servers) {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    disposers.reverse().forEach(dispose => dispose())
  }
  assert.ok(resolve(scratch).startsWith(resolve(tmpdir()) + sep + 'dsh-boot-custom-'))
  await rm(scratch, { recursive: true, force: true })
}
