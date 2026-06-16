import { useEffect, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'

// ---- Accelerator helpers (KeyboardEvent ⇄ Electron accelerator) -------------

const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Alt', 'Shift', 'CapsLock'])

const KEY_NAMES: Record<string, string> = {
  ' ': 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Escape: 'Esc',
  Enter: 'Enter',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Tab: 'Tab',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown'
}

/** The non-modifier key of an event as an Electron accelerator token, or null. */
function mainKey(e: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null
  if (KEY_NAMES[e.key]) return KEY_NAMES[e.key]
  if (e.key.length === 1) return e.key.toUpperCase()
  if (/^F\d{1,2}$/.test(e.key)) return e.key
  return null
}

function eventToAccelerator(e: KeyboardEvent): { mods: string[]; key: string | null; accelerator: string } {
  const mods: string[] = []
  if (e.metaKey) mods.push('Command')
  if (e.ctrlKey) mods.push('Control')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  const key = mainKey(e)
  return { mods, key, accelerator: key ? [...mods, key].join('+') : '' }
}

const TOKEN_SYMBOLS: Record<string, string> = {
  Command: '⌘',
  Cmd: '⌘',
  CommandOrControl: '⌘',
  CmdOrCtrl: '⌘',
  Meta: '⌘',
  Super: '❖',
  Control: '⌃',
  Ctrl: '⌃',
  Alt: '⌥',
  Option: '⌥',
  Shift: '⇧',
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
  Enter: '⏎',
  Backspace: '⌫',
  Delete: '⌦',
  Tab: '⇥',
  PageUp: 'PgUp',
  PageDown: 'PgDn'
}

/** Split an accelerator into display tokens (e.g. ⌘ ⇧ Space). */
function displayTokens(accel: string): string[] {
  if (!accel) return []
  return accel.split('+').map((t) => TOKEN_SYMBOLS[t] ?? t)
}

// ---- Component --------------------------------------------------------------

export function GeneralSettings(): JSX.Element {
  const [hotkey, setHotkey] = useState('')
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.myview.prefs.get().then((p) => setHotkey(p.hudHotkey))
  }, [])

  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRecording(false)
        return
      }
      const { mods, key, accelerator } = eventToAccelerator(e)
      if (!key) return // still holding only modifiers — wait for the real key
      if (mods.length === 0) {
        setError('Include at least one modifier (⌘ ⌃ ⌥ ⇧).')
        return
      }
      void window.myview.prefs.set({ hudHotkey: accelerator }).then((res) => {
        if (res.ok) {
          setHotkey(res.prefs.hudHotkey)
          setError(null)
        } else {
          setError('That shortcut is reserved or already in use.')
        }
      })
      setRecording(false)
    }
    // Capture phase so we intercept before the dialog/HUD Escape handlers.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording])

  const caps = displayTokens(hotkey)

  return (
    <div className="svc-detail general-settings">
      <div className="svc-detail-head">
        <SlidersHorizontal size={22} strokeWidth={1.75} />
        <div>
          <h3>General</h3>
          <p>App-wide preferences.</p>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-row">
          <label className="settings-row-label">Overlay hotkey</label>
          <div className="settings-row-control hotkey-control">
            <div className={`hotkey-display${recording ? ' recording' : ''}`}>
              {recording ? (
                <span className="hotkey-hint">Press a shortcut…</span>
              ) : caps.length ? (
                caps.map((c, i) => (
                  <kbd className="key-cap" key={i}>
                    {c}
                  </kbd>
                ))
              ) : (
                <span className="hotkey-hint">Not set</span>
              )}
            </div>
            <button
              className="hotkey-btn"
              onClick={() => {
                setError(null)
                setRecording((r) => !r)
              }}
            >
              {recording ? 'Cancel' : 'Change'}
            </button>
          </div>
        </div>
      </div>

      <p className="settings-note">
        Summons the widget overlay above everything — including full-screen apps. Press Esc while
        recording to cancel.
      </p>
      {error && <p className="svc-error">{error}</p>}
    </div>
  )
}
