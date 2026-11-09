#!/usr/bin/env node
// Local static preview for the boot screen.
//
// Renders the exact script injection the Host serves, against a stand-in for the
// kernel boot page, so the visual treatment and interaction can be checked
// without restarting DSH. Two local servers are started because the clip pool is
// fetched cross-origin from the page:
//
//   - page server  : http://127.0.0.1:8877/  (this preview + a fake kernel boot page)
//   - clip server  : http://127.0.0.1:8878/  (the real pool directory, CORS-enabled)
//
// Drop any .mp4/.webm into assets/videos and reload to judge the edge fade
// against a real clip.

import { createServer } from 'node:http'
import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { basename, extname, join, resolve, sep } from 'node:path'
import { createTemplateStore, TEMPLATE_FILE_TYPES } from '../src/template-store.js'
import { validateTemplate } from '../src/template-validate.js'
import { IDCARD_HTML } from '../src/idcard-html.js'

const PACKAGE = fileURLToPath(new URL('..', import.meta.url))
const VIDEO_DIR = join(PACKAGE, 'assets', 'videos')
const VIDEO_EXT = new Set(['.mp4', '.webm', '.m4v', '.mov'])
const PAGE_PORT = 8877
const CLIP_PORT = 8878
/** The preview's stand-in for a profile: where the editor's saves land. */
const PREVIEW_HOME = join(PACKAGE, '.preview-home')
/** The editor's in-memory drafts, exactly as the Host holds them. */
const editorDrafts = new Map()

/** Read one request body as UTF-8 text, bounded. */
function readBodyText(req, limit = 64 * 1024) {
  return new Promise((resolve) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        req.destroy()
        resolve('')
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => resolve(''))
  })
}

const MIME = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
  '.js': 'text/javascript; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
}

