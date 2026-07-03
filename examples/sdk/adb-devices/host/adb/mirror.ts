import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Adb, type AdbServerClient } from '@yume-chan/adb'
import { AdbScrcpyClient, AdbScrcpyOptions2_3 } from '@yume-chan/adb-scrcpy'
import { DefaultServerPath, type ScrcpyControlMessageWriter, type ScrcpyMediaStreamPacket } from '@yume-chan/scrcpy'
import { ReadableStream } from '@yume-chan/stream-extra'
import type { VideoChunk, AudioChunk, MirrorConfig } from '../../shared/api'

// The scrcpy server (a ~66KB .jar) runs ON the device via app_process. It VERIFIES the version arg it's
// launched with equals its own — so the vendored jar and this string must match exactly.
const SCRCPY_VERSION = '2.3.1'

/** The bundled scrcpy-server jar, copied next to the built host (dist/host/) by build.mjs. */
async function serverJarStream(): Promise<ReadableStream<Uint8Array>> {
  const bytes = await readFile(join(__dirname, 'scrcpy-server.jar'))
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes))
      controller.close()
    }
  })
}

const toVideoChunk = (p: ScrcpyMediaStreamPacket): VideoChunk =>
  p.type === 'configuration'
    ? { kind: 'config', data: p.data }
    : { kind: 'frame', data: p.data, keyframe: p.keyframe ?? false, timestamp: Number(p.pts ?? 0) }

const toAudioChunk = (p: ScrcpyMediaStreamPacket): AudioChunk =>
  p.type === 'configuration'
    ? { kind: 'config', data: p.data }
    : { kind: 'frame', data: p.data, timestamp: Number(p.pts ?? 0) }

/** One live scrcpy session for a device: parsed video + (optional) audio packet streams + control. */
export interface MirrorSession {
  meta: { width: number; height: number; videoCodec: string; audioCodec: string | null }
  video: ReadableStream<ScrcpyMediaStreamPacket>
  audio: ReadableStream<ScrcpyMediaStreamPacket> | null
  controller: ScrcpyControlMessageWriter | undefined
  close(): Promise<void>
}

/**
 * Push the scrcpy server to the device and start a session: H.264 video + Opus audio (Android 11+)
 * + a control channel. `serverClient.createTransport` gives a device-level `Adb`; the session lives
 * until `close()` (which stops the on-device server + closes the adb connection).
 */
export async function openMirror(
  serverClient: AdbServerClient,
  serial: string,
  cfg: MirrorConfig
): Promise<MirrorSession> {
  const adb = new Adb(await serverClient.createTransport({ serial }))
  await AdbScrcpyClient.pushServer(adb, await serverJarStream())

  const options = new AdbScrcpyOptions2_3(
    {
      video: true,
      audio: true,
      control: true,
      videoCodec: 'h264',
      audioCodec: 'opus',
      videoBitRate: cfg.videoBitRate ?? 8_000_000,
      maxFps: cfg.maxFps ?? 60,
      maxSize: cfg.maxSize ?? 0
    },
    { version: SCRCPY_VERSION }
  )

  const client = await AdbScrcpyClient.start(adb, DefaultServerPath, options)
  const videoStream = await client.videoStream
  if (!videoStream) throw new Error('scrcpy started without a video stream')

  let audio: ReadableStream<ScrcpyMediaStreamPacket> | null = null
  const audioMeta = await client.audioStream // undefined on <2.0; disabled/errored otherwise
  if (audioMeta && audioMeta.type === 'success') audio = audioMeta.stream

  // We request h264 + opus explicitly, so the codecs are known (avoids mapping ya-webadb's codec enums).
  return {
    meta: { width: videoStream.width, height: videoStream.height, videoCodec: 'h264', audioCodec: audio ? 'opus' : null },
    video: videoStream.stream,
    audio,
    controller: client.controller,
    close: async () => {
      await client.close()
      await adb.close()
    }
  }
}

export { toVideoChunk, toAudioChunk }
