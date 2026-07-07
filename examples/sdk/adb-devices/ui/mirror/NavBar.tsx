import { useEffect, useState } from 'react'
import type { DeviceAction } from '../../shared/api'

/** The subset of the host client this component drives. */
interface ActionClient {
  action(a: { serial: string; kind: DeviceAction }): Promise<void>
}

// Reveal the bar when the cursor is within this many px of the window bottom. Using a JS proximity
// check (not a hover element) means nothing overlays — and therefore blocks taps on — the device
// screen while the bar is hidden.
const REVEAL_BAND = 96

// lucide-style 18px stroke icons (currentColor); kept inline so the guest bundle needs no icon dep.
const Icon = ({ d, fill }: { d: string; fill?: boolean }): JSX.Element => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill={fill ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
)
const BackIcon = <Icon d="M19 12H5M12 19l-7-7 7-7" />
const HomeIcon = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="12" cy="12" r="9" /></svg>
)
const RecentsIcon = (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.4"><rect x="4" y="4" width="16" height="16" rx="2.5" /></svg>
)
const MoreIcon = <Icon d="M5 12h.01M12 12h.01M19 12h.01" />
const PowerIcon = <Icon d="M12 2v10M18.4 6.6a9 9 0 1 1-12.8 0" />
const VolDownIcon = <Icon d="M11 5 6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6" />
const VolUpIcon = <Icon d="M11 5 6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14" />
const RotateIcon = <Icon d="M23 4v6h-6M20.5 15a9 9 0 1 1-2.1-9.4L23 10" />
const BellIcon = <Icon d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />

/**
 * Auto-hiding device controls, mirroring the Android nav trio (Back / Home / Recents) plus a `⋯`
 * overflow (power, volume, rotate, notifications). Fixed to the bottom-center of the mirror; revealed
 * on cursor proximity so it doesn't cover the device screen the rest of the time. Buttons drive the
 * host `action` channel. Only the pill itself is interactive — the surrounding overlay never blocks
 * touches meant for the device.
 */
export function NavBar({ client, serial }: { client: ActionClient; serial: string }): JSX.Element {
  const [visible, setVisible] = useState(false)
  const [more, setMore] = useState(false)

  useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      const near = e.clientY >= window.innerHeight - REVEAL_BAND
      setVisible(near)
      if (!near) setMore(false)
    }
    const onLeave = (): void => {
      setVisible(false)
      setMore(false)
    }
    window.addEventListener('pointermove', onMove)
    document.addEventListener('pointerleave', onLeave)
    return () => {
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerleave', onLeave)
    }
  }, [])

  const act = (kind: DeviceAction) => (e: React.MouseEvent): void => {
    e.stopPropagation()
    void client.action({ serial, kind }).catch(() => {})
  }

  return (
    <div className={`navbar${visible ? ' is-visible' : ''}`}>
      {more && (
        <div className="nav-pill">
          <button className="nav-btn" title="Power" onClick={act('power')}>{PowerIcon}</button>
          <button className="nav-btn" title="Volume down" onClick={act('volumeDown')}>{VolDownIcon}</button>
          <button className="nav-btn" title="Volume up" onClick={act('volumeUp')}>{VolUpIcon}</button>
          <button className="nav-btn" title="Rotate" onClick={act('rotate')}>{RotateIcon}</button>
          <button className="nav-btn" title="Notifications" onClick={act('notifications')}>{BellIcon}</button>
        </div>
      )}
      <div className="nav-pill">
        <button className="nav-btn" title="Back" onClick={act('back')}>{BackIcon}</button>
        <button className="nav-btn" title="Home" onClick={act('home')}>{HomeIcon}</button>
        <button className="nav-btn" title="Recent apps" onClick={act('appSwitch')}>{RecentsIcon}</button>
        <button
          className={`nav-btn${more ? ' is-on' : ''}`}
          title="More"
          onClick={(e) => {
            e.stopPropagation()
            setMore((m) => !m)
          }}
        >
          {MoreIcon}
        </button>
      </div>
    </div>
  )
}
