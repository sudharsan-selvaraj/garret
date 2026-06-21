import type { InstallPlan } from '@shared/types/sandbox'
import { resyncSandboxedWidgets } from '@renderer/sandbox/loader'

/**
 * Commit a confirmed install plan, then clean up its `.garret` staging dir (if any) and
 * re-sync the registry so the widget is immediately placeable. Shared by the Settings pane
 * and the double-click-a-.garret flow so both behave identically.
 */
export async function commitPlan(plan: InstallPlan): Promise<{ ok: boolean; error?: string }> {
  const res = await window.garret.sandbox.commitInstall(plan)
  if (plan.staged) window.garret.sandbox.installCleanup(plan.source)
  if (res.ok) await resyncSandboxedWidgets()
  return res
}

/** Discard a pending plan's staging dir (cancel path). No-op for folder installs. */
export function cancelPlan(plan: InstallPlan): void {
  if (plan.staged) window.garret.sandbox.installCleanup(plan.source)
}
