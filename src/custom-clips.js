// Profile-owned media stays outside the installed npm package.
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, lstat, realpath, open, unlink, link } from 'node:fs/promises'
import { join, relative, isAbsolute, extname, basename } from 'node:path'

const LIMIT = 256 * 1024 * 1024
const EXTENSIONS = new Set(['.mp4', '.webm', '.m4v', '.mov'])
const STORED = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}_/i
const problem = (status, message) => Object.assign(new Error(message), { status })

function validName(name) {
  return name && name === basename(name) && !/[\\/:\x00-\x1f]/.test(name)
    && !name.includes('..') && Buffer.byteLength(name, 'utf8') <= 180
    && EXTENSIONS.has(extname(name).toLowerCase())
}

async function directory(profile, create) {
  const root = await realpath(profile)
  let current = root
  for (const segment of ['data', 'dsh-boot-animation', 'videos']) {
    current = join(current, segment)
    if (create) await mkdir(current).catch(error => { if (error.code !== 'EEXIST') throw error })
    let info
    try { info = await lstat(current) } catch (error) {
      if (!create && error.code === 'ENOENT') return null
      throw error
    }
    if (!info.isDirectory() || info.isSymbolicLink()) throw problem(409, '视频保存目录不可用。')
    const inside = relative(root, await realpath(current))
    if (inside.startsWith('..') || isAbsolute(inside)) throw problem(409, '视频保存目录不可用。')
  }
  return current
}

async function regularFile(dir, name) {
  if (!dir || !STORED.test(name) || !validName(name.slice(37))) throw problem(404, '视频不存在。')
  const file = join(dir, name)
  const info = await lstat(file).catch(error => {
    if (error.code === 'ENOENT') throw problem(404, '视频不存在。')
    throw error
  })
  if (!info.isFile() || info.isSymbolicLink()) throw problem(404, '视频不存在。')
  return { file, info }
}

export function createCustomClips(ctx, { route, serveClip, sendJson, readFaststart }) {
  let active = null

  async function record(dir, name) {
    const { file, info } = await regularFile(dir, name)
    return {
      file, name: 'custom/' + name, displayName: name.slice(37), custom: true,
      src: `${route}/custom-clip/${encodeURIComponent(name)}?v=${Math.round(info.mtimeMs)}-${info.size}`,
      mtime: info.mtimeMs, revision: Math.round(info.mtimeMs), bytes: info.size,
      faststart: await readFaststart(file),
    }
  }

  function authorize(state, req) {
    const status = state.connection.requestRejection(req)
    if (status !== undefined) throw problem(status === 403 ? 403 : 401, '请在已登录的 DSH 页面中操作。')
  }

  async function upload(state, req, res, url) {
    const name = url.searchParams.get('name') || ''
    if (!validName(name)) throw problem(400, '请选择文件名有效的 MP4、WebM、M4V 或 MOV 视频。')
    const length = req.headers['content-length']
    if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > LIMIT)) {
      throw problem(413, '单个视频不能超过 256 MB。')
    }
    let handle, temporary, dir, bytes = 0
    let prefix = Buffer.alloc(0)
    let pending = []
    const webm = extname(name).toLowerCase() === '.webm'
    try {
      // Retain only the small initial header and the current stream chunk.
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        bytes += chunk.length
        if (bytes > LIMIT) throw problem(413, '单个视频不能超过 256 MB。')
        if (!handle) {
          pending.push(chunk)
          prefix = Buffer.concat([prefix, chunk.subarray(0, 8 - prefix.length)]).subarray(0, 8)
          if (prefix.length < (webm ? 4 : 8)) continue
          const atom = prefix.subarray(4, 8).toString('ascii')
          const quickTime = extname(name).toLowerCase() === '.mov'
            && ['moov', 'mdat', 'wide', 'free'].includes(atom)
            && (prefix.readUInt32BE(0) === 0 || prefix.readUInt32BE(0) >= 8)
          const valid = webm ? prefix.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
            : atom === 'ftyp' || quickTime
          if (!valid) throw problem(400, '文件不是有效的视频，请重新导出后再导入。')
          dir = await directory(state.profile, true)
          temporary = join(dir, '.upload-' + randomUUID())
          handle = await open(temporary, 'wx', 0o600)
          for (const buffered of pending) await handle.writeFile(buffered)
          pending = []
        } else await handle.writeFile(chunk)
      }
      if (!handle || !bytes || req.aborted) throw problem(400, '视频为空、不完整或导入已取消。')
      await handle.close()
      handle = null
      const stored = randomUUID() + '_' + name
      // A hard link publishes a complete file atomically without replacing one.
      await link(temporary, join(dir, stored))
      await unlink(temporary)
      temporary = null
      const { file, mtime, ...clip } = await record(dir, stored)
      sendJson(res, 200, { ok: true, clip })
    } finally {
      if (handle) await handle.close().catch(() => {})
      if (temporary) await unlink(temporary).catch(() => {})
    }
  }

  if (typeof ctx.inject === 'function') {
    ctx.inject(['profileContext', 'connection'], owner => {
      const profile = owner.get('profileContext')
      const connection = owner.get('connection')
      if (!isAbsolute(profile?.dir || '') || typeof connection?.requestRejection !== 'function') return
      const state = { profile: profile.dir, connection }
      active = state
      owner.effect(() => () => { if (active === state) active = null })
      const handler = (req, res) => {
        void (async () => {
          authorize(state, req)
          try { decodeURIComponent(req.url || '') } catch { throw problem(400, '视频地址无效。') }
          const url = new URL(req.url || '/', 'http://localhost')
          if (url.pathname === route + '/upload') {
            if (req.method !== 'POST') throw problem(405, '这个地址只接受 POST。')
            await upload(state, req, res, url)
            return
          }
          const prefix = route + '/custom-clip/'
          if (!url.pathname.startsWith(prefix)) throw problem(404, '视频不存在。')
          const name = decodeURIComponent(url.pathname.slice(prefix.length))
          if (name.includes('/') || name.includes('\\')) throw problem(400, '视频地址无效。')
          const dir = await directory(state.profile, false)
          const { file } = await regularFile(dir, name)
          if (req.method === 'DELETE') {
            await unlink(file)
            sendJson(res, 200, { ok: true })
          } else if (req.method === 'GET' || req.method === 'HEAD') await serveClip(file, req, res)
          else throw problem(405, '不支持这个操作。')
        })().catch(error => {
          if (res.destroyed) return
          if (res.headersSent) { res.destroy(); return }
          if (req.method === 'POST') res.setHeader('connection', 'close')
          if (!error.status) ctx.logger?.error?.('boot-animation: custom media failed', error)
          sendJson(res, error.status || 500, { ok: false, error: error.status ? error.message : '视频操作失败，请稍后重试。' })
        })
      }
      for (const path of [route + '/upload', route + '/custom-clip']) {
        owner.effect(() => ctx.webServer.register({ kind: 'prefix', path, handler }))
      }
    })
  }

  return {
    async listClips(req) {
      if (!active || !req) return []
      if (active.connection.requestRejection(req) !== undefined) return []
      const dir = await directory(active.profile, false)
      if (!dir) return []
      const entries = await readdir(dir, { withFileTypes: true })
      const clips = await Promise.all(entries.filter(entry => entry.isFile() && STORED.test(entry.name))
        .map(entry => record(dir, entry.name).catch(error => {
          if (error.status === 404 || error.code === 'ENOENT') return null
          throw error
        })))
      return clips.filter(Boolean)
    },
  }
}