async function listClips() {
  try {
    const entries = await readdir(VIDEO_DIR, { withFileTypes: true })
    return entries
      .filter(entry => entry.isFile() && VIDEO_EXT.has(extname(entry.name).toLowerCase()))
      .map(entry => entry.name)
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

/** The clip pool server: same layout the Host half exposes under its route. */
/**
 * The template form's preview page.
 *
 * Renders the same rows the Host injects for `form: 'template'`, against this
 * preview's own /tpl routes on the clip server. The template data is read
 * through the real store, so what plays here is what a real boot plays —
 * including the validation, because a template the store refuses is a template
 * the Host would not inject either.
 *
 * The settings come from the query string, the same contract the video form
 * has: `?template=<id>` picks the act, `?template2=<id>` the second one, and
 * `?speed=`, `?theme=`, `?glass=1` and friends override the runtime config. A
 * missing template is reported on the page rather than falling back silently,
 * because a preview that quietly plays something else answers the wrong
 * question.
 * @param query - the parsed query string.
 * @returns the page HTML.
 */
async function templatePage(query) {
  const store = createTemplateStore({})
  const first = store.readTemplate(query.get('template') || 'archive-warm')
  const second = query.get('template2') ? store.readTemplate(query.get('template2')) : null
  const base = `http://127.0.0.1:${String(CLIP_PORT)}/plugins/dsh-boot-animation/tpl`
  const safe = (value) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, '')

  if (first === null) {
    const known = store.listTemplates().map((entry) => entry.id).join(', ')
    return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>模板预览</title>
<style>body{margin:0;height:100vh;display:grid;place-items:center;background:#10141c;color:#dfe7f3;font:14px/1.7 system-ui}</style>
</head><body><div>找不到模板「${String(query.get('template') || 'archive-warm')}」。<br>
可用的内置模板：${known || '（无）'}</div></body></html>`
  }

  // The runtime config, with the same fields the Host sends. `voicePack` is
  // load-bearing rather than cosmetic: the runtime has two fallbacks for it
  // ('f' in one place, 'a' in another), and the 'a' pack does not ship — a
  // preview that omits it asks for audio that 404s.
  const cfg = {
    enabled: true,
    mode: 'always',
    theme: query.get('theme') || 'light',
    speed: Number(query.get('speed')) || 1,
    requireInteraction: query.get('requireInteraction') !== '0',
    allowSkip: query.get('allowSkip') !== '0',
    sound: query.get('sound') !== '0',
    soundVolume: 0.5,
    voice: query.get('voice') !== '0',
    voiceLang: 'en',
    voicePack: 'f',
    voiceFx: 'robot',
    voiceRate: 0.88,
    voicePitch: 0.85,
    voiceVolume: 0.9,
    voiceCue: true,
    voiceLead: 240,
    identity: query.get('identity') || 'JOYCE MOORE',
    identityId: '0087',
    accessLevel: '3',
    accent: '#ff7500',
    glitchA: '#ff3b30',
    glitchB: '#2971b8',
    transitionIn: 'dissolve',
    transitionJoin: 'dissolve',
    transitionOut: 'dissolve',
    transitionMs: 600,
    transitionDir: 'left',
    glass: query.get('glass') === '1',
    glassOpacity: 0.75,
    glassBlur: 22,
    glassSaturate: 160,
    glassBackdropBlur: 28,
  }
  const { __root, __source, ...published } = first
  const rows = [
    `<script>globalThis.__DSH_BOOT_ANIM_TPL_BASE__=${safe(base)}</script>`,
    `<script>globalThis.__DSH_BOOT_ANIM_TPL_CFG__=${safe(cfg)}</script>`,
    `<script>globalThis.__DSH_BOOT_ANIM_TPL_1__=${safe(published)}</script>`,
  ]
  if (second !== null) {
    const { __root: root2, __source: source2, ...published2 } = second
    rows.push(`<script>globalThis.__DSH_BOOT_ANIM_TPL_2__=${safe(published2)}</script>`)
  }
  return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>模板预览 · ${String(first.name || first.id)}</title>
<link rel="stylesheet" href="${base}/splash.css">
<style>
  html.dsu-lock,html.dsu-lock body{overflow:hidden!important}
  html.dsu-lock body{background-color:#000!important}
  :root{--dsh-boot-bg:#000}
  #dsh-boot-anim-tpl.dsu-boot{position:fixed;inset:0;z-index:2147483000;background:#000}
  /* A stand-in for the application the overlay dissolves into: without
     something behind it the hand-off has nothing to reveal. */
  #mockapp{position:fixed;inset:0;z-index:1;display:grid;place-items:center;
    background:linear-gradient(160deg,#f7f7f5,#efeff0);color:#2b2b2b;
    font:600 22px/1.6 system-ui;text-align:center}
  .devbar{position:fixed;left:12px;top:12px;z-index:2147483600;display:flex;gap:6px;
    font:12px system-ui;isolation:isolate}
  .devbar button,.devbar a{cursor:pointer;padding:5px 9px;border-radius:6px;text-decoration:none;
    border:1px solid rgba(120,160,200,.5);background:rgba(10,20,32,.72);color:#cfe4f6}
</style>
${rows.join('\n')}
</head>
<body>
<div class="devbar">
  <a href="/?form=template&template=archive-warm">档案暖白</a>
  <a href="/?form=template&template=deep-sonar&theme=dark">深海声呐</a>
  <a href="/?form=template&template=whale-girl-scan">鲸鱼娘</a>
  <a href="/?form=template&template=550c-homage&theme=dark">550C</a>
  <a href="/?form=template&template=division-bigfish-codex">大肥鱼 iframe</a>
  <button onclick="location.reload()">重播</button>
</div>
<div id="mockapp"><div>应用已就绪<br><span style="font-size:13px;font-weight:400">模板演完就应该看到这一屏</span></div></div>
<div id="dsh-boot-anim-tpl" class="dsu-root dsu-boot"></div>
<script>
(function(){try{
var c=globalThis.__DSH_BOOT_ANIM_TPL_CFG__||{};
var off=!c.enabled;
if(!off&&c.mode==='session'&&sessionStorage.getItem('dsh-boot-animation:tpl-shown')==='1')off=true;
if(!off&&c.mode==='daily'&&localStorage.getItem('dsh-boot-animation:tpl-day')===new Date().toISOString().slice(0,10))off=true;
if(off){globalThis.__DSH_BOOT_ANIM_TPL_SKIP__=true;var r0=document.getElementById('dsh-boot-anim-tpl');if(r0&&r0.parentNode)r0.parentNode.removeChild(r0);}
else{
document.documentElement.classList.add('dsu-lock');
document.documentElement.style.overflow='hidden';
if(document.body)document.body.style.overflow='hidden';
setTimeout(function(){try{
if(globalThis.__DSH_BOOT_ANIM_TPL_RUNNING__===true)return;
var r=document.getElementById('dsh-boot-anim-tpl');
if(r&&r.parentNode)r.parentNode.removeChild(r);
document.documentElement.classList.remove('dsu-lock');
if(document.body)document.body.style.overflow='';
}catch(e){}},9000);}
}catch(e){}})()
</script>
<script src="${base}/splash.js"></script>
</body></html>`
}

const clipServer = createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0])
  void (async () => {
    if (url === '/clips.json') {
      const clips = await listClips()
      res.writeHead(200, {
        'content-type': MIME['.json'],
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
      })
      res.end(JSON.stringify({
        clips: clips.map(name => ({ src: `http://127.0.0.1:${String(CLIP_PORT)}/clip/${encodeURIComponent(name)}`, name })),
      }))
      return
    }
    if (url.startsWith('/clip/')) {
      const name = basename(url.slice('/clip/'.length))
      const absolute = resolve(VIDEO_DIR, name)
      if (!VIDEO_EXT.has(extname(name).toLowerCase()) || !absolute.startsWith(VIDEO_DIR + sep)) {
        res.writeHead(404).end()
        return
      }
      try {
        const info = await stat(absolute)
        const body = await readFile(absolute)
        res.writeHead(200, {
          'content-type': MIME[extname(name).toLowerCase()] ?? 'application/octet-stream',
          'content-length': String(info.size),
          'access-control-allow-origin': '*',
          'cache-control': 'no-store',
        })
        res.end(body)
      } catch (error) {
        res.writeHead(error?.code === 'ENOENT' ? 404 : 500).end()
      }
      return
    }
    // ── the template form's routes ────────────────────────────────────────────
    // A faithful local replica of the Host's /tpl group, served through the
    // real store module so the preview exercises the same validation and
    // containment a boot does. The one deliberate difference: no trust fence,
    // because there is no connection service here — this is a stand-alone
    // preview of files the package already owns.
    if (url.startsWith('/plugins/dsh-boot-animation/tpl/')) {
      const rest = url.slice('/plugins/dsh-boot-animation/tpl/'.length)
      const segments = rest.split('/')
      // A local stand-in for the profile's data directory, so the editor's
      // save and asset-upload routes work here too — a preview that could not
      // save would make the editor untestable without a real DSH.
      const store = createTemplateStore({
        inject: (deps, callback) => callback({
          get: () => ({ dir: PREVIEW_HOME }),
          effect: (callback) => callback(),
        }),
      })
      const cors = {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, cors)
        res.end()
        return
      }
      // Every refusal inside this branch answers with the CORS headers too: the
      // page is cross-origin from this server, and a 404 without them surfaces
      // in the browser as a CORS error — which sends a reader looking for a
      // missing file when the file was simply absent.
      const refuse = () => {
        res.writeHead(404, cors)
        res.end()
      }
      if (segments[0] === 'splash.js' || segments[0] === 'splash.css') {
        const text = await readFile(join(PACKAGE, 'assets', 'splash', segments[0]), 'utf8')
        res.writeHead(200, {
          'content-type': segments[0].endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8',
          ...cors,
        })
        res.end(text)
        return
      }
      if (segments[0] === 'templates.json') {
        res.writeHead(200, { 'content-type': MIME['.json'], ...cors })
        res.end(JSON.stringify({ templates: store.listTemplates(), voices: store.voicePacks }))
        return
      }
      if (segments[0] === 'template' && segments.length === 2) {
        const template = store.readTemplate(segments[1].replace(/\.json$/, ''))
        if (template === null) {
          res.writeHead(404, { 'content-type': MIME['.json'], ...cors })
          res.end(JSON.stringify({ ok: false, error: '模板不存在。' }))
          return
        }
        const { __root, __source, ...published } = template
        res.writeHead(200, { 'content-type': MIME['.json'], ...cors })
        res.end(JSON.stringify({ ok: true, template: published }))
        return
      }
      if (segments[0] === 'asset') {
        const file = join(PACKAGE, 'assets', 'splash', 'assets', basename(segments[1] ?? ''))
        if (!/^[a-z0-9][a-z0-9._-]{0,40}\.mp3$/i.test(basename(segments[1] ?? ''))) {
          refuse()
          return
        }
        const body = await readFile(file).catch(() => null)
        if (body === null) {
          refuse()
          return
        }
        res.writeHead(200, { 'content-type': 'audio/mpeg', ...cors })
        res.end(body)
        return
      }
      if (segments[0] === 'voice' && segments.length === 3) {
        const [pack, name] = segments.slice(1)
        if (!/^[a-z]$/.test(pack ?? '') || !/^line-[1-9]\d?\.mp3$/.test(name ?? '')) {
          refuse()
          return
        }
        const body = await readFile(join(PACKAGE, 'assets', 'splash', 'voices', pack, name)).catch(() => null)
        if (body === null) {
          refuse()
          return
        }
        res.writeHead(200, { 'content-type': 'audio/mpeg', ...cors })
        res.end(body)
        return
      }
      if (segments[0] === 'template-asset' && segments.length === 3) {
        const hit = store.resolveAsset(segments[1], basename(segments[2]))
        if (hit === null) {
          refuse()
          return
        }
        const body = await readFile(hit.file)
        res.writeHead(200, { 'content-type': 'application/octet-stream', ...cors })
        res.end(body)
        return
      }
      if (segments[0] === 'template-file' && segments.length >= 3) {
        const hit = store.resolveTemplateFile(segments[1], segments.slice(2).join('/'))
        if (hit === null) {
          refuse()
          return
        }
        const body = await readFile(hit.file)
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', ...cors })
        res.end(body)
        return
      }
      if (segments[0] === 'frame-session' && segments.length === 1) {
        // Mint a real capability token through the store, exactly as the Host
        // does, so the iframe path is exercised rather than stubbed.
        let id = ''
        for await (const chunk of req) id += chunk
        let parsed = {}
        try {
          parsed = JSON.parse(id || '{}')
        } catch {
          res.writeHead(400, { 'content-type': MIME['.json'], ...cors })
          res.end(JSON.stringify({ ok: false, error: 'invalid json' }))
          return
        }
        const session = store.createFrameSession(String(parsed?.id ?? ''))
        if (session === null) {
          res.writeHead(404, { 'content-type': MIME['.json'], ...cors })
          res.end(JSON.stringify({ ok: false, error: '模板不存在。' }))
          return
        }
        res.writeHead(200, { 'content-type': MIME['.json'], ...cors })
        res.end(JSON.stringify({ ok: true, ...session }))
        return
      }
      if (segments[0] === 'frame' && segments.length >= 3) {
        const session = store.frameSession(segments[1])
        if (session === null) {
          refuse()
          return
        }
        const hit = store.resolveTemplateFile(session.id, segments.slice(2).join('/'))
        if (hit === null) {
          refuse()
          return
        }
        const rel = segments.slice(2).join('/')
        const body = await readFile(hit.file)
        const extension = rel.slice(rel.lastIndexOf('.')).toLowerCase()
        const headers = {
          'content-type': TEMPLATE_FILE_TYPES[extension] ?? 'application/octet-stream',
          ...cors,
        }
        // The same sandbox headers the Host answers with, so an iframe
        // template's third-party document is constrained here too.
        if (session.untrusted && extension === '.html') {
          headers['content-security-policy'] = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'"
        }
        res.writeHead(200, headers)
        res.end(body)
        return
      }
      if (segments[0] === 'diag' && segments.length === 1) {
        for await (const chunk of req) { /* the preview discards diagnostics */ }
        res.writeHead(204, cors)
        res.end()
        return
      }
      // ── the editor's routes ─────────────────────────────────────────────────
      // The same eight the Host serves, minus the trust fence (there is no
      // connection service here). Save and upload write into the preview's
      // stand-in profile directory, so the editor is fully usable offline.
      if (segments[0] === 'editor' && segments.length === 1) {
        const text = await readFile(join(PACKAGE, 'assets', 'editor', 'editor.html'), 'utf8')
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...cors })
        res.end(text)
        return
      }
      if (segments[0] === 'idcard' && segments.length === 1) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...cors })
        res.end(IDCARD_HTML)
        return
      }
      if (segments[0] === 'templates' && segments.length === 1) {
        res.writeHead(200, { 'content-type': MIME['.json'], ...cors })
        res.end(JSON.stringify({ ok: true, active: '', templates: store.listTemplates() }))
        return
      }
      if (segments[0] === 'preview-template' && segments.length === 1) {
        const id = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('id') ?? ''
        const template = store.readTemplate(id)
        if (template === null) {
          refuse()
          return
        }
        const { __root, __source, ...published } = template
        res.writeHead(200, { 'content-type': MIME['.json'], ...cors })
        res.end(JSON.stringify({ ok: true, template: published }))
        return
      }
      if (segments[0] === 'editor' && segments[1] === 'draft' && segments.length === 2) {
        let body = null
        try {
          body = JSON.parse(await readBodyText(req) || '{}')
        } catch {
          refuse()
          return
        }
        const checked = validateTemplate(body?.template ?? body)
        if (!checked.ok) {
          res.writeHead(400, { 'content-type': MIME['.json'], ...cors })
          res.end(JSON.stringify({ ok: false, error: checked.reason }))
          return
        }
        const id = 'd' + Math.random().toString(36).slice(2, 10)
        editorDrafts.set(id, {
          template: checked.value,
          start: Number.isInteger(body?.start) ? body.start : null,
          count: Number.isInteger(body?.count) && body.count > 0 ? body.count : null,
        })
        while (editorDrafts.size > 20) editorDrafts.delete(editorDrafts.keys().next().value)
        res.writeHead(200, { 'content-type': MIME['.json'], ...cors })
        res.end(JSON.stringify({ ok: true, id }))
        return
      }
      if (segments[0] === 'editor' && segments[1] === 'preview' && segments.length === 2) {
        const query = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams
        const record = editorDrafts.get(query.get('id') ?? '')
        const template = record?.template ?? store.readTemplate('archive-warm')
        if (template === null) {
          refuse()
          return
        }
        const { __root, __source, ...published } = template
        const base = `http://127.0.0.1:${String(CLIP_PORT)}/plugins/dsh-boot-animation/tpl`
        const safe = (value) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, '')
        const jump = record && Number.isInteger(record.start)
          ? `window.__DSH_BOOT_ANIM_TPL_JUMP__=${safe({ start: record.start, count: record.count ?? undefined })};`
          : ''
        res.writeHead(200, { 'content-type': MIME['.html'], ...cors })
        res.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>编辑器预览</title>
