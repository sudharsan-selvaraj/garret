import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { build as esbuild } from 'esbuild'
import { auditPack, readManifest } from './audit.js'
import type { Issue } from '@garretapp/pack-schema'

export class AuditError extends Error {
  constructor(public issues: Issue[]) {
    super('audit failed')
  }
}

/**
 * Assemble a pack's zip-root into `outDir` (default `<dir>/build`): the manifest + icon/readme/previews
 * verbatim, each `ui/<name>` bundled (main.tsx → esbuild) or copied (vanilla) to `dist/<name>`, and
 * `host/index.ts` compiled to `dist/host/index.cjs` (+ `host/assets`). Audits first; throws AuditError
 * on any error. Mirrors the layout the app installs and `garret.manifest.json` references.
 */
export async function buildPack(dir: string, outDir = join(dir, 'build')): Promise<string> {
  const issues = await auditPack(dir)
  if (issues.some((i) => i.level === 'error')) throw new AuditError(issues)

  const manifest = await readManifest(dir)
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(join(outDir, 'dist'), { recursive: true })

  // manifest + assets (icon, readme, each widget's preview) copied verbatim to the zip root.
  cpSync(join(dir, 'garret.manifest.json'), join(outDir, 'garret.manifest.json'))
  const assets = [
    manifest.icon,
    manifest.readme || 'README.md',
    ...((manifest.widgets as Array<{ preview?: unknown }>) ?? []).map((w) => w.preview)
  ]
  for (const rel of assets) {
    if (typeof rel === 'string' && !rel.includes('..') && existsSync(join(dir, rel))) {
      mkdirSync(join(outDir, rel, '..'), { recursive: true })
      cpSync(join(dir, rel), join(outDir, rel))
    }
  }

  // Each ui/<name> with an index.html → dist/<name>. React (main.tsx) is bundled self-contained
  // (CSP script-src 'self', no CDN); vanilla UIs are copied as-is.
  const uiDir = join(dir, 'ui')
  if (existsSync(uiDir)) {
    for (const w of readdirSync(uiDir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
      const src = join(uiDir, w.name)
      if (!existsSync(join(src, 'index.html'))) continue // shared lib etc. — reachable via import
      const dest = join(outDir, 'dist', w.name)
      mkdirSync(dest, { recursive: true })
      cpSync(join(src, 'index.html'), join(dest, 'index.html'))
      const entry = join(src, 'main.tsx')
      if (existsSync(entry)) {
        await esbuild({
          entryPoints: [entry],
          bundle: true,
          format: 'esm',
          jsx: 'automatic',
          minify: true,
          target: ['chrome122'],
          define: { 'process.env.NODE_ENV': '"production"' },
          outfile: join(dest, 'app.js')
        })
      } else {
        for (const f of readdirSync(src)) if (f !== 'index.html') cpSync(join(src, f), join(dest, f), { recursive: true })
      }
    }
  }

  // Optional Node host → dist/host/index.cjs (platform node; deps inlined, builtins external).
  const hostEntry = join(dir, 'host', 'index.ts')
  if (existsSync(hostEntry)) {
    await esbuild({
      entryPoints: [hostEntry],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: ['node20'],
      minify: true,
      outfile: join(outDir, 'dist', 'host', 'index.cjs')
    })
    const hostAssets = join(dir, 'host', 'assets')
    if (existsSync(hostAssets)) cpSync(hostAssets, join(outDir, 'dist', 'host'), { recursive: true })
  }

  return outDir
}
