import { useEffect, useRef, useState } from 'react';
import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

export interface PostureData {
  posture: 'Upright' | 'Leaning Forward' | 'Looking Up' | 'Waiting';
  distance: 'Good' | 'Close' | 'Too Close' | 'Too Far' | 'Waiting';
  neckTilt: string;
  timestamp: number;
}

export const usePostureTracking = (onDataUpdate: (data: PostureData) => void) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isReady, setIsReady] = useState(false);
  const [cameraError, setCameraError] = useState<Error | null>(null);
  
  const callbackRef = useRef(onDataUpdate);
  const isVisibleRef = useRef(true);
  const frameCounterRef = useRef(0);
  const lastUpdateTimeRef = useRef(0);
  const lastPostureRef = useRef<'Upright' | 'Leaning Forward' | 'Looking Up' | 'Waiting' | null>(null);
  const lastDistanceRef = useRef<'Good' | 'Close' | 'Too Close' | 'Too Far' | 'Waiting' | null>(null);
  const lastTsRef = useRef(0);
  
  useEffect(() => {
    callbackRef.current = onDataUpdate;
  }, [onDataUpdate]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      isVisibleRef.current = !document.hidden;
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    let animationFrameId: number;
    let poseLandmarker: PoseLandmarker | null = null;
    let stream: MediaStream | null = null;
    let mounted = true;

    const startCamera = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
        );
        
        poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
            delegate: 'GPU'
          },
          runningMode: 'VIDEO',
          numPoses: 1
        });

        stream = await navigator.mediaDevices.getUserMedia({ 
          video: { width: 320, height: 240 } 
        });
        
        if (!mounted) {
          if (stream) stream.getTracks().forEach(track => track.stop());
          return;
        }
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await new Promise<void>(resolve => {
            if (videoRef.current) {
              videoRef.current.onloadedmetadata = () => resolve();
            }
          });
          await videoRef.current.play();
        }

        setIsReady(true);
        setCameraError(null);
        frameCounterRef.current = 0;
        lastUpdateTimeRef.current = 0;
        lastPostureRef.current = null;
        lastDistanceRef.current = null;

        const detect = () => {
          if (!mounted) return;
          
          if (!isVisibleRef.current) {
            animationFrameId = requestAnimationFrame(detect);
            return;
          }
          
          frameCounterRef.current++;
          if (frameCounterRef.current % 3 !== 0) {
            animationFrameId = requestAnimationFrame(detect);
            return;
          }
          
          if (videoRef.current && poseLandmarker && videoRef.current.readyState >= 2) {
            const startTimeMs = performance.now();
            const results = poseLandmarker.detectForVideo(videoRef.current, startTimeMs);
            
            if (results.landmarks && results.landmarks.length > 0 && results.landmarks[0]) {
              const landmarks = results.landmarks[0];
              const nose = landmarks[0];
              const leftShoulder = landmarks[11];
              const rightShoulder = landmarks[12];
              
              if (!nose || !leftShoulder || !rightShoulder) {
                animationFrameId = requestAnimationFrame(detect);
                return;
              }
              
              const confidenceScores = [
                nose.visibility ?? 0,
                leftShoulder.visibility ?? 0,
                rightShoulder.visibility ?? 0
              ];
              const avgConfidence = confidenceScores.reduce((a, b) => a + b, 0) / confidenceScores.length;
              
              if (avgConfidence < 0.7) {
                animationFrameId = requestAnimationFrame(detect);
                return;
              }

              const shoulderWidth = Math.abs(rightShoulder.x - leftShoulder.x);
                const estimatedDistance: 'Good' | 'Close' | 'Too Close' | 'Too Far' =
                  shoulderWidth > 0.85
                    ? 'Too Close'
                    : shoulderWidth >= 0.65
                    ? 'Close'
                    : shoulderWidth >= 0.35
                    ? 'Good'
                    : 'Too Far';
              try { console.debug('[DIST]', { shoulderWidth: shoulderWidth.toFixed(3) }); } catch {}

              const shoulderMidY = (leftShoulder.y + rightShoulder.y) / 2;
              const neckTilt = nose.y - shoulderMidY;
              
              let postureStatus: 'Upright' | 'Leaning Forward' | 'Looking Up';
              const diff = neckTilt;
              if (diff > -0.15 && diff < 0.1) {
                postureStatus = 'Leaning Forward';
              } else if (diff < -0.35) {
                postureStatus = 'Looking Up';
              } else if (diff >= -0.35 && diff <= -0.15) {
                postureStatus = 'Upright';
              } else {
                postureStatus = 'Upright';
              }

              const now = Date.now();
              const hasChanged = postureStatus !== lastPostureRef.current || estimatedDistance !== lastDistanceRef.current;
              if (hasChanged || now - lastUpdateTimeRef.current > 200) {
                lastPostureRef.current = postureStatus;
                lastDistanceRef.current = estimatedDistance;
                lastUpdateTimeRef.current = now;
                const ts = now;
                lastTsRef.current = ts;
                const payload = {
                  posture: postureStatus,
                  distance: estimatedDistance,
                  neckTilt: neckTilt.toFixed(3),
                  timestamp: ts,
                };
                try { console.debug('[DASH]', payload); } catch {}
                callbackRef.current(payload);
              }
            }
          }
          animationFrameId = requestAnimationFrame(detect);
        };
        detect();

      } catch (err) {
        if (!mounted) return;
        console.error('MediaPipe init failed:', err);
        setIsReady(false);
        setCameraError(err as Error);
      }
    };

    startCamera();

    return () => {
      mounted = false;
      cancelAnimationFrame(animationFrameId);
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      if (videoRef.current) {
        try {
          videoRef.current.srcObject = null;
        } catch (e) {
          // ignore
        }
      }
      if (poseLandmarker) {
        try {
          poseLandmarker.close();
        } catch (e) {
          // ignore
        }
        poseLandmarker = null;
      }
    };
  }, []);

  return { videoRef, isReady, cameraError };
};

