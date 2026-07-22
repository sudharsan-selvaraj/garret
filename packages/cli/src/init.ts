import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const SCHEMA_URL = 'https://garretapp.dev/manifest.schema.json'

/** Scaffold a minimal, immediately-packable pack (a vanilla widget — no npm install needed). */
export function initPack(dir: string, opts: { id?: string; name?: string } = {}): string {
  const id = opts.id || 'you.my-pack'
  const publisher = id.split('.')[0]
  const name = opts.name || 'My Pack'
  const widgetId = 'main'

  if (existsSync(join(dir, 'garret.manifest.json'))) throw new Error(`a pack already exists at ${dir}`)
  mkdirSync(join(dir, 'ui', widgetId), { recursive: true })

  const manifest = {
    $schema: SCHEMA_URL,
    apiVersion: 2,
    id,
    publisher,
    name,
    version: '0.1.0',
    description: 'A Garret widget pack.',
    icon: 'icon.svg',
    readme: 'README.md',
    widgets: [
      {
        id: widgetId,
        name,
        description: 'What this widget shows.',
        ui: `dist/${widgetId}`,
        preview: `previews/${widgetId}.svg`,
        capabilities: [] as string[],
        defaultSize: { w: 4, h: 3 }
      }
    ]
  }

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      :root { color-scheme: dark; }
      html, body { margin: 0; height: 100%; }
      body {
        display: flex; align-items: center; justify-content: center;
        background: #1c1c1e; color: rgba(255,255,255,0.92);
        font-family: -apple-system, system-ui, sans-serif;
      }
    </style>
  </head>
  <body>
    <div id="root">Hello from ${name}</div>
    <!-- Strict CSP (script-src 'self'): scripts must be local files, never inline or remote. -->
    <script type="module" src="app.js"></script>
  </body>
</html>
`
  const app = `// Vanilla widget — no bundler, no deps. Switch to a React main.tsx (import '@garretapp/sdk')
// when you outgrow this; \`garret build\` bundles it automatically.
document.getElementById('root').textContent = new Date().toLocaleTimeString()
`
  const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-label="${name}">
  <rect width="128" height="128" rx="28" fill="#0a84ff"/>
  <circle cx="64" cy="64" r="26" fill="#fff"/>
</svg>
`
  const preview = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" font-family="-apple-system, system-ui, sans-serif">
  <rect width="320" height="200" fill="#1c1c1e"/>
  <text x="160" y="105" fill="rgba(255,255,255,0.85)" font-size="16" font-weight="600" text-anchor="middle">${name}</text>
</svg>
`
  const readme = `# ${name}\n\n${manifest.description}\n\n## Build\n\n\`\`\`\nnpx @garretapp/cli audit\nnpx @garretapp/cli pack\n\`\`\`\n`
  const gitignore = `build/\nnode_modules/\n*.garret\n`

  writeFileSync(join(dir, 'garret.manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  writeFileSync(join(dir, 'ui', widgetId, 'index.html'), html)
  writeFileSync(join(dir, 'ui', widgetId, 'app.js'), app)
  writeFileSync(join(dir, 'icon.svg'), icon)
  writeFileSync(join(dir, 'README.md'), readme)
  writeFileSync(join(dir, '.gitignore'), gitignore)
  mkdirSync(join(dir, 'previews'), { recursive: true })
  writeFileSync(join(dir, 'previews', `${widgetId}.svg`), preview)

  return id
}
