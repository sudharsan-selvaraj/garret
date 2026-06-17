import React from 'react'
import { field, openExternal, services, useFileWatch, usePolledQuery } from '@sdk'
import { registry } from '@renderer/plugins/registry'

/**
 * Dev-tier external widget loader.
 *
 * ⚠️ TRUSTED / DEV-ONLY: each widget is executed with `new Function` in the host
 * realm. That is NOT isolation — it relies on `unsafe-eval` (won't survive a
 * production CSP) and a misbehaving widget could reach host globals. The contract
 * below (only `garret`, a frozen+versioned surface, namespaced ids, declared
 * permissions) is deliberately shaped so the future SANDBOXED tier (iframe +
 * postMessage bridge) can enforce exactly the same contract — a transport swap,
 * not a rewrite. Do not widen the surface here beyond what a sandbox can grant.
 */
const GARRET_API_VERSION = 1

// Contract lock (not enforcement — same realm): a widget may use ONLY `garret`.
const FORBIDDEN = [
  { re: /\bwindow\s*\./, what: 'window' },
  { re: /\bglobalThis\b/, what: 'globalThis' },
  { re: /\brequire\s*\(/, what: 'require()' },
  { re: /\bprocess\s*\./, what: 'process' },
  { re: /\bimport\s*\(/, what: 'import()' }
]

/** Poll an async fn on an interval; re-runs when `deps` change. fn is held in a
 *  ref so a stale closure can't happen regardless of author discipline. (min 5s) */
function usePoll<T>(
  fn: () => Promise<T>,
  intervalMs: number,
  deps: unknown[] = []
): { data?: T; error?: string; loading: boolean } {
  const fnRef = React.useRef(fn)
  fnRef.current = fn
  const [state, setState] = React.useState<{ data?: T; error?: string; loading: boolean }>({
    loading: true
  })
  React.useEffect(() => {
    let alive = true
    const run = (): void => {
      Promise.resolve()
        .then(() => fnRef.current())
        .then((d) => alive && setState({ data: d, loading: false }))
        .catch((e) => alive && setState({ error: e instanceof Error ? e.message : String(e), loading: false }))
    }
    run()
    const id = setInterval(run, Math.max(5000, intervalMs))
    return () => {
      alive = false
      clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, ...deps])
  return state
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function validate(plugin: any): string | null {
  if (!plugin || typeof plugin !== 'object') return 'register() expects an object'
  if (plugin.apiVersion !== GARRET_API_VERSION)
    return `apiVersion ${plugin.apiVersion ?? '(missing)'} is incompatible with host v${GARRET_API_VERSION}`
  const m = plugin.manifest
  if (!m || typeof m.id !== 'string' || !m.id.trim()) return 'manifest.id (non-empty string) required'
  if (typeof m.name !== 'string' || !m.name.trim()) return 'manifest.name (non-empty string) required'
  if (typeof plugin.render !== 'function') return 'render must be a function'
  if (!m.defaultSize || typeof m.defaultSize.w !== 'number' || typeof m.defaultSize.h !== 'number')
    return 'manifest.defaultSize {w,h} required'
  return null
}

/** Per-file `garret` runtime — frozen, with a file-scoped register that validates,
 *  namespaces the id, and logs declared permissions. */
function makeRuntime(file: string): Readonly<Record<string, unknown>> {
  const base = file.replace(/\.js$/i, '')
  return Object.freeze({
    apiVersion: GARRET_API_VERSION,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    register: (plugin: any): void => {
      const err = validate(plugin)
      if (err) {
        console.error(`[plugins] ${file}: ${err} — not registered`)
        return
      }
      const id = `ext:${base}:${plugin.manifest.id}`
      const perms: string[] = Array.isArray(plugin.manifest.permissions)
        ? plugin.manifest.permissions
        : []
      console.info(
        `[plugins] ${file}: registering "${plugin.manifest.name}" as "${id}" — permissions: ${perms.join(', ') || 'none'}`
      )
      registry.register({ ...plugin, manifest: { ...plugin.manifest, id } })
    },
    React,
    h: React.createElement,
    useState: React.useState,
    useEffect: React.useEffect,
    useRef: React.useRef,
    useMemo: React.useMemo,
    field,
    services,
    openExternal,
    usePolledQuery,
    useFileWatch,
    usePoll,
    fetchJson: async (
      url: string,
      init?: { method?: string; headers?: Record<string, string>; body?: string }
    ): Promise<unknown> => {
      const r = await window.garret.plugins.fetch(url, init)
      if (!r || !r.ok) throw new Error(r?.error || `HTTP ${r?.status ?? '???'}`)
      return r.data
    }
  })
}

export async function loadExternalWidgets(): Promise<void> {
  let list: { name: string; source: string }[] = []
  try {
    list = await window.garret.plugins.listExternal()
  } catch (err) {
    console.warn('[plugins] could not list external widgets', err)
    return
  }

  for (const { name, source } of list) {
    const forbidden = FORBIDDEN.find((f) => f.re.test(source))
    if (forbidden) {
      console.error(
        `[plugins] ${name}: references "${forbidden.what}" — widgets may only use the \`garret\` runtime. Skipped.`
      )
      continue
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const run = new Function('garret', `"use strict";\n${source}`) as (
        g: ReturnType<typeof makeRuntime>
      ) => void
      run(makeRuntime(name))
    } catch (err) {
      console.error(`[plugins] failed to load external widget "${name}"`, err)
    }
  }
}
