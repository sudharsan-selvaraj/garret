// A real external data widget: GitHub repo stats (stars / forks / issues).
// Exercises external config (field), host-mediated fetch (no CORS), polling,
// and opening links — all from outside the codebase.

const { h, field, usePoll, fetchJson, openExternal, register } = garret

function Stat(label, value) {
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, flex: 1 } },
    h('div', { style: { fontSize: 20, fontWeight: 600 } }, value),
    h('div', { style: { fontSize: 10.5, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.03em' } }, label)
  )
}

function GithubRepo({ config }) {
  const repo = (config.repo || '').trim()
  const intervalMs = (Number(config.refreshMin) || 15) * 60_000
  const { data, error, loading } = usePoll(
    () => (repo ? fetchJson(`https://api.github.com/repos/${repo}`) : Promise.resolve(null)),
    intervalMs,
    [repo]
  )

  if (!repo) return h('div', { className: 'svc-empty' }, 'Set a repo (owner/name) in ⚙ settings.')
  if (error) return h('div', { className: 'svc-empty' }, repo + ' — ' + (error === 'HTTP 404' ? 'not found' : error))
  if (!data && loading) return h('div', { className: 'svc-empty' }, 'Loading…')
  if (!data) return h('div', { className: 'svc-empty' }, 'No data.')

  const num = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n ?? 0))
  return h(
    'div',
    { className: 'native-widget', style: { display: 'flex', flexDirection: 'column', gap: 12, padding: 14, height: '100%' } },
    h(
      'button',
      {
        onClick: () => openExternal(data.html_url),
        style: { background: 'transparent', border: 'none', textAlign: 'left', color: 'var(--text)', padding: 0 }
      },
      h('div', { style: { fontWeight: 600, fontSize: 13 } }, data.full_name),
      data.description && h('div', { style: { fontSize: 11.5, color: 'var(--text-2)', marginTop: 2 } }, data.description)
    ),
    h(
      'div',
      { style: { display: 'flex', gap: 8, marginTop: 'auto' } },
      Stat('Stars', num(data.stargazers_count)),
      Stat('Forks', num(data.forks_count)),
      Stat('Issues', num(data.open_issues_count))
    )
  )
}

register({
  apiVersion: 1,
  manifest: {
    id: 'github-repo',
    name: 'GitHub Repo',
    icon: '⭐',
    description: 'Stars, forks & open issues for a GitHub repo (external widget).',
    defaultSize: { w: 4, h: 3 },
    minSize: { w: 3, h: 2 },
    permissions: ['network:api.github.com'],
    configSchema: {
      repo: field.text({ label: 'Repo', placeholder: 'owner/name' }),
      refreshMin: field.number({ label: 'Refresh (min)', default: 15 })
    }
  },
  render: GithubRepo
})
