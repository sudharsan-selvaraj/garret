#!/usr/bin/env node
import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Issue } from '@garretapp/pack-schema'
import { auditPack } from './audit.js'
import { buildPack, AuditError } from './build.js'
import { packPack } from './pack.js'
import { initPack } from './init.js'

const USAGE = `garret — build & audit Garret widget packs

Usage:
  garret init [dir] [--id publisher.name] [--name "Name"]   scaffold a new pack
  garret audit [dir] [--all]                                validate a pack (CI gate)
  garret build [dir] [--all]                                audit + assemble into build/
  garret pack  [dir] [--all] [--out <dir>]                  build + zip into <id>.garret

  --all              operate on every pack under <dir>/packs/*
  --out <dir>        output directory for .garret files (default: cwd)
`

interface Args {
  _: string[]
  all: boolean
  out?: string
  id?: string
  name?: string
}

function parse(argv: string[]): Args {
  const a: Args = { _: [], all: false }
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]
    if (t === '--all') a.all = true
    else if (t === '--out') a.out = argv[++i]
    else if (t === '--id') a.id = argv[++i]
    else if (t === '--name') a.name = argv[++i]
    else a._.push(t)
  }
  return a
}

const C = { red: '\x1b[31m', yellow: '\x1b[33m', green: '\x1b[32m', dim: '\x1b[2m', reset: '\x1b[0m' }
const isPack = (dir: string): boolean => existsSync(join(dir, 'garret.manifest.json'))

/** Resolve the target pack dir(s): --all → every packs/* with a manifest; else the given/current dir. */
function targets(dir: string, all: boolean): string[] {
  if (!all) return [dir]
  const packsDir = join(dir, 'packs')
  if (!existsSync(packsDir)) fail(`--all: no packs/ directory under ${dir}`)
  return readdirSync(packsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && isPack(join(packsDir, d.name)))
    .map((d) => join(packsDir, d.name))
}

function printIssues(label: string, issues: Issue[]): { errors: number; warns: number } {
  const errors = issues.filter((i) => i.level === 'error')
  const warns = issues.filter((i) => i.level === 'warn')
  for (const i of issues) {
    const tag = i.level === 'error' ? `${C.red}error${C.reset}` : `${C.yellow}warn ${C.reset}`
    console.log(`  ${tag}  ${C.dim}${i.path || '.'}${C.reset}  ${i.message}`)
  }
  const status = errors.length ? `${C.red}✗ ${errors.length} error(s)` : `${C.green}✓ ok`
  console.log(`  ${status}${warns.length ? `, ${warns.length} warning(s)` : ''}${C.reset}  ${C.dim}${label}${C.reset}\n`)
  return { errors: errors.length, warns: warns.length }
}

function fail(msg: string): never {
  console.error(`${C.red}${msg}${C.reset}`)
  process.exit(1)
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2)
  const args = parse(rest)
  const dir = resolve(args._[0] ?? '.')

  if (!cmd || cmd === 'help' || cmd === '--help') {
    console.log(USAGE)
    return
  }

  if (cmd === 'init') {
    const id = initPack(dir, { id: args.id, name: args.name })
    console.log(`${C.green}✓${C.reset} scaffolded ${id} in ${dir}\n  next: ${C.dim}garret pack${C.reset}`)
    return
  }

  const packs = targets(dir, args.all)
  if (packs.length === 0) fail('no packs found')
  let hadError = false

  for (const p of packs) {
    const label = p.split('/').slice(-1)[0]
    if (cmd === 'audit') {
      const { errors } = printIssues(label, await auditPack(p))
      hadError ||= errors > 0
    } else if (cmd === 'build' || cmd === 'pack') {
      try {
        if (cmd === 'build') {
          await buildPack(p)
          console.log(`${C.green}✓${C.reset} built ${label} → ${join(p, 'build')}`)
        } else {
          const out = await packPack(p, args.out ? resolve(args.out) : process.cwd())
          console.log(`${C.green}✓${C.reset} packed ${label} → ${out}`)
        }
      } catch (e) {
        hadError = true
        if (e instanceof AuditError) printIssues(label, e.issues)
        else console.error(`${C.red}✗ ${label}: ${e instanceof Error ? e.message : String(e)}${C.reset}`)
      }
    } else {
      fail(`unknown command: ${cmd}\n\n${USAGE}`)
    }
  }

  if (hadError) process.exit(1)
}

void main()
