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

/** What went wrong, so the UI can say something the user can act on. */
export type CameraErrorKind = 'camera' | 'model' | 'unknown';

export interface PostureCamera {
  /** The single shared MediaStream (null until the camera starts). */
  stream: MediaStream | null;
  /** True once MediaPipe + the camera are running. */
  ready: boolean;
  /** Set when the camera or the pose model could not start. */
  error: Error | null;
  /** Which half failed: the webcam itself, or the pose model download. */
  errorKind: CameraErrorKind | null;
  /** The newest raw features, or null before the first frame. */
  latest: RawPostureSample | null;
  /** The newest ambient-lux estimate from the frame, or null. */
  lux: number | null;
  /** Try again after a failure (e.g. the user just allowed the camera). */
  retry: () => void;
}

/**
 * Where the MediaPipe runtime lives.
 *
 * The assets are served by *this app* (frontend/public/mediapipe) so posture
 * tracking never depends on a third-party CDN: it works offline, behind a
 * corporate firewall and with content blockers on. The public CDN is kept as a
 * fallback for installs where the local copy is missing.
 */
const LOCAL_MANIFEST = '/mediapipe/manifest.json';
const CDN_WASM_DIR = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';
const CDN_MODEL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

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

/**
 * Find the locally served MediaPipe runtime.
 *
 * A small JSON manifest describes where the files are. Vite's dev server
 * answers unknown paths with the SPA shell (HTTP 200 and `text/html`), so the
 * content type is what tells the manifest apart from a missing file.
 *
 * Returns null when the local copy is not installed - the caller then falls
 * back to the public CDN.
 */
