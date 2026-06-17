// Generates build/icon.png (1024²) — Garret's mark: a 2×2 widget grid in white
// on an accent-blue rounded square. Run `node scripts/make-icon.cjs`, then the
// build:icon npm script turns it into build/icon.icns via iconutil.
const zlib = require('zlib')
const fs = require('fs')
const path = require('path')

const N = 1024
const ACCENT = [10, 132, 255]
const px = Buffer.alloc(N * N * 4) // transparent

function set(x, y, [r, g, b], a = 255) {
  if (x < 0 || y < 0 || x >= N || y >= N) return
  const i = (y * N + x) * 4
  px[i] = r
  px[i + 1] = g
  px[i + 2] = b
  px[i + 3] = a
}

// Rounded-rect signed-distance test (inset-rect + corner radius).
function inRound(x, y, left, top, w, h, r) {
  const right = left + w
  const bottom = top + h
  if (x < left || x >= right || y < top || y >= bottom) return false
  const cx = Math.min(Math.max(x, left + r), right - 1 - r)
  const cy = Math.min(Math.max(y, top + r), bottom - 1 - r)
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= r * r
}

function fillRound(left, top, w, h, r, color, a = 255) {
  for (let y = Math.floor(top); y < top + h; y++) {
    for (let x = Math.floor(left); x < left + w; x++) {
      if (inRound(x, y, left, top, w, h, r)) set(x, y, color, a)
    }
  }
}

// Background squircle.
const m = Math.round(N * 0.08)
const side = N - m * 2
fillRound(m, m, side, side, Math.round(side * 0.235), ACCENT)

// 2×2 white grid inside it.
const pad = Math.round(side * 0.2)
const gap = Math.round(side * 0.08)
const inner = side - pad * 2
const sq = Math.round((inner - gap) / 2)
const sr = Math.round(sq * 0.28)
const ox = m + pad
const oy = m + pad
for (const [gx, gy] of [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1]
]) {
  fillRound(ox + gx * (sq + gap), oy + gy * (sq + gap), sq, sq, sr, [255, 255, 255], 245)
}

// --- encode PNG (RGBA) ---
const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const t = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0)
  return Buffer.concat([len, t, data, crc])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(N, 0)
ihdr.writeUInt32BE(N, 4)
ihdr[8] = 8
ihdr[9] = 6
const stride = N * 4
const raw = Buffer.alloc((stride + 1) * N)
for (let y = 0; y < N; y++) px.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0))
])
const out = path.join(__dirname, '..', 'build', 'icon.png')
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, png)
console.log('wrote', out, png.length, 'bytes')
