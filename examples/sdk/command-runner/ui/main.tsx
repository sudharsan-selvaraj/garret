import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { useHost, useStream } from '@garretapp/sdk/react'
import { parseArgv } from '@garretapp/sdk'
import type { Api } from '../shared/api'

function App(): JSX.Element {
  const host = useHost<Api>() // stream-vs-Promise inferred from Api — nothing to configure
  const [cmd, setCmd] = useState('ping -c 3 127.0.0.1')
  const [argv, setArgv] = useState<string[] | null>(null)

  // useStream owns the lifecycle: it cancels on unmount and restarts when `argv` changes.
  // `enabled` defers the first run until the user actually submits a command.
  const { chunks, result, error, status } = useStream(() => host.run({ argv: argv! }), [argv], {
    enabled: argv !== null
  })

  const output = argv
    ? chunks.join('') +
      (error ? `\n[error: ${error.message}]` : status === 'done' ? `\n[exit ${result?.code}]` : '')
    : ''

  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          setArgv(parseArgv(cmd)) // quote-aware split
        }}
      >
        <input value={cmd} onChange={(e) => setCmd(e.target.value)} spellCheck={false} />
        <button type="submit">Run</button>
      </form>
      <pre>{output}</pre>
    </>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
