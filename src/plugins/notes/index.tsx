import { useEffect, useState } from 'react'
import { StickyNote } from 'lucide-react'
import { defineWidget, type WidgetRenderProps } from '@sdk'

/** Demonstrates per-instance persistent storage via ctx.storage (no config needed). */
function NotesWidget({ ctx }: WidgetRenderProps): JSX.Element {
  const [text, setText] = useState('')
  const [loaded, setLoaded] = useState(false)

  // Load saved note for this instance.
  useEffect(() => {
    void ctx.storage.get<string>('text').then((v) => {
      setText(v ?? '')
      setLoaded(true)
    })
  }, [ctx])

  // Debounced save back to per-instance storage.
  useEffect(() => {
    if (!loaded) return
    const id = setTimeout(() => void ctx.storage.set('text', text), 400)
    return () => clearTimeout(id)
  }, [text, loaded, ctx])

  return (
    <textarea
      className="native-widget notes-widget"
      value={text}
      placeholder="Jot something…"
      onChange={(e) => setText(e.target.value)}
      spellCheck={false}
    />
  )
}

export default defineWidget({
  manifest: {
    id: 'notes',
    name: 'Notes',
    icon: StickyNote,
    description: 'A quick scratchpad that saves automatically.',
    defaultSize: { w: 3, h: 4 },
    minSize: { w: 2, h: 2 },
    configSchema: {}
  },
  render: NotesWidget
})
