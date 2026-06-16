/** The kind of a captured clipboard entry (drives the row glyph + paste path). */
export type ClipKind = 'text' | 'link' | 'color' | 'image' | 'files'

/** A single clipboard-history entry. */
export interface ClipItem {
  id: string
  kind: ClipKind
  /** One-line preview shown in the picker list. */
  preview: string
  /** Text content (text / link / color kinds). */
  text?: string
  /** PNG data URL (image kind). */
  imageDataUrl?: string
  /** File-system paths (files kind). */
  files?: string[]
  /** Localized name of the app that was frontmost when this was copied. */
  sourceApp?: string
  /** Epoch millis when captured (or last re-copied). */
  createdAt: number
}
