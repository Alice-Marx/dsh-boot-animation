// dsh-boot-animation — the boot-screen music store (Host half).
//
// A user's own background music for the template form. Files live in the
// profile's data directory, never in the installed package, so a plugin
// upgrade keeps them:
//
//   <profile>/data/dsh-boot-animation/music/music-<stamp>-<rand>.<ext>
//   <profile>/data/dsh-boot-animation/music/index.json
//
// The index is a convenience — a display name and a size for the card's list —
// and it is rebuilt from what is on disk whenever it is missing or unreadable,
// so a deleted index costs a list, not the music. The file NAME is what the
// settings store and what the runtime fetches; the display name never touches a
// path.
//
// Ported from dsh-boot-suite (MIT, © LeeRolling / 沈宏宏), lib/host-startup.js's
// music half, with two changes: the directory is the profile's data directory
// rather than DSH_HOME (this package's convention for user media), and the API
// is synchronous for the same reason the template store's is — the index
// injection table is collected synchronously.

import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, unlinkSync, realpathSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { randomBytes } from 'node:crypto'
import { isFileInsideRoot } from './template-store.js'

/** Extensions the store accepts, and the MIME types it answers them with. */
export const MUSIC_EXT_RE = /\.(mp3|wav|ogg|m4a|aac|flac)$/i
export const MUSIC_TYPES = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
}

/**
 * The one shape a stored file name may take.
 *
 * The stamp and the random part are what make two uploads of the same song
 * distinct without trusting the user's file name; the extension is checked
 * again here because this pattern is what every route matches before touching
 * the disk. A name that does not match is not a path this store will build.
 */
export const MUSIC_FILE_RE = /^music-[a-z0-9]{3,16}-[a-z0-9]{6}\.(mp3|wav|ogg|m4a|aac|flac)$/i

/** How many files the index keeps; the directory may hold more. */
const INDEX_LIMIT = 60

/** One upload's ceiling. Upstream's is 100 MB; the runtime decodes to memory. */
export const MUSIC_LIMIT = 100 * 1024 * 1024

/** The display name the card shows: basename without the extension, bounded. */
function displayName(raw) {
  return String(raw || '')
    .replace(/[\\/]/g, '')
    .replace(MUSIC_EXT_RE, '')
    .trim()
    .slice(0, 80)
}

/**
 * Create the music store.
 *
 * The profile directory arrives through an injected owner, exactly as the
 * template store's does — see createTemplateStore for why it is not read with
 * `ctx.get`.
 * @param ctx - Host plugin context.
 * @returns the store's public face.
 */
