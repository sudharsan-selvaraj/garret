import { useEffect, useState } from 'react'
import type { Preferences } from '@shared/types/preferences'

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

function displayTokens(accel: string): string[] {
  if (!accel) return []
  return accel.split('+').map((t) => TOKEN_SYMBOLS[t] ?? t)
}

// ---- Component --------------------------------------------------------------

type HotkeyPref = Extract<keyof Preferences, 'hudHotkey' | 'clipboardHotkey'>

/** A row that records a global shortcut into the given Preferences key. */
export function HotkeyRecorder({ prefKey, label }: { prefKey: HotkeyPref; label: string }): JSX.Element {
  const [hotkey, setHotkey] = useState('')
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.garret.prefs.get().then((p) => setHotkey(p[prefKey] as string))
  }, [prefKey])

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
      if (!key) return
      if (mods.length === 0) {
        setError('Include at least one modifier (⌘ ⌃ ⌥ ⇧).')
        return
      }
      void window.garret.prefs.set({ [prefKey]: accelerator }).then((res) => {
        if (res.ok) {
          setHotkey(res.prefs[prefKey] as string)
          setError(null)
        } else {
          setError('That shortcut is reserved or already in use.')
        }
      })
      setRecording(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, prefKey])

  const caps = displayTokens(hotkey)

  return (
    <div className="settings-row">
      <label className="settings-row-label">{label}</label>
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
      {error && <p className="svc-error hotkey-error">{error}</p>}
    </div>
  )
}