async function localAssetSet(): Promise<AssetSet | null> {
  try {
    const res = await fetch(LOCAL_MANIFEST, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || '';
    if (!type.includes('json')) return null;
    const manifest = (await res.json()) as { wasmDir?: string; modelPath?: string };
    if (!manifest.wasmDir || !manifest.modelPath) return null;
    return { wasmDir: manifest.wasmDir, modelPath: manifest.modelPath, label: 'local' };
  } catch {
    return null;
  }
}

interface AssetSet {
  wasmDir: string;
  modelPath: string;
  label: string;
}

/**
 * Build the pose landmarker, preferring the locally served runtime and falling
 * back to the public CDN. Each attempt is independent: if the local copy is
 * missing or broken we still get a working model from the CDN.
 */
async function createPoseLandmarker(): Promise<PoseLandmarker> {
  const sets: AssetSet[] = [];
  const local = await localAssetSet();
  if (local) {
    sets.push(local);
  }
  sets.push({ wasmDir: CDN_WASM_DIR, modelPath: CDN_MODEL, label: 'cdn' });

  let lastError: unknown = null;
  for (const set of sets) {
    try {
      const vision = await FilesetResolver.forVisionTasks(set.wasmDir);
      return await PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: set.modelPath, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numPoses: 1,
        outputSegmentationMasks: false,
      });
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError ?? new Error('The pose model could not be loaded.');
}

/**
 * Turn a low-level failure into something the user can act on.
 *
 * The webcam and the pose model fail for completely different reasons
 * (permission vs. download), so they must not be reported with the same
 * generic "camera error".
 */
function describeFailure(e: unknown): { kind: CameraErrorKind; error: Error } {
  const name = (e as { name?: string } | null)?.name ?? '';
  const raw = (e as Error | null)?.message ?? String(e);

  switch (name) {
    case 'NotAllowedError':
      return {
        kind: 'camera',
        error: new Error(
          'Camera access was blocked. Allow the camera for this site (the camera icon in the address bar), then press Retry.',
        ),
      };
    case 'SecurityError':
      return {
        kind: 'camera',
        error: new Error(
          'The browser only allows camera access on a secure page. Open the app on http://localhost:5173 and press Retry.',
        ),
      };
    case 'NotFoundError':
    case 'OverconstrainedError':
      return { kind: 'camera', error: new Error('No camera was found on this device.') };
    case 'NotReadableError':
      return {
        kind: 'camera',
        error: new Error(
          'The camera is busy in another app (Zoom / Teams / Meet). Close it and press Retry.',
        ),
      };
    case 'AbortError':
      return { kind: 'camera', error: new Error('The camera could not be started. Press Retry.') };
    default:
      break;
  }

  if (/fetch|network|model|modulefactory|wasm|import/i.test(raw)) {
    return {
      kind: 'model',
      error: new Error(
        `The posture model could not be downloaded (${raw}). Check your internet connection and press Retry.`,
      ),
    };
  }
  return { kind: 'unknown', error: e instanceof Error ? e : new Error(raw) };
}

/**
 * The app-wide posture + ambient-light camera.
 *
 * It lives *outside* React on purpose. The webcam is a single shared device:
 * opening it twice makes the second attempt fail with "camera is busy", and
 * React's StrictMode mounts every component twice in development, which would
 * open the camera, close it and open it again. Keeping the lifecycle here means
 * the camera is opened exactly once and stays open while it is wanted.
 */
class PostureCameraController {
  private listeners = new Set<() => void>();
  private state: PostureCamera = {
    stream: null,
    ready: false,
    error: null,
    errorKind: null,
    latest: null,
    lux: null,
    retry: () => {
      if (this.wanted) void this.start();
    },
  };

  private landmarker: PoseLandmarker | null = null;
  private media: MediaStream | null = null;
  private hidden: HTMLVideoElement | null = null;
  private raf = 0;
  /** Bumped on every (re)start so a late-finishing attempt can abort itself. */
  private generation = 0;
  private starting = false;
  private wanted = false;
  private frame = 0;
  private lastLux = 0;
  private visible = !document.hidden;

  private readonly canvas = document.createElement('canvas');

  constructor() {
    this.canvas.width = 32;
    this.canvas.height = 24;
    document.addEventListener('visibilitychange', () => {
      this.visible = !document.hidden;
    });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    // Deliver the current state straight away so a late subscriber is never
    // left with a stale snapshot.
    listener();
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): PostureCamera => this.state;

  private emit(patch: Partial<PostureCamera>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  /** Called by the React hook when somebody wants the camera. */
  acquire(): void {
    this.wanted = true;
    if (!this.state.ready && !this.starting) void this.start();
  }

  /** Called by the React hook when nobody needs the camera any more. */
  release(): void {
    this.wanted = false;
    // A start that is still in flight cleans itself up once it notices that
    // nobody wants the camera any more - tearing down now would only make it
    // fight the next acquire().
    if (this.starting) return;
    this.teardown();
  }

  /** Re-run a failed start. */
  private start = async (): Promise<void> => {
    if (this.starting) return;
    this.starting = true;
    const generation = ++this.generation;

    // A start that finished after a newer start (or a teardown) is stale.
    const alive = () => generation === this.generation;

    try {
      // 1. The camera first: a permission problem should be reported in a
      //    second, not after a 5 MB model download.
      const media = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
      if (!alive()) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      this.media = media;

      // 2. Then the pose model.
      const landmarker = await createPoseLandmarker();
      if (!alive()) {
        try { landmarker.close(); } catch { /* ignore */ }
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      this.landmarker = landmarker;

      // 3. Own a hidden <video> so we never depend on a page rendering one.
      const hidden = document.createElement('video');
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
      this.hidden = hidden;

      await new Promise<void>((res) => {
        if (hidden.readyState >= 1) {
          res();
          return;
        }
        hidden.onloadedmetadata = () => res();
      });
      await hidden.play();
      if (!alive()) {
        // A newer start (or a teardown) happened while the video was starting.
        // Clean up, otherwise the camera light stays on for nothing.
        try { landmarker.close(); } catch { /* ignore */ }
        media.getTracks().forEach((t) => t.stop());
        hidden.remove();
        if (this.hidden === hidden) this.hidden = null;
        if (hiddenVideo === hidden) hiddenVideo = null;
        return;
      }

      // Nobody wants the camera any more (e.g. the user left the page while
      // the model was downloading) - close it again instead of lighting up the
      // webcam for nothing.
      if (!this.wanted) {
        this.stopEverything();
        return;
      }

      this.emit({ stream: media, ready: true, error: null, errorKind: null });
      this.detect();
    } catch (e) {
      // Never leave the camera light on after a failure.
      this.stopEverything();
      if (!alive() || !this.wanted) return;
      const { kind, error } = describeFailure(e);
      this.emit({ ready: false, error, errorKind: kind });
    } finally {
      this.starting = false;
    }
  };

  /** The frame loop: ambient light + the five posture features. */
  private detect = (): void => {
    const hidden = this.hidden;
    const landmarker = this.landmarker;
    if (!hidden || !landmarker) return;

    // Keep running while hidden *if* an always-on-top PiP window is open
    // (that window keeps requestAnimationFrame alive), so monitoring does
    // not pause when the user switches to another app.
    if ((!this.visible && !pipActive) || hidden.readyState < 2) {
      this.raf = requestAnimationFrame(this.detect);
      return;
    }
    this.frame++;
    if (this.frame % 2 !== 0) {
      this.raf = requestAnimationFrame(this.detect);
      return;
    }

    // --- ambient light (phone-style light sensor) ---
    try {
      const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(hidden, 0, 0, this.canvas.width, this.canvas.height);
        const { data } = ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        let sum = 0;
        for (let i = 0; i < data.length; i += 4) {
          sum += (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
        }
        const value = luminanceToLux(sum / (data.length / 4));
        if (Math.abs(value - this.lastLux) >= 10) {
          this.lastLux = value;
          this.emit({ lux: value });
        }
      }
    } catch {
      /* never break tracking over a light read */
    }

    try {
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
          const prev = this.state.latest;
          const movement = prev
            ? (Math.abs(neckAngle - (prev.neck_angle ?? neckAngle)) +
                Math.abs(distanceProxy - (prev.distance_proxy ?? distanceProxy))) /
              2
            : 0;
          this.emit({ latest: { ...base, movement: Number(movement.toFixed(4)) } });
        }
      }
    } catch {
      /* a bad frame must not stop the loop */
    }
    this.raf = requestAnimationFrame(this.detect);
  };

  private stopMedia(): void {
    if (this.hidden) {
      try {
        this.hidden.pause();
        this.hidden.srcObject = null;
        this.hidden.remove();
      } catch {
        /* ignore */
      }
      if (hiddenVideo === this.hidden) hiddenVideo = null;
      this.hidden = null;
    }
    if (this.media) {
      this.media.getTracks().forEach((t) => t.stop());
      this.media = null;
    }
  }

  /** Stop the camera, the model and the frame loop (no generation bump). */
  private stopEverything(): void {
    cancelAnimationFrame(this.raf);
    this.stopMedia();
    if (this.landmarker) {
      try {
        this.landmarker.close();
      } catch {
        /* ignore */
      }
      this.landmarker = null;
    }
    this.emit({ stream: null, ready: false, latest: null, lux: null, error: null, errorKind: null });
  }

  /** Stop everything and invalidate any start that is still in flight. */
  private teardown(): void {
    this.generation += 1;
    this.stopEverything();
  }
}

const controller = new PostureCameraController();

/**
 * React view of the shared camera.
 *
 * `enabled` says whether anybody wants the camera right now. The camera itself
 * is owned by the module-level controller, so React remounts (and StrictMode's
 * double mount) never reopen it.
 */
export function usePostureCamera(enabled: boolean): PostureCamera {
  const [snapshot, setSnapshot] = useState<PostureCamera>(() => controller.getSnapshot());

  useEffect(
    () => controller.subscribe(() => setSnapshot(controller.getSnapshot())),
    [],
  );

  useEffect(() => {
    if (enabled) {
      controller.acquire();
    } else {
      controller.release();
    }
  }, [enabled]);

  return snapshot;
}
