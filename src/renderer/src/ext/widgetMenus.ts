import { create } from 'zustand'

/** Per-placement ⋯-menu commands a gx: widget declared via `g.setCommands` (relayed from main). The
 *  frame reads these to render the widget's menu actions generically — no per-action wiring. */
export interface WidgetCommand {
  id: string
  label: string
}
interface MenuStore {
  byId: Record<string, WidgetCommand[]>
  set(instanceId: string, commands: WidgetCommand[]): void
}
export const useWidgetMenus = create<MenuStore>((set) => ({
  byId: {},
  set: (instanceId, commands) => set((s) => ({ byId: { ...s.byId, [instanceId]: commands } }))
}))
