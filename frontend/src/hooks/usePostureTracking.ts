import { useEffect, useRef, useState } from 'react';
import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

export interface PostureData {
  posture: 'Upright' | 'Leaning Forward' | 'Looking Up' | 'Waiting';
  distance: 'Good' | 'Close' | 'Too Close' | 'Waiting';
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
  const lastDistanceRef = useRef<'Good' | 'Close' | 'Too Close' | 'Waiting' | null>(null);
  
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
              const estimatedDistance = shoulderWidth < 0.2 ? 'Too Close' : shoulderWidth < 0.3 ? 'Close' : 'Good';

              const shoulderMidY = (leftShoulder.y + rightShoulder.y) / 2;
              const neckTilt = nose.y - shoulderMidY;
              
              let postureStatus: 'Upright' | 'Leaning Forward' | 'Looking Up';
              if (nose.y > shoulderMidY + 0.1) {
                postureStatus = 'Leaning Forward';
              } else if (nose.y < shoulderMidY - 0.05) {
                postureStatus = 'Looking Up';
              } else {
                postureStatus = 'Upright';
              }

              const now = Date.now();
              const hasChanged = postureStatus !== lastPostureRef.current || estimatedDistance !== lastDistanceRef.current;
              const shouldThrottle = now - lastUpdateTimeRef.current < 250 && !hasChanged;
              
              if (!shouldThrottle) {
                lastPostureRef.current = postureStatus;
                lastDistanceRef.current = estimatedDistance;
                lastUpdateTimeRef.current = now;
                callbackRef.current({
                  posture: postureStatus,
                  distance: estimatedDistance,
                  neckTilt: neckTilt.toFixed(3),
                  timestamp: now,
                });
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