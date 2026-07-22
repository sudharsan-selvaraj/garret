import { createWriteStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import archiver from 'archiver'
import { buildPack } from './build.js'
import { readManifest } from './audit.js'

/** Recursively list files under `root`, returned as sorted pack-relative POSIX paths (deterministic). */
async function walk(root: string): Promise<string[]> {
  const out: string[] = []
  const rec = async (d: string): Promise<void> => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const abs = join(d, e.name)
      if (e.isDirectory()) await rec(abs)
      else if (e.isFile()) out.push(relative(root, abs).split('\\').join('/'))
    }
  }
  await rec(root)
  return out.sort()
}

/** Build then zip a pack into `<outDir>/<id>.garret`. Entries are added in sorted order for a stable,
 *  reproducible archive. Returns the output file path. */
export async function packPack(dir: string, outDir = process.cwd()): Promise<string> {
  const staging = await buildPack(dir)
  const manifest = await readManifest(dir)
  const outFile = join(outDir, `${String(manifest.id)}.garret`)

  const files = await walk(staging)
  await new Promise<void>((resolve, reject) => {
    const stream = createWriteStream(outFile)
    const zip = archiver('zip', { zlib: { level: 9 } })
    stream.on('close', () => resolve())
    zip.on('error', reject)
    zip.pipe(stream)
    for (const rel of files) zip.file(join(staging, rel), { name: rel, date: new Date(0) })
    void zip.finalize()
  })

  const size = (await stat(outFile)).size
  return `${outFile} (${(size / 1024).toFixed(0)} KB, ${files.length} files)`
}
