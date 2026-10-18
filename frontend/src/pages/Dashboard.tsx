import { useEffect, useState } from 'react';
import { usePostureTracking } from '../hooks/usePostureTracking';
import type { PostureData } from '../hooks/usePostureTracking';

interface InfoCardProps {
  title: string;
  value: string;
  status?: 'good' | 'warning' | 'danger' | 'neutral';
  subtitle?: string;
}

const InfoCard = ({ title, value, status = 'neutral', subtitle }: InfoCardProps) => {
  const statusColors = {
    good: 'text-emerald-600 dark:text-emerald-400',
    warning: 'text-yellow-600 dark:text-yellow-400',
    danger: 'text-red-600 dark:text-red-400',
    neutral: 'text-blue-600 dark:text-blue-400',
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg p-6 shadow-lg border border-gray-200 dark:border-slate-700">
      <h3 className="text-gray-600 dark:text-slate-300 text-sm uppercase tracking-wide mb-2">{title}</h3>
      <p className={`text-3xl font-bold ${statusColors[status]} mb-1`}>{value}</p>
      {subtitle && <p className="text-gray-500 dark:text-slate-400 text-xs">{subtitle}</p>}
    </div>
  );
};

export const Dashboard = () => {
  const [postureData, setPostureData] = useState<PostureData>({
    posture: 'Waiting',
    distance: 'Waiting',
    neckTilt: '0.000',
    timestamp: Date.now(),
  });
  const [ambientLight, setAmbientLight] = useState<number>(500);

  const { videoRef, isReady, cameraError } = usePostureTracking((d) => {
    setPostureData(d);
  });

  useEffect(() => {
    const interval = setInterval(() => {
      setAmbientLight(Math.floor(100 + Math.random() * 900));
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const getPostureStatus = (): 'good' | 'warning' | 'danger' | 'neutral' => {
    if (postureData.posture === 'Upright') return 'good';
    if (postureData.posture === 'Leaning Forward') return 'warning';
    if (postureData.posture === 'Looking Up') return 'warning';
    return 'neutral';
  };

  const getDistanceStatus = (): 'good' | 'warning' | 'danger' | 'neutral' => {
    if (postureData.distance === 'Good') return 'good';
    if (postureData.distance === 'Close') return 'warning';
    if (postureData.distance === 'Too Close') return 'danger';
    return 'neutral';
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-slate-100 p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold mb-8 text-gray-900 dark:text-slate-100">ErgoSense Dashboard</h1>

        {cameraError && (
          <div className="bg-red-50 dark:bg-red-900/50 border border-red-300 dark:border-red-500 rounded-lg p-4 mb-6">
            <p className="text-red-700 dark:text-red-200 font-semibold">Camera Error</p>
            <p className="text-red-600 dark:text-red-300 text-sm mt-1">
              {cameraError.message || 'Unable to access camera. Please check permissions.'}
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <InfoCard
            title="Posture"
            value={postureData.posture}
            status={getPostureStatus()}
            subtitle={`Neck Tilt: ${postureData.neckTilt}`}
          />
          <InfoCard
            title="Screen Distance"
            value={postureData.distance}
            status={getDistanceStatus()}
          />
          <InfoCard
            title="Ambient Light"
            value={`${ambientLight} lx`}
            status="neutral"
            subtitle="Mock data (100-1000 lx)"
          />
          <InfoCard
            title="AI Engine"
            value={isReady ? 'Active' : 'Initializing'}
            status={isReady ? 'good' : 'neutral'}
          />
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-lg p-6 shadow-lg border border-gray-200 dark:border-slate-700">
          <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-slate-100">Live Webcam Feed</h2>
          <div className="relative bg-black rounded-lg overflow-hidden w-fit">
            <video
              ref={videoRef}
              className="transform scale-x-[-1]"
              width={320}
              height={240}
              playsInline
              autoPlay
              muted
            />
            {!isReady && !cameraError && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/70">
                <p className="text-white">Loading camera...</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};