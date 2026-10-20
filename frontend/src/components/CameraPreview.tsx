import { useEffect, useRef } from 'react'

/**
 * Renders a live, mirrored preview of a shared camera stream.
 *
 * The stream itself is owned by the app-wide MonitoringProvider, so any number
 * of previews can attach to the same source without opening the camera twice.
 */
export default function CameraPreview({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = ref.current
    if (!video || !stream) return
    video.srcObject = stream
    void video.play().catch(() => undefined)
    return () => {
      try {
        video.srcObject = null
      } catch {
        /* ignore */
      }
    }
  }, [stream])

  return (
    <video
      ref={ref}
      width={320}
      height={240}
      className="transform scale-x-[-1] rounded-lg"
      playsInline
      autoPlay
      muted
    />
  )
}
