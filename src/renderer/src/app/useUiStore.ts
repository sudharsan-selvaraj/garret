import { create } from 'zustand'

type Dialog = null | 'settings' | 'add'

interface UiStore {
  dialog: Dialog
  settingsServiceId: string | null
  hud: boolean
  openSettings: (serviceId?: string) => void
  openAdd: () => void
  close: () => void
  setHud: (hud: boolean) => void
}

export const useUiStore = create<UiStore>((set) => ({
  dialog: null,
  settingsServiceId: null,
  hud: false,
  openSettings: (serviceId) => set({ dialog: 'settings', settingsServiceId: serviceId ?? null }),
  openAdd: () => set({ dialog: 'add' }),
  close: () => set({ dialog: null }),
  setHud: (hud) => set({ hud })
}))
