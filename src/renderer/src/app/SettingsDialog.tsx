import { useEffect, useState } from 'react'
import { Blocks, Package, SlidersHorizontal } from 'lucide-react'
import type { InstalledPack } from '@shared/types/ext'
import { useUiStore } from '@renderer/app/useUiStore'
import { Dialog } from '@renderer/app/Dialog'
import { GeneralSettings } from '@renderer/app/GeneralSettings'
import { ManageExtensions } from '@renderer/ext/ManageExtensions'
import { WidgetSettings } from '@renderer/ext/WidgetSettings'

const GENERAL = 'general'
const WIDGETS = 'widgets'
const PACK_PREFIX = 'pack:'

export function SettingsDialog(): JSX.Element {
  const close = useUiStore((s) => s.close)
  const initial = useUiStore((s) => s.settingsServiceId)
  const [selected, setSelected] = useState<string>(initial ?? GENERAL)
  // Installed packs that declare any settings → one left-nav section each.
  const [settingsPacks, setSettingsPacks] = useState<InstalledPack[]>([])
  useEffect(() => {
    void window.garret.ext.packs().then((packs) =>
      setSettingsPacks(
        packs.filter(
          (p) => p.widgets.some((w) => (w.settingsSchema?.length ?? 0) > 0) || (p.sharedSettingsSchema?.length ?? 0) > 0
        )
      )
    )
  }, [])
  const selectedPack = selected.startsWith(PACK_PREFIX)
    ? settingsPacks.find((p) => p.id === selected.slice(PACK_PREFIX.length))
    : undefined

  return (
    <Dialog title="Settings" onClose={close} className="dialog-settings">
      <div className="settings-master">
        <ul className="settings-services">
          <li>
            <button
              className={`svc-nav${selected === GENERAL ? ' active' : ''}`}
              onClick={() => setSelected(GENERAL)}
            >
              <SlidersHorizontal size={16} strokeWidth={1.75} />
              <span className="svc-nav-name">General</span>
            </button>
          </li>
          <li>
            <button
              className={`svc-nav${selected === WIDGETS ? ' active' : ''}`}
              onClick={() => setSelected(WIDGETS)}
            >
              <Blocks size={16} strokeWidth={1.75} />
              <span className="svc-nav-name">Widgets</span>
            </button>
          </li>
          {settingsPacks.length > 0 && <li className="settings-nav-sep" />}
          {settingsPacks.map((p) => (
            <li key={p.id}>
              <button
                className={`svc-nav${selected === PACK_PREFIX + p.id ? ' active' : ''}`}
                onClick={() => setSelected(PACK_PREFIX + p.id)}
              >
                <Package size={16} strokeWidth={1.75} />
                <span className="svc-nav-name">{p.name}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="settings-detail">
          {selected === WIDGETS ? (
            <ManageExtensions />
          ) : selectedPack ? (
            <WidgetSettings pack={selectedPack} />
          ) : (
            <GeneralSettings />
          )}
        </div>
      </div>
    </Dialog>
  )
}
