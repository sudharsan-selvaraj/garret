import { useEffect, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import type { Preferences } from '@shared/types/preferences'
import { HotkeyRecorder } from '@renderer/app/HotkeyRecorder'
import { ExtensionsManager } from '@renderer/sandbox/ExtensionsManager'

const MAX_ITEM_OPTIONS = [25, 50, 100, 200, 500]

export function GeneralSettings(): JSX.Element {
  const [prefs, setPrefs] = useState<Preferences | null>(null)

  useEffect(() => {
    void window.garret.prefs.get().then(setPrefs)
  }, [])

  const update = async (patch: Partial<Preferences>): Promise<void> => {
    const res = await window.garret.prefs.set(patch)
    if (res.ok) setPrefs(res.prefs)
  }

  return (
    <div className="svc-detail general-settings">
      <div className="svc-detail-head">
        <SlidersHorizontal size={22} strokeWidth={1.75} />
        <div>
          <h3>General</h3>
          <p>App-wide shortcuts and clipboard manager.</p>
        </div>
      </div>

      {prefs && (
        <>
          <p className="settings-section-label">Startup</p>
          <div className="settings-group">
            <div className="settings-row">
              <label className="settings-row-label">Open at login</label>
              <div className="settings-row-control">
                <Toggle on={prefs.openAtLogin} onChange={(v) => void update({ openAtLogin: v })} />
              </div>
            </div>
          </div>
        </>
      )}

      <p className="settings-section-label">Shortcuts</p>
      <div className="settings-group">
        <HotkeyRecorder prefKey="hudHotkey" label="Overlay" />
        <HotkeyRecorder prefKey="clipboardHotkey" label="Clipboard" />
      </div>
      <p className="settings-note">
        The overlay summons your widgets above everything; the clipboard shortcut opens your copy
        history to paste into the focused field.
      </p>

      {prefs && (
        <>
          <p className="settings-section-label">Clipboard manager</p>
          <div className="settings-group">
            <div className="settings-row">
              <label className="settings-row-label">History size</label>
              <div className="settings-row-control">
                <select
                  className="row-input"
                  value={prefs.clipboardMaxItems}
                  onChange={(e) => void update({ clipboardMaxItems: Number(e.target.value) })}
                >
                  {MAX_ITEM_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n} items
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="settings-row">
              <label className="settings-row-label">Keep after quit</label>
              <div className="settings-row-control">
                <Toggle
                  on={prefs.clipboardPersist}
                  onChange={(v) => void update({ clipboardPersist: v })}
                />
              </div>
            </div>
            <div className="settings-row">
              <label className="settings-row-label">Ignore passwords</label>
              <div className="settings-row-control">
                <Toggle
                  on={prefs.clipboardIgnoreConfidential}
                  onChange={(v) => void update({ clipboardIgnoreConfidential: v })}
                />
              </div>
            </div>
          </div>
          <p className="settings-note">
            History is stored encrypted on this Mac. “Ignore passwords” skips items your password
            manager marks confidential.
          </p>
          <button className="settings-clear" onClick={() => window.garret.clipboard.clear()}>
            Clear clipboard history
          </button>

          <p className="settings-section-label">Calendar notifications</p>
          <div className="settings-group">
            <div className="settings-row">
              <label className="settings-row-label">New &amp; cancelled</label>
              <div className="settings-row-control">
                <Toggle
                  on={prefs.calendarNotifyChanges}
                  onChange={(v) => void update({ calendarNotifyChanges: v })}
                />
              </div>
            </div>
            <div className="settings-row">
              <label className="settings-row-label">Remind before</label>
              <div className="settings-row-control">
                <select
                  className="row-input"
                  value={prefs.calendarRemindBefore}
                  onChange={(e) => void update({ calendarRemindBefore: Number(e.target.value) })}
                >
                  <option value={0}>Off</option>
                  <option value={1}>1 min</option>
                  <option value={5}>5 min</option>
                  <option value={10}>10 min</option>
                  <option value={15}>15 min</option>
                </select>
              </div>
            </div>
            <div className="settings-row">
              <label className="settings-row-label">Check every</label>
              <div className="settings-row-control">
                <select
                  className="row-input"
                  value={prefs.calendarSyncMin}
                  onChange={(e) => void update({ calendarSyncMin: Number(e.target.value) })}
                >
                  <option value={1}>1 min</option>
                  <option value={2}>2 min</option>
                  <option value={5}>5 min</option>
                  <option value={15}>15 min</option>
                </select>
              </div>
            </div>
          </div>
          <p className="settings-note">
            Requires Google connected. Reminders fire at the exact time; “check every” is how often
            we look for new/cancelled meetings (the Calendar API is free).
          </p>
        </>
      )}

      <ExtensionsManager />
    </div>
  )
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return (
    <button
      className={`switch${on ? ' on' : ''}`}
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
    >
      <span className="switch-knob" />
    </button>
  )
}