export interface RawPostureSample {
  neck_angle: number | null;
  shoulder_tilt: number | null;
  head_forward: number | null;
  distance_proxy: number | null;
  movement: number | null;
}

export const useRawPosture = (onSample?: (s: RawPostureSample) => void) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isReady, setIsReady] = useState(false);
  const [cameraError, setCameraError] = useState<Error | null>(null);
  const isVisibleRef = useRef(true);
  const frameCounterRef = useRef(0);
  const cb = useRef(onSample);
  useEffect(() => { cb.current = onSample; }, [onSample]);

  useEffect(() => {
    const onVis = () => { isVisibleRef.current = !document.hidden; };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => {
    let raf: number;
    let landmarker: PoseLandmarker | null = null;
    let stream: MediaStream | null = null;
    let mounted = true;
    const start = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm');
        landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
          outputSegmentationMasks: false,
        });
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
        if (!mounted) { if (stream) stream.getTracks().forEach(t => t.stop()); return; }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.width = 640;
          videoRef.current.height = 480;
          await new Promise<void>(res => { if (videoRef.current) videoRef.current.onloadedmetadata = () => res(); });
          await videoRef.current.play();
        }
        setIsReady(true);
        setCameraError(null);
        frameCounterRef.current = 0;
        const detect = () => {
          if (!mounted || !isVisibleRef.current) { raf = requestAnimationFrame(detect); return; }
          frameCounterRef.current++;
          if (frameCounterRef.current % 2 !== 0) { raf = requestAnimationFrame(detect); return; }
          if (videoRef.current && landmarker && videoRef.current.readyState >= 2) {
            const t = performance.now();
            const res = landmarker.detectForVideo(videoRef.current, t);
            if (res.landmarks && res.landmarks.length > 0 && res.landmarks[0]) {
              const lm = res.landmarks[0];
              const nose = lm[0], lsh = lm[11], rsh = lm[12];
              if (nose && lsh && rsh) {
                const shoulderWidth = Math.abs(rsh.x - lsh.x);
                const shoulderMidY = (lsh.y + rsh.y) / 2;
                const headForward = (nose.y - shoulderMidY);
                const shoulderTilt = Math.abs(lsh.y - rsh.y);
                const movement = 0.01;
                const sample = {
                  neck_angle: Number(headForward.toFixed(4)),
                  shoulder_tilt: Number(shoulderTilt.toFixed(4)),
                  head_forward: Number(headForward.toFixed(4)),
                  distance_proxy: Number(shoulderWidth.toFixed(4)),
                  movement: Number(movement.toFixed(4)),
                };
                cb.current?.(sample);
              }
            }
          }
          raf = requestAnimationFrame(detect);
        };
        detect();
      } catch (e) {
        if (!mounted) return;
        setIsReady(false);
        setCameraError(e as Error);
      }
    };
    start();
    return () => {
      mounted = false;
      cancelAnimationFrame(raf);
      if (stream) stream.getTracks().forEach(t => t.stop());
      if (videoRef.current) { try { videoRef.current.srcObject = null; } catch {} }
      if (landmarker) { try { landmarker.close(); } catch {}; landmarker = null; }
    };
  }, []);
  return { videoRef, isReady, cameraError };
};