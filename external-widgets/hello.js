// A custom Garret widget loaded at runtime from outside the codebase.
// The host injects `garret` — the React + SDK runtime. Register with
// garret.register({ manifest, render }). No build step needed.

const { h, useState, register } = garret

function Hello({ config, ctx }) {
  const [count, setCount] = useState(0)
  return h(
    'div',
    {
      className: 'native-widget',
      style: {
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: 16,
        textAlign: 'center'
      }
    },
    h('div', { style: { fontSize: 30 } }, '👋'),
    h('div', { style: { fontWeight: 600 } }, 'Hello from outside!'),
    h(
      'div',
      { style: { fontSize: 11.5, color: 'var(--text-3)' } },
      'Loaded from external-widgets/hello.js'
    ),
    h(
      'button',
      { className: 'settings-done', style: { marginTop: 4 }, onClick: () => setCount(count + 1) },
      `Clicked ${count}×`
    )
  )
}

register({
  apiVersion: 1,
  manifest: {
    id: 'hello',
    name: 'Hello (external)',
    icon: '👋',
    description: 'A demo widget loaded at runtime from the external-widgets folder.',
    defaultSize: { w: 3, h: 3 },
    minSize: { w: 2, h: 2 },
    permissions: [],
    configSchema: {}
  },
  render: Hello
})
