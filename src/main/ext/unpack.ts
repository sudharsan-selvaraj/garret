import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join, normalize, sep } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'

/**
 * Slip-safe extraction of a `.garret` (zip) into a caller-owned temp dir, with the SAME guards
 * a folder install enforces (`install.ts` `collectFiles`) applied to a hostile byte stream
 * BEFORE anything reaches disk: per-entry containment (no `..`/absolute escapes), symlink
 * rejection, an extension allowlist, and size/file caps enforced DURING streaming so a
 * zip-bomb can't fill the disk. Throws on any violation; the caller owns + cleans `destDir`.
 *
 * These caps mirror `install.ts` deliberately (kept local so this module stays electron-free
 * and unit-testable in isolation); `collectFiles` re-checks the extracted tree as a second line.
 *
 * Layered path defense: yauzl validates entry filenames by default (rejecting `..`, absolute,
 * and backslash names with its own error), so it's the FIRST line; the `unsafeName` + explicit
 * containment checks below are the backstop in case that ever changes.
 *
 * The extraction POLICY (caps + which files are allowed) is a parameter so the native-extension
 * tier can reuse this exact slip-safe streaming with its own, looser rules (native code is
 * larger and isn't limited to web assets). The default is the sandbox policy — unchanged.
 */
export interface UnpackPolicy {
  maxBytes: number
  maxFiles: number
  /** Return true to admit a file with this lowercased extension + full entry name. */
  allow: (ext: string, name: string) => boolean
}

const ALLOWED_EXT = new Set([
  '.html',
  '.js',
  '.mjs',
  '.css',
  '.json',
  '.map',
  '.png',
  '.jpg',
  '.jpeg',
  '.svg',
  '.woff2'
])

/** Sandbox tier: web assets only, 20 MB / 200 files. */
const SANDBOX_POLICY: UnpackPolicy = {
  maxBytes: 20 * 1024 * 1024,
  maxFiles: 200,
  allow: (ext) => ALLOWED_EXT.has(ext)
}

/**
 * Host packs ship arbitrary JS/assets + a raw-Node host, so allow everything EXCEPT compiled native
 * addons (`.node` — rejected for ABI/packaging reasons; NOT a security boundary — a host pack has
 * full access anyway). Symlinks are still rejected below. Caps are looser but bounded (100 MB / 4000).
 */
export const NATIVE_POLICY: UnpackPolicy = {
  maxBytes: 100 * 1024 * 1024,
  maxFiles: 4000,
  allow: (ext) => ext !== '.node'
}
const S_IFMT = 0xf000
const S_IFLNK = 0xa000

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i).toLowerCase()
}

/** Reject names that could escape the destination or confuse path handling. */
function unsafeName(name: string): boolean {
  return (
    name.includes('\0') ||
    name.includes('\\') || // backslash: never a separator on macOS, only obfuscation here
    name.startsWith('/') ||
    /(^|\/)\.\.(\/|$)/.test(name) // any `..` path segment
  )
}

export async function unpackZip(
  zipPath: string,
  destDir: string,
  policy: UnpackPolicy = SANDBOX_POLICY
): Promise<void> {
  const { maxBytes, maxFiles, allow } = policy
  const root = normalize(destDir)
  await new Promise<void>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('garret: cannot open archive'))
      let files = 0
      let bytes = 0
      let settled = false
      const fail = (e: Error): void => {
        if (settled) return
        settled = true
        zip.close()
        reject(e)
      }
      const next = (): void => {
        if (!settled) zip.readEntry()
      }

      zip.on('error', fail)
      zip.on('end', () => {
        if (!settled) {
          settled = true
          resolve()
        }
      })

      zip.on('entry', (entry: yauzl.Entry) => {
        if (settled) return
        const name = entry.fileName
        if (unsafeName(name)) return fail(new Error(`garret: unsafe path in archive: ${name}`))

        const target = join(root, name)
        if (target !== root && !target.startsWith(root + sep)) {
          return fail(new Error(`garret: path escapes archive root: ${name}`))
        }

        // Unix mode lives in the high 16 bits of the external attributes (when present).
        const mode = (entry.externalFileAttributes >>> 16) & 0xffff
        if ((mode & S_IFMT) === S_IFLNK) return fail(new Error(`garret: symlinks not allowed: ${name}`))

        if (name.endsWith('/')) {
          // Directory entry — create it (contained, above) and move on.
          mkdir(target, { recursive: true }).then(next).catch(fail)
          return
        }

        const ext = extOf(name)
        if (!allow(ext, name)) return fail(new Error(`garret: file type not allowed: ${name}`))
        if (++files > maxFiles) return fail(new Error(`garret: archive has too many files (>${maxFiles})`))

        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) return fail(streamErr ?? new Error('garret: read failed'))
          // Count bytes inside the pipeline (don't trust the header size); abort on overflow.
          const meter = new Transform({
            transform(chunk: Buffer, _enc, cb): void {
              bytes += chunk.length
              if (bytes > maxBytes) return cb(new Error('garret: archive exceeds size limit'))
              cb(null, chunk)
            }
          })
          mkdir(dirname(target), { recursive: true })
            .then(() => pipeline(stream, meter, createWriteStream(target)))
            .then(next)
            .catch(fail)
        })
      })

      zip.readEntry()
    })
  })
}
