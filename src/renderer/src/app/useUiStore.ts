import { create } from 'zustand'

type Dialog = null | 'settings' | 'add'

interface UiStore {
  dialog: Dialog
  settingsServiceId: string | null
  openSettings: (serviceId?: string) => void
  openAdd: () => void
  close: () => void
}

export const useUiStore = create<UiStore>((set) => ({
  dialog: null,
  settingsServiceId: null,
  openSettings: (serviceId) => set({ dialog: 'settings', settingsServiceId: serviceId ?? null }),
  openAdd: () => set({ dialog: 'add' }),
  close: () => set({ dialog: null })
}))
