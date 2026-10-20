import { useEffect, useState } from 'react';
import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

/**
 * The five posture features the engine understands. All are produced in the
 * browser from MediaPipe Pose landmarks and posted to the backend, which does
 * the personal-baseline z-scoring, drift detection and fusion.
 *
 * Conventions (important — the backend assumes these):
 *  - neck_angle: image-y gap between nose and the shoulders. An upright sit has
 *    the nose above the shoulders (negative); leaning forward reduces the gap
 *    and pushes it toward/past zero. "More = worse".
 *  - head_forward: how far the nose sits in front of the shoulders in depth.
 *    Larger = head poking forward.
 *  - shoulder_tilt: absolute difference in shoulder height (uneven shoulders).
 *  - distance_proxy: grows as you sit closer to the screen.
 *  - movement: average frame-to-frame change of the features (fidgeting).
 */
export interface RawPostureSample {
  neck_angle: number | null;
  shoulder_tilt: number | null;
  head_forward: number | null;
  distance_proxy: number | null;
  movement: number | null;
}

/**
 * Turn an average frame luminance (0..1) into a rough ambient-lux estimate.
 *
 * Like a phone's ambient-light sensor: a dark room reads only a few lux while a
 * bright window can be thousands. We remap luminance on a curve so the number
 * lands inside the same comfort band the ESP32/BH1750 would report.
 * A dark frame (~0) -> ~10 lx, a mid frame (~0.5) -> ~420 lx, bright (~1) -> ~2000 lx.
 */
export function luminanceToLux(luma: number): number {
  const clamped = Math.max(0.0, Math.min(1.0, luma));
  return Math.round(10 + 1990 * Math.pow(clamped, 2.2));
}

export interface PostureCamera {
  /** The single shared MediaStream (null until the camera starts). */
  stream: MediaStream | null;
  /** True once MediaPipe + the camera are running. */
  ready: boolean;
  /** Set when the camera or model could not start. */
  error: Error | null;
  /** The newest raw features, or null before the first frame. */
  latest: RawPostureSample | null;
  /** The newest ambient-lux estimate from the frame, or null. */
  lux: number | null;
}

/**
 * Whether an always-on-top Document Picture-in-Picture window is open.
 *
 * A PiP window is a *visible* surface, so the browser keeps running
 * requestAnimationFrame while the main tab is hidden. When that is the case we
 * must keep detecting frames even though `document.hidden` is true — otherwise
 * monitoring would pause the moment the user switches to another app.
 */
let pipActive = false;

export function setPipActive(on: boolean): void {
  pipActive = on;
}

export function isPipActive(): boolean {
  return pipActive;
}

/**
 * The hidden `<video>` that feeds MediaPipe, kept at module scope so an
 * always-on-top Picture-in-Picture window can adopt it. Moving the video into a
 * *visible* window stops the browser from throttling playback when the main tab
 * is hidden — otherwise posture detection freezes in the background.
 */
let hiddenVideo: HTMLVideoElement | null = null;

/** Move the detection video into the PiP document (or back to the page). */
export function attachDetectionVideo(container: HTMLElement | null): void {
  if (!hiddenVideo) return
  try {
    if (container) {
      container.appendChild(hiddenVideo)
    } else if (hiddenVideo.parentNode && hiddenVideo.parentNode !== document.body) {
      document.body.appendChild(hiddenVideo)
    }
  } catch {
    /* never break tracking over a DOM move */
  }
}

const VISION_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';
const POSE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

/**
 * The app-wide posture + ambient-light camera.
 *
 * Real mode runs this once for the whole app (the MonitoringProvider owns it),
 * so there is a single MediaStream shared by every page preview. It emits the
 * newest raw posture features and a phone-style ambient-lux estimate on each
 * analysed frame. Everything degrades quietly: a camera or model failure only
 * sets `error` and never throws.
 */