<link rel="stylesheet" href="${base}/splash.css">
<style>html.dsu-lock,html.dsu-lock body{overflow:hidden!important}
#dsh-boot-anim-tpl.dsu-boot{position:fixed;inset:0;z-index:2147483000;background:#000}
body{margin:0}</style></head><body>
<div id="dsh-boot-anim-tpl" class="dsu-root dsu-boot"></div>
<script>window.__DSH_BOOT_ANIM_TPL_BASE__=${safe(base)};
window.__DSH_BOOT_ANIM_TPL_CFG__=${safe({ enabled: true, mode: 'always', theme: 'light', speed: 1, requireInteraction: false, allowSkip: false, sound: false, voice: false, identity: 'JOYCE MOORE', identityId: '0087', accessLevel: '3', accent: '#ff7500', glitchA: '#ff3b30', glitchB: '#2971b8' })};
window.__DSH_BOOT_ANIM_TPL_1__=${safe(published)};${jump}</script>
<script src="${base}/splash.js"></script></body></html>`)
        return
      }
      if (segments[0] === 'templates' && segments[1] === 'save' && segments.length === 2) {
        let body = null
        try {
          body = JSON.parse(await readBodyText(req, 16 * 1024 * 1024) || '{}')
        } catch {
          refuse()
          return
        }
        const checked = validateTemplate(body?.template ?? body)
        if (!checked.ok) {
          res.writeHead(400, { 'content-type': MIME['.json'], ...cors })
          res.end(JSON.stringify({ ok: false, error: checked.reason }))
          return
        }
        const dir = join(store.userRoot, checked.value.id)
        await mkdir(dir, { recursive: true })
        await writeFile(join(dir, 'template.json'), JSON.stringify(checked.value, null, 2) + '\n', 'utf8')
        res.writeHead(200, { 'content-type': MIME['.json'], ...cors })
        res.end(JSON.stringify({ ok: true, id: checked.value.id, file: join(dir, 'template.json').replace(/\\/g, '/') }))
        return
      }
      if (segments[0] === 'template-assets' && segments[1] === 'upload' && segments.length === 2) {
        let body = null
        try {
          body = JSON.parse(await readBodyText(req, 12 * 1024 * 1024) || '{}')
        } catch {
          refuse()
          return
        }
        const id = String(body?.id ?? '')
        const name = basename(String(body?.name ?? ''))
        const bytes = Buffer.from(String(body?.data ?? ''), 'base64')
        if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id) || bytes.byteLength === 0 || bytes.byteLength > 8 * 1024 * 1024) {
          refuse()
          return
        }
        const dir = join(store.userRoot, id, 'assets')
        await mkdir(dir, { recursive: true })
        await writeFile(join(dir, name), bytes)
        res.writeHead(200, { 'content-type': MIME['.json'], ...cors })
        res.end(JSON.stringify({ ok: true, file: join(dir, name).replace(/\\/g, '/') }))
        return
      }
      refuse()
      return
    }
    refuse()
  })().catch(() => { if (!res.headersSent) res.writeHead(500).end() })
})

/** The page server: a fake kernel boot page plus the injected screen script. */
const pageServer = createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0]
  void (async () => {
    if (url === '/' || url === '/index.html') {
      const query = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams
      // The template form is asked for with ?form=template&template=<id>, and
      // renders the same nine rows the Host injects for it — critical styles,
      // the stylesheet link, the three globals, the mount point, the bootstrap
      // and the script-src row — against the clip server's /tpl routes. The
      // video form is the default, unchanged.
      if (query.get('form') === 'template') {
        const html = await templatePage(query)
        res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' })
        res.end(html)
        return
      }
      const screen = await readFile(join(PACKAGE, 'src', 'boot-screen.js'), 'utf8')
      // The screen's settings come from the query string, so the injection the
      // Host would emit can be reproduced exactly — `?sound=0` is the silence
      // switch, `?clickToEnter=1` the direct entry, `?hint=0` the hidden hint,
      // and `?enterMode=click` / `?fadeMs=4000` the other two fields. Anything
      // absent falls back to the Host's own default rather than being sent.
      const cfg = JSON.stringify({
        base: '',
        manifest: `http://127.0.0.1:${String(CLIP_PORT)}/clips.json`,
        holdMs: 15000,
        ...(query.get('fadeMs') === null ? {} : { fadeMs: Number(query.get('fadeMs')) }),
        ...(query.get('enterMode') === null ? {} : { enterMode: query.get('enterMode') }),
        ...(query.get('sound') === null ? {} : { sound: query.get('sound') !== '0' }),
        ...(query.get('clickToEnter') === null ? {} : { clickToEnter: query.get('clickToEnter') === '1' }),
        ...(query.get('hint') === null ? {} : { showHint: query.get('hint') !== '0' }),
      })
      // The fake boot page mirrors the kernel's DOM contract: `[data-dsh-boot]`,
      // `[data-dsh-boot-spinner]`, and the `--dsh-boot-arc` custom property the
      // real page writes as entries activate.
      const html = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>boot screen preview</title>
