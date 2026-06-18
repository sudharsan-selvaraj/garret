// canonicalKey must be IDENTICAL on both sides of the poll boundary (the main
// scheduler's job map ↔ the renderer SDK's subscription keys), so it lives in one
// place — garret-core — and both the host and the widget SDK consume it from there.
export { canonicalKey } from 'garret-core'
