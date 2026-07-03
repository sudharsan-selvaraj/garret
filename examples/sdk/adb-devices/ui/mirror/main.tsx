import { createRoot } from 'react-dom/client'
import { useEffect, useRef, useState } from 'react'
import { useHost, useProps, useGarret } from '@garretapp/sdk/react'
import { WebCodecsVideoDecoder, WebGLVideoFrameRenderer } from '@yume-chan/scrcpy-decoder-webcodecs'
import { ScrcpyVideoCodecId, type ScrcpyMediaStreamPacket } from '@yume-chan/scrcpy'
import type { Api, VideoChunk, AudioChunk } from '../../shared/api'
import { MirrorAudio } from './audio'

/**
 * The floating "phone on the desktop" mirror surface. Reads its device serial from g.props, streams
 * H.264 video + Opus audio from the host, decodes with WebCodecs (→ a WebGL canvas / Web Audio), and
 * locks the window to the device aspect ratio once known. Frameless + transparent (per the manifest),
 * so it supplies its own drag region + close button.
 */
function Mirror(): JSX.Element {
  const host = useHost<Api>()
  const g = useGarret()
  const { serial } = useProps<{ serial: string; model?: string }>()
  const screenRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(true)

  useEffect(() => {
    if (!serial) return
    let disposed = false
    const canvas = document.createElement('canvas')
    canvas.className = 'screen'
    screenRef.current?.appendChild(canvas)
    const renderer = new WebGLVideoFrameRenderer(canvas)
    const decoder = new WebCodecsVideoDecoder({ codec: ScrcpyVideoCodecId.H264, renderer })
    const writer = decoder.writable.getWriter()
    decoder.sizeChanged(({ width, height }) => {
      // Rotation / resolution change → new dims → re-lock the window to the device aspect.
      if (disposed) return
      if (width && height) g.window.setAspectRatio(width / height)
    })

    const call = host.mirror({ serial })
    call.onData((chunk: VideoChunk) => {
      if (disposed) return
      if (chunk.kind === 'meta') {
        setConnecting(false)
        if (chunk.width && chunk.height) g.window.setAspectRatio(chunk.width / chunk.height)
        return
      }
      const packet: ScrcpyMediaStreamPacket =
        chunk.kind === 'config'
          ? { type: 'configuration', data: chunk.data }
          : { type: 'data', keyframe: chunk.keyframe, data: chunk.data, pts: BigInt(chunk.timestamp) }
      void writer.write(packet).catch(() => {})
    })
    call.onError((e) => {
      if (!disposed) setError(e instanceof Error ? e.message : String(e))
    })

    // ── audio (best-effort; a device with no audio just ends the stream, and any decode error is
    //    swallowed so the mirror keeps running silently) ────────────────────────────────────────
    const audio = new MirrorAudio()
    const audioCall = host.audio({ serial })
    audioCall.onData((chunk: AudioChunk) => {
      if (disposed) return
      if (chunk.kind === 'config') audio.configure(chunk.data)
      else audio.frame(chunk.data, chunk.timestamp)
    })
    // Autoplay policy: resume the AudioContext on the first interaction with the window.
    const resumeAudio = (): void => audio.resume()
    window.addEventListener('pointerdown', resumeAudio)

    return () => {
      disposed = true
      window.removeEventListener('pointerdown', resumeAudio)
      call.cancel()
      audioCall.cancel()
      audio.close()
      // abort (not close) so any queued/in-flight write is dropped immediately — closing would await
      // the queue and can race decoder.dispose() below.
      void writer.abort().catch(() => {})
      decoder.dispose()
      canvas.remove()
    }
  }, [serial, host, g])

  // The host (SurfaceWindowRoot) draws the draggable titlebar + close; here we just fill with the screen.
  return (
    <div className="screen-wrap" ref={screenRef}>
      {error ? (
        <p className="msg err">{error}</p>
      ) : connecting ? (
        <p className="msg">{serial ? `Connecting to ${serial}…` : 'No device (props missing)'}</p>
      ) : null}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Mirror />)