<script>globalThis.__DSH_BOOT_ANIM_CFG__=${cfg}</script>
<script>${screen}</script>
<style>
  html,body{margin:0;height:100%;background:#fff}
  body[data-ds-dark-theme]{background:#151517}
  #root{height:100%;display:grid;place-items:center}
  [data-dsh-boot]{display:flex;flex-direction:column;align-items:center;gap:16px;font:600 16px system-ui}
  [data-dsh-boot-spinner]{width:20px;height:20px;border-radius:50%;border:2px solid rgba(0,0,0,.12)}
  .devbar{position:fixed;left:12px;top:12px;z-index:2147483647;display:flex;gap:6px;font:12px system-ui;isolation:isolate}
  .dshba{z-index:2147483000 !important}
  /* ?raw=1 strips the vignette and the dimming so the clip itself can be
     inspected: without this there is no way to tell a hidden clip from a clip
     whose own pixels are too dark to see through the mask. */
  .dshba[data-raw="1"] .dshba-video{opacity:1 !important;-webkit-mask-image:none !important;mask-image:none !important}
  .dshba[data-raw="1"] .dshba-veil{display:none !important}
  .devbar button{cursor:pointer;padding:5px 9px;border-radius:6px;border:1px solid rgba(120,160,200,.5);background:rgba(10,20,32,.72);color:#cfe4f6}
</style></head>
<body>
  <div class="devbar">
    <button onclick="document.body.toggleAttribute('data-ds-dark-theme')">明/暗主题</button>
    <button onclick="bootFail()">模拟启动失败</button>
    <button onclick="simulateMount()">模拟应用挂载</button>
    <button onclick="syntheticClip()">合成测试片段</button>
    <label style="cursor:pointer;padding:5px 9px;border-radius:6px;border:1px solid rgba(120,160,200,.5);background:rgba(10,20,32,.72);color:#cfe4f6">
      选我的视频<input type="file" accept="video/*" style="display:none" onchange="if(this.files[0])useVideo(this.files[0])">
    </label>
    <button onclick="location.reload()">重载</button>
  </div>
  <div id="root"><div data-dsh-boot><div>HARNESS</div><div data-dsh-boot-spinner style="--dsh-boot-arc:72deg"></div><div>Loading plugins…</div></div></div>
  <script>
    var arc=72, timer=setInterval(function(){
      arc=Math.min(arc+9,288);
      document.querySelector('[data-dsh-boot-spinner]').style.setProperty('--dsh-boot-arc',arc+'deg');
      if(arc>=288){clearInterval(timer);setTimeout(function(){ if(globalThis.__DSH_BOOT_ANIM__) globalThis.__DSH_BOOT_ANIM__.clientReady() },900)}
    },120);
    function bootFail(){
      clearInterval(timer);
      document.querySelector('[data-dsh-boot]').innerHTML='<div>Failed to load plugins</div><div>x: pending</div>';
    }
    // Stand-in for the real application taking the mount point: this is what the
    // UI renderer does once the client roster settles, one frame after the boot
    // page is hydrated.
    function simulateMount(){
      document.querySelector('.devbar').style.display='none';
      document.getElementById('root').innerHTML='<div style="display:grid;place-items:center;height:100%;'
        +'font:14px system-ui;color:#5b6b7d;background:var(--mock-bg,#fff)" id="mockapp">'
        +'<div style="text-align:center"><div style="font-size:22px;font-weight:600;color:#0f1115">应用已就绪</div>'
        +'<div style="margin-top:8px">这就是点击进入之后你应该看到的界面</div></div></div>';
    }
    // Local clip for judging the edge fade: the user's own file, or a synthetic
    // one painted on a canvas when the pool directory is still empty.
    function diag(message){
      var hint=document.querySelector('.dshba-hint');
      if(hint) hint.textContent='诊断：'+message;
    }
    function useVideo(file){
      var video=document.querySelector('.dshba-video');
      if(!video){diag('入场层已退场（先点重载）');return}
      video.addEventListener('error',function(){diag('video error code='+(video.error&&video.error.code))});
      video.addEventListener('loadeddata',function(){diag('loaded bytes='+file.size)});
      video.src=URL.createObjectURL(file);
      video.setAttribute('data-shown','1');
      var p=video.play();
      if(p&&p.catch)p.catch(function(e){diag('play 被拒：'+e.name)});
    }
    // The pool is 16:9 while the overlay is the whole viewport, so the clip's
    // aspect ratio and the fit mode are exactly what decides whether the subject
    // survives. ?ar=16:9 makes the synthetic clip match the real ones.
    function syntheticClip(){
      var ar=(location.search.match(/ar=(\d+):(\d+)/)||[]);
      var W=960,H=960;
      if(ar.length===3){ var a=parseInt(ar[1],10), b=parseInt(ar[2],10); H=Math.round(W*b/a) }
      var c=document.createElement('canvas');c.width=W;c.height=H;
      var g=c.getContext('2d'),t=0;
      var stream=c.captureStream(30);
      var chunks=[],rec=new MediaRecorder(stream,{mimeType:'video/webm'});
      rec.ondataavailable=function(e){if(e.data.size)chunks.push(e.data)};
      rec.onstop=function(){useVideo(new Blob(chunks,{type:'video/webm'}))};
      rec.start();
      var cx=W*0.5, cy=H*0.5;
      var id=setInterval(function(){
        t+=0.03;
        var grad=g.createRadialGradient(cx,cy*0.9,40,cx,cy,Math.max(W,H)*0.6);
        grad.addColorStop(0,'#123a5e');grad.addColorStop(0.55,'#08182b');grad.addColorStop(1,'#01050a');
        g.fillStyle=grad;g.fillRect(0,0,W,H);
        // A subject deliberately near the edges: if the fit crops, it disappears.
        g.fillStyle='rgba(150,220,255,0.85)';
        g.beginPath();g.ellipse(cx+Math.sin(t)*W*0.06,cy+Math.cos(t*0.8)*H*0.04,W*0.15,H*0.2,0,0,Math.PI*2);g.fill();
        g.fillStyle='rgba(220,245,255,0.9)';
        g.beginPath();g.ellipse(cx+Math.sin(t)*W*0.06,cy-H*0.06,W*0.052,H*0.08,0,0,Math.PI*2);g.fill();
        g.fillStyle='rgba(255,230,150,0.9)';
        g.fillRect(W*0.04,H*0.06,26,26);
        g.fillRect(W*0.96-26,H*0.06,26,26);
        g.fillRect(W*0.04,H*0.94-26,26,26);
        g.fillRect(W*0.96-26,H*0.94-26,26,26);
        for(var i=0;i<26;i++){var p=(t*40+i*37)%H;g.globalAlpha=0.5-((p/H)*0.4);g.beginPath();g.arc(W*0.12+i*W*0.03,H-p,3,0,Math.PI*2);g.fill()}
        g.globalAlpha=1;
      },33);
      setTimeout(function(){clearInterval(id);rec.stop()},2600);
    }
    // Diagnostic channel: the accessibility tree exposes the hint line, so the
    // boot screen's own hint doubles as an observation surface while iterating.
    function reportVideo(){
      var hint=document.querySelector('.dshba-hint');
      var v=document.querySelector('.dshba-video');
      if(!hint) return;
      if(!v){ hint.textContent='诊断：没有 video 元素'; return }
      setInterval(function(){
        // Plain concatenation on purpose: this block is itself inside a template
        // literal, so a backtick here would close the outer template.
        var cs=getComputedStyle(v);
        hint.textContent='诊断 shown='+(v.getAttribute('data-shown')||'-')
          +' ready='+v.readyState
          +' op='+cs.opacity
          +' inlineOp='+(v.style.opacity||'-')
          +' mask='+(cs.maskImage||cs.webkitMaskImage||'none').slice(0,26);
      },400);
    }
    // ?opacity=<0..1>&veil=<0..1> sweep the two knobs that decide whether the
    // subject survives the vignette. Guessing them produced a clip that played
    // correctly but was effectively invisible, so they are swept by eye instead.
    var vp=0.96, vl=0.62;
    var q=new URLSearchParams(location.search);
    if(q.get('opacity')) vp=parseFloat(q.get('opacity'));
    if(q.get('veil')) vl=parseFloat(q.get('veil'));
    if(vp!==0.96||vl!==0.62){
      var waitKnobs=setInterval(function(){
        var v=document.querySelector('.dshba-video');
        var veil=document.querySelector('.dshba-veil');
        if(v&&veil){
          clearInterval(waitKnobs);
          v.style.opacity=String(vp);
          veil.style.background='radial-gradient(ellipse 74% 70% at 50% 45%,transparent 34%,rgba(4,10,18,'+vl+') 72%,rgba(2,6,12,'+Math.min(1,vl*1.5)+') 100%)';
        }
      },80);
    }
    // ?fit=contain|cover switches the fit mode so the crop can be compared side
    // by side; the shipped value is contain. No backticks in this block: it sits
    // inside a template literal.
    var fitMatch=location.search.match(/fit=(contain|cover)/);
    if(fitMatch){
      var waitFit=setInterval(function(){
        var v=document.querySelector('.dshba-video');
        if(v){clearInterval(waitFit);v.style.objectFit=fitMatch[1]}
      },80);
    }
    // ?raw=1 disables the vignette and dimming for clip inspection.
    if(location.search.indexOf('raw=1')>=0){
      var waitRaw=setInterval(function(){
        var el=document.querySelector('.dshba');
        if(el){clearInterval(waitRaw);el.setAttribute('data-raw','1')}
      },100);
    }
    // ?diag=1 turns the hint line into a live readout (no backticks here: this
    // block sits inside a template literal).
    if(location.search.indexOf('diag=1')>=0){
      var waitDiag=setInterval(function(){
        if(document.querySelector('.dshba')){clearInterval(waitDiag);reportVideo()}
      },100);
    }
    // ?clip=synthetic renders a clip automatically so the edge fade can be
    // judged without clicking through the overlay that owns the viewport.
    if(location.search.indexOf('clip=synthetic')>=0){
      var wait=setInterval(function(){
        if(document.querySelector('.dshba-video')){clearInterval(wait);syntheticClip()}
      },100);
    }
  </script>
</body></html>`
      res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' })
      res.end(html)
      return
    }
    refuse()
  })().catch(() => { if (!res.headersSent) res.writeHead(500).end() })
})

clipServer.listen(CLIP_PORT, '127.0.0.1', () => {
  process.stdout.write(`clips : http://127.0.0.1:${String(CLIP_PORT)}/\n`)
  pageServer.listen(PAGE_PORT, '127.0.0.1', () => {
    process.stdout.write(`page  : http://127.0.0.1:${String(PAGE_PORT)}/\n`)
    process.stdout.write(`pool  : ${VIDEO_DIR}\n`)
  })
})