export function usePostureCamera(enabled: boolean): PostureCamera {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [latest, setLatest] = useState<RawPostureSample | null>(null);
  const [lux, setLux] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      setReady(false);
      return;
    }
    let raf = 0;
    let landmarker: PoseLandmarker | null = null;
    let media: MediaStream | null = null;
    let hidden: HTMLVideoElement | null = null;
    let mounted = true;
    let visible = !document.hidden;
    let frame = 0;
    let lastLux = 0;
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 24;

    const onVis = () => {
      visible = !document.hidden;
    };
    document.addEventListener('visibilitychange', onVis);

    const start = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(VISION_WASM);
        landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: POSE_MODEL, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numPoses: 1,
          outputSegmentationMasks: false,
        });
        media = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
        if (!mounted) {
          media.getTracks().forEach((t) => t.stop());
          return;
        }

        // Own hidden <video> so we never depend on a page rendering one.
        hidden = document.createElement('video');
        hidden.playsInline = true;
        hidden.muted = true;
        hidden.style.position = 'fixed';
        hidden.style.width = '1px';
        hidden.style.height = '1px';
        hidden.style.opacity = '0';
        hidden.style.pointerEvents = 'none';
        hidden.style.left = '-9999px';
        hidden.srcObject = media;
        document.body.appendChild(hidden);
        hiddenVideo = hidden;
        await new Promise<void>((res) => {
          if (!hidden) {
            res();
            return;
          }
          if (hidden.readyState >= 1) {
            res();
            return;
          }
          hidden.onloadedmetadata = () => res();
        });
        await hidden.play();

        setStream(media);
        setReady(true);
        setError(null);

        const detect = () => {
          if (!mounted) return;
          // Keep running while hidden *if* an always-on-top PiP window is open
          // (that window keeps requestAnimationFrame alive), so monitoring does
          // not pause when the user switches to another app.
          if ((!visible && !pipActive) || !hidden || !landmarker || hidden.readyState < 2) {
            raf = requestAnimationFrame(detect);
            return;
          }
          frame++;
          if (frame % 2 !== 0) {
            raf = requestAnimationFrame(detect);
            return;
          }

          // --- ambient light (phone-style light sensor) ---
          try {
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(hidden, 0, 0, canvas.width, canvas.height);
              const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
              let sum = 0;
              for (let i = 0; i < data.length; i += 4) {
                sum += (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
              }
              const value = luminanceToLux(sum / (data.length / 4));
              if (Math.abs(value - lastLux) >= 10) {
                lastLux = value;
                setLux(value);
              }
            }
          } catch {
            /* never break tracking over a light read */
          }

          const res = landmarker.detectForVideo(hidden, performance.now());
          if (res.landmarks && res.landmarks.length > 0 && res.landmarks[0]) {
            const lm = res.landmarks[0];
            const nose = lm[0];
            const lsh = lm[11];
            const rsh = lm[12];
            if (nose && lsh && rsh) {
              const shoulderWidth = Math.max(1e-4, Math.abs(rsh.x - lsh.x));
              const shoulderMidY = (lsh.y + rsh.y) / 2;
              const shoulderMidZ = ((lsh.z ?? 0) + (rsh.z ?? 0)) / 2;
              const shoulderTilt = Math.abs(lsh.y - rsh.y);
              const neckAngle = nose.y - shoulderMidY;
              const headForward = shoulderMidZ - (nose.z ?? 0);
              const widthTerm = shoulderWidth * 2.0;
              const depthTerm = Math.max(0, 0.5 - shoulderMidZ) * 0.6;
              const distanceProxy = widthTerm + depthTerm;
              const base = {
                neck_angle: Number(neckAngle.toFixed(4)),
                shoulder_tilt: Number(shoulderTilt.toFixed(4)),
                head_forward: Number(headForward.toFixed(4)),
                distance_proxy: Number(distanceProxy.toFixed(4)),
              };
              setLatest((prev) => {
                const movement = prev
                  ? (Math.abs(neckAngle - (prev.neck_angle ?? neckAngle)) +
                      Math.abs(distanceProxy - (prev.distance_proxy ?? distanceProxy))) /
                    2
                  : 0;
                return { ...base, movement: Number(movement.toFixed(4)) };
              });
            }
          }
          raf = requestAnimationFrame(detect);
        };
        detect();
      } catch (e) {
        if (!mounted) return;
        setError(e as Error);
        setReady(false);
      }
    };
    void start();

    return () => {
      mounted = false;
      document.removeEventListener('visibilitychange', onVis);
      cancelAnimationFrame(raf);
      if (hidden) {
        try {
          hidden.pause();
          hidden.srcObject = null;
          hidden.remove();
        } catch {
          /* ignore */
        }
      }
      if (hiddenVideo === hidden) hiddenVideo = null;
      if (media) media.getTracks().forEach((t) => t.stop());
      if (landmarker) {
        try {
          landmarker.close();
        } catch {
          /* ignore */
        }
      }
      setStream(null);
      setReady(false);
    };
  }, [enabled]);

  return { stream, ready, error, latest, lux };
}
