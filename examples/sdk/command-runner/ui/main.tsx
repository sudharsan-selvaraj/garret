import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { useHost } from '@garretapp/sdk/react'
import type { Api } from '../shared/api'

function App(): JSX.Element {
  const host = useHost<Api>({ streams: ['run'] })
  const [cmd, setCmd] = useState('ping -c 3 127.0.0.1')
  const [out, setOut] = useState('')

  const run = (e: React.FormEvent): void => {
    e.preventDefault()
    setOut('')
    host
      .run({ argv: cmd.trim().split(/\s+/) })
      .onData((c) => setOut((o) => o + c))
      .onEnd(({ code }) => setOut((o) => `${o}\n[exit ${code}]`))
      .onError((err) => setOut((o) => `${o}\n[error: ${err.message}]`))
  }

  return (
    <>
      <form onSubmit={run}>
        <input value={cmd} onChange={(e) => setCmd(e.target.value)} spellCheck={false} />
        <button type="submit">Run</button>
      </form>
      <pre>{out}</pre>
    </>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
