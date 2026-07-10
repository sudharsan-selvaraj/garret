import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { clipboard, nativeImage } from 'electron'
import type { ClipItem, ClipKind } from '@shared/types/clipboard'
import { persistence } from '@main/persistence/store'
import * as mac from '@main/windows/macWindow'
import { clearPersistedHistory, loadHistory, saveHistory } from './store'

const POLL_MS = 700
// Skip images whose data URL exceeds this (~4.5MB) to keep history bounded.
const MAX_IMAGE_CHARS = 6_000_000
// Keep at most this many images in history (evict oldest image beyond it).
const IMAGE_CAP = 20

let history: ClipItem[] = []
let lastChangeCount = -1
let timer: ReturnType<typeof setInterval> | null = null
let notify: () => void = () => {}
let saveTimer: ReturnType<typeof setTimeout> | null = null

// ---- Content classification -------------------------------------------------

const URL_RE = /^(https?:\/\/|www\.)\S+$/i
const COLOR_RE = /^(#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\([^)]+\)|hsla?\([^)]+\))$/i

function detectTextKind(text: string): ClipKind {
  const t = text.trim()
  if (URL_RE.test(t)) return 'link'
  if (COLOR_RE.test(t)) return 'color'
  return 'text'
}

function oneLine(text: string, max = 140): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length > max ? collapsed.slice(0, max) + '…' : collapsed
}

function contentKey(item: ClipItem): string {
  switch (item.kind) {
    case 'image':
      return 'i:' + (item.imageDataUrl?.length ?? 0) + ':' + (item.imageDataUrl?.slice(28, 124) ?? '')
    case 'files':
      return 'f:' + (item.files ?? []).join('|')
    default:
      return 't:' + (item.text ?? '')
  }
}

// ---- Capture ----------------------------------------------------------------

function add(partial: Omit<ClipItem, 'id' | 'createdAt'>): void {
  const prefs = persistence.getPreferences()
  const item: ClipItem = { id: randomUUID(), createdAt: Date.now(), ...partial }
  const key = contentKey(item)
  history = history.filter((h) => contentKey(h) !== key)
  history.unshift(item)

  // Cap total count, then cap images specifically.
  if (history.length > prefs.clipboardMaxItems) history = history.slice(0, prefs.clipboardMaxItems)
  let images = 0
  history = history.filter((h) => h.kind !== 'image' || ++images <= IMAGE_CAP)

  if (prefs.clipboardPersist) scheduleSave()
  notify()
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => saveHistory(history), 400)
}

function capture(): void {
  const prefs = persistence.getPreferences()
  if (prefs.clipboardIgnoreConfidential && mac.pasteboardIsConcealed()) return
  const sourceApp = mac.frontmostAppName() || undefined

  // Priority: files > text > image. (Text takes precedence over image so a normal
  // text copy that also exposes a rendered image isn't mis-filed as an image.)
  const files = mac.pasteboardFileURLs()
  if (files.length) {
    add({
      kind: 'files',
      files,
      preview: files.map((f) => basename(f)).join(', '),
      sourceApp
    })
    return
  }

  const text = clipboard.readText()
  if (text && text.trim()) {
    add({ kind: detectTextKind(text), text, preview: oneLine(text), sourceApp })
    return
  }

  const img = clipboard.readImage()
  if (!img.isEmpty()) {
    const dataUrl = img.toDataURL()
    if (dataUrl.length <= MAX_IMAGE_CHARS) {
      const { width, height } = img.getSize()
      add({ kind: 'image', imageDataUrl: dataUrl, preview: `Image · ${width}×${height}`, sourceApp })
    }
  }
}

function tick(): void {
  const cc = mac.pasteboardChangeCount()
  if (cc === lastChangeCount) return
  lastChangeCount = cc
  capture()
}

// ---- Public API -------------------------------------------------------------

export function initClipboard(onChange: () => void): void {
  notify = onChange
  history = loadHistory()
  lastChangeCount = mac.pasteboardChangeCount() // don't capture whatever's already copied
  if (timer) clearInterval(timer)
  timer = setInterval(tick, POLL_MS)
}

export function listClipboard(): ClipItem[] {
  return history
}

export function getClip(id: string): ClipItem | undefined {
  return history.find((h) => h.id === id)
}

export function deleteClip(id: string): void {
  history = history.filter((h) => h.id !== id)
  if (persistence.getPreferences().clipboardPersist) scheduleSave()
  notify()
}

export function clearClips(): void {
  history = []
  clearPersistedHistory()
  notify()
}

/** Write an item back to the system clipboard (so a subsequent ⌘V pastes it). */
export function applyToPasteboard(item: ClipItem): void {
  if (item.kind === 'image' && item.imageDataUrl) {
    clipboard.writeImage(nativeImage.createFromDataURL(item.imageDataUrl))
  } else if (item.kind === 'files' && item.files?.length) {
    if (!mac.writeFileURLs(item.files)) clipboard.writeText(item.files.join('\n'))
  } else if (item.text != null) {
    clipboard.writeText(item.text)
  }
  // Don't recapture our own write as a brand-new entry.
  lastChangeCount = mac.pasteboardChangeCount()
}
