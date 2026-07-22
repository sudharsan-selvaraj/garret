import { validateManifest } from './src/index'

// Self-contained regression test for the manifest rulebook. Run: `npm test -w @garretapp/pack-schema`.
let fails = 0
const errs = (m: unknown) => validateManifest(m).filter((i) => i.level === 'error')
const check = (label: string, ok: boolean, detail = ''): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
  if (!ok) fails++
}

const base = { apiVersion: 2, publisher: 'acme', id: 'acme.x', name: 'X' }
const w = { id: 'a', name: 'A', ui: 'dist/a', capabilities: [] as string[] }

// Valid manifests — must produce ZERO errors.
const valid: Array<[string, unknown]> = [
  ['minimal widget', { ...base, widgets: [w] }],
  ['network + settings', { ...base, widgets: [{ ...w, capabilities: ['secrets', 'network:*.example.com'], settings: { schema: [{ key: 'url', label: 'URL', type: 'string' }] } }] }],
  ['host + surface + notifier', { ...base, widgets: [{ ...w, capabilities: ['windows', 'process'], host: 'dist/host/index.cjs', surfaces: { mirror: { name: 'M', ui: 'dist/mirror', defaultSize: { w: 360, h: 760 }, minSize: { w: 180, h: 380 } } }, notifier: { request: { url: 'https://x/y' }, idField: 'id', titleTemplate: '{item.t}' } }], shared: { settings: { schema: [{ key: 'token', label: 'Token', type: 'secret' }] } } }]
]
for (const [label, m] of valid) {
  const e = errs(m)
  check(`valid: ${label}`, e.length === 0, `(${e.length} errors)`)
  e.forEach((x) => console.log('        →', x.message))
}

// Invalid manifests — each must surface the expected error code.
const bad: Array<[string, unknown, string]> = [
  ['legacy apiVersion', { ...base, apiVersion: 1, widgets: [w] }, 'apiVersion.legacy'],
  ['too-new apiVersion', { ...base, apiVersion: 99, widgets: [w] }, 'apiVersion.tooNew'],
  ['bad publisher', { ...base, publisher: 'Acme!', widgets: [w] }, 'publisher.format'],
  ['id not namespaced', { ...base, id: 'acme', widgets: [w] }, 'id.format'],
  ['missing name', { ...base, name: '', widgets: [w] }, 'name.required'],
  ['no widgets', { ...base, widgets: [] }, 'widgets.empty'],
  ['bad widget id', { ...base, widgets: [{ ...w, id: 'A B' }] }, 'widget.id'],
  ['ui escapes pack', { ...base, widgets: [{ ...w, ui: '../evil' }] }, 'widget.ui'],
  ['absolute ui', { ...base, widgets: [{ ...w, ui: '/etc' }] }, 'widget.ui'],
  ['host escapes pack', { ...base, widgets: [{ ...w, host: '../../x' }] }, 'widget.host'],
  ['unknown capability', { ...base, widgets: [{ ...w, capabilities: ['telepathy'] }] }, 'widget.capability'],
  ['dup widget id', { ...base, widgets: [w, { ...w, ui: 'dist/b' }] }, 'widget.duplicate'],
  ['surface needs windows', { ...base, widgets: [{ ...w, surfaces: { s: { name: 'S', ui: 'dist/s' } } }] }, 'surfaces.windows'],
  ['surface ui = root', { ...base, widgets: [{ ...w, capabilities: ['windows'], surfaces: { s: { name: 'S', ui: '.' } } }] }, 'surface.ui.own'],
  ['surface ui = widget ui', { ...base, widgets: [{ ...w, capabilities: ['windows'], surfaces: { s: { name: 'S', ui: 'dist/a' } } }] }, 'surface.ui.own'],
  ['host inside surface ui', { ...base, widgets: [{ ...w, capabilities: ['windows'], host: 'dist/s/h.cjs', surfaces: { s: { name: 'S', ui: 'dist/s' } } }] }, 'surface.ui.host'],
  ['surface bad size', { ...base, widgets: [{ ...w, capabilities: ['windows'], surfaces: { s: { name: 'S', ui: 'dist/s', defaultSize: { w: 10, h: 10 } } } }] }, 'surface.defaultSize']
]
for (const [label, m, code] of bad) {
  const got = errs(m).map((x) => x.code)
  check(`invalid: ${label}`, got.includes(code), `(expected ${code}; got ${got.join(',') || 'none'})`)
}

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`)
process.exit(fails === 0 ? 0 : 1)