export function createMusicStore(ctx) {
  let musicRoot = ''

  if (typeof ctx?.inject === 'function') {
    ctx.inject(['profileContext'], (owner) => {
      const profile = owner?.get?.('profileContext')
      const dir = typeof profile?.dir === 'string' ? profile.dir : ''
      if (dir === '') return
      const root = resolve(dir, 'data', 'dsh-boot-animation', 'music')
      musicRoot = root
      owner.effect(() => () => { if (musicRoot === root) musicRoot = '' })
    })
  }

  /** The index file, or an empty list when there is no store yet. */
  function readIndex() {
    if (musicRoot === '') return []
    try {
      const parsed = JSON.parse(readFileSync(join(musicRoot, 'index.json'), 'utf8'))
      if (!Array.isArray(parsed)) return []
      return parsed
        .filter((entry) => entry && typeof entry.file === 'string' && MUSIC_FILE_RE.test(entry.file))
        .map((entry) => ({
          file: entry.file,
          name: displayName(entry.name) || entry.file,
          size: Number.isFinite(entry.size) ? entry.size : 0,
          added: Number.isFinite(entry.added) ? entry.added : 0,
        }))
    } catch {
      return []
    }
  }

  function writeIndex(entries) {
    if (musicRoot === '') return
    try {
      mkdirSync(musicRoot, { recursive: true })
      writeFileSync(join(musicRoot, 'index.json'), JSON.stringify(entries.slice(0, INDEX_LIMIT), null, 2) + '\n', 'utf8')
    } catch {
      // An index that cannot be written costs the card its display names; the
      // files themselves are already on disk and still play.
    }
  }

  /**
   * Every stored track, newest first.
   *
   * A file on disk that the index does not know about is added to the answer
   * rather than hidden: the index is a cache, and the directory is the truth.
   * @returns entries, or [] when there is no profile directory.
   */
  function list() {
    if (musicRoot === '') return []
    const known = new Map(readIndex().map((entry) => [entry.file, entry]))
    let names = []
    try {
      names = readdirSync(musicRoot).filter((name) => MUSIC_FILE_RE.test(name))
    } catch {
      return [...known.values()].sort((left, right) => right.added - left.added)
    }
    const out = []
    for (const name of names) {
      const entry = known.get(name)
      if (entry !== undefined) {
        out.push(entry)
        continue
      }
      try {
        out.push({ file: name, name: displayName(name) || name, size: statSync(join(musicRoot, name)).size, added: 0 })
      } catch {
        // A file that vanished between the two reads is not worth a failure.
      }
    }
    return out.sort((left, right) => right.added - left.added)
  }

  /**
   * Store one uploaded track.
   *
   * The body is already bounded by the caller; the extension is checked here
   * because it decides the stored name. The stored name is generated, never
   * taken from the request — a user's file name is display text, and letting it
   * become a path segment is how a traversal starts.
   * @param displayText - the user's file name, for the card's list.
   * @param extension - the lower-cased extension, already matched.
   * @param bytes - the file body.
   * @returns the stored entry, or null when there is no profile directory.
   */
  function save(displayText, extension, bytes) {
    if (musicRoot === '') return null
    const stamp = Date.now().toString(36)
    const random = randomBytes(4).toString('hex').slice(0, 6)
    const file = `music-${stamp}-${random}${extension}`
    mkdirSync(musicRoot, { recursive: true })
    writeFileSync(join(musicRoot, file), bytes)
    const entry = {
      file,
      name: displayName(displayText) || file,
      size: bytes.byteLength,
      added: Date.now(),
    }
    const index = readIndex().filter((item) => item.file !== file)
    index.unshift(entry)
    writeIndex(index)
    return entry
  }

  /**
   * Resolve one stored file to a readable path inside the music directory.
   * @param file - the stored file name.
   * @returns the absolute path, or null when it does not resolve inside.
   */
  function resolveFile(file) {
    if (typeof file !== 'string' || !MUSIC_FILE_RE.test(file) || musicRoot === '') return null
    const absolute = join(musicRoot, file)
    if (!isFileInsideRoot(absolute, musicRoot)) return null
    try {
      if (!statSync(absolute).isFile()) return null
    } catch {
      return null
    }
    return absolute
  }

  /** Drop one stored track and its index entry.
   *
   * The contract is "make sure it is gone", not "a file was deleted": a track
   * whose file is already absent has reached the desired end state, so the
   * answer is true and the index entry is still cleared — the card must stop
   * offering a file that cannot play. A name that fails containment is the one
   * refusal, because that is a request to reach outside the store.
   * @param file - the stored file name.
   * @returns true when the track is gone afterwards.
   */
  function remove(file) {
    if (typeof file !== 'string' || !MUSIC_FILE_RE.test(file) || musicRoot === '') return false
    const absolute = join(musicRoot, file)
    // Containment is checked only when the file is there: the name whitelist
    // already guarantees the path is inside the root (it is a bare file name),
    // and the realpath check exists for a symlink escape — which a file that
    // does not exist cannot be.
    let present = false
    try {
      present = statSync(absolute).isFile()
    } catch {
      present = false
    }
    if (present && !isFileInsideRoot(absolute, musicRoot)) return false
    if (present) {
      try {
        unlinkSync(absolute)
      } catch {
        // A file that will not delete still loses its index entry below, so the
        // card stops offering it; the answer stays true because the track is
        // out of the rotation either way.
      }
    }
    writeIndex(readIndex().filter((entry) => entry.file !== file))
    return true
  }

  return {
    list,
    save,
    resolveFile,
    remove,
    get root() { return musicRoot },
  }
}
