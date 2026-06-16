import zlib from 'node:zlib'
import { nativeImage, type NativeImage } from 'electron'

// We generate the menu-bar icon at runtime as a template PNG (black + alpha;
// macOS recolors template images to match light/dark menu bars). This avoids
// shipping a binary asset / build pipeline for a single small glyph.

const CRC_TABLE = ((): Uint32Array => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

function encodePng(size: number, rgba: Buffer): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0 // filter type: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/** A 2×2 grid of squares (the "widgets" motif), black with alpha. */
function drawGridIcon(size: number): Buffer {
  const px = Buffer.alloc(size * size * 4) // zero-filled = transparent
  const margin = Math.round(size * 0.125)
  const gap = Math.round(size * 0.125)
  const sq = Math.floor((size - margin * 2 - gap) / 2)
  const origins = [
    [margin, margin],
    [margin + sq + gap, margin],
    [margin, margin + sq + gap],
    [margin + sq + gap, margin + sq + gap]
  ]
  for (const [ox, oy] of origins) {
    for (let y = 0; y < sq; y++) {
      for (let x = 0; x < sq; x++) {
        const dx = Math.min(x, sq - 1 - x)
        const dy = Math.min(y, sq - 1 - y)
        if (dx === 0 && dy === 0) continue // clip the corner pixel → subtle rounding
        const i = ((oy + y) * size + (ox + x)) * 4
        px[i] = 0
        px[i + 1] = 0
        px[i + 2] = 0
        px[i + 3] = 255
      }
    }
  }
  return px
}

/** Build the menu-bar template icon (32px buffer rendered at 16pt on retina). */
export function createTrayIcon(): NativeImage {
  const img = nativeImage.createFromBuffer(encodePng(32, drawGridIcon(32)), { scaleFactor: 2 })
  img.setTemplateImage(true)
  return img
}
