'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from '@/hooks/use-translations';

export default function VideoPlayer({ videoRef, src, onLoad, onEnded, isPlaying, lang, playbackSpeed }) {
  const { t } = useTranslations(lang);
  const [isLoaded, setIsLoaded] = useState(false);
  
  // Set playback rate when component mounts and whenever playbackSpeed changes
  useEffect(() => {
    if (videoRef.current) {
      // Set both default and current playback rate
      videoRef.current.defaultPlaybackRate = playbackSpeed;
      videoRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed]);
  
  useEffect(() => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.play().catch(err => console.error('Failed to play:', err));
        // Re-apply playback rate as some mobile browsers reset it when play() is called
        videoRef.current.playbackRate = playbackSpeed;
      } else {
        videoRef.current.pause();
      }
      
      // Ensure playback rate is set
      videoRef.current.playbackRate = playbackSpeed;
    }
  }, [isPlaying, videoRef, playbackSpeed]);

  const handleLoadedMetadata = () => {
    if (!videoRef.current) return;
    
    const video = videoRef.current;
    setIsLoaded(true);
    
    // Set playback rate after metadata is loaded (important for mobile)
    video.playbackRate = playbackSpeed;
    
    // Just pass the basic metadata
    const metadata = {
      width: video.videoWidth,
      height: video.videoHeight,
      duration: video.duration,
      fps: 30 // We're always using 30fps for output now
    };
    
    // Pass metadata to parent component
    onLoad(metadata);
  };
  
  // Handle rate change (for mobile browsers that might reset playback rate)
  const handleRateChange = () => {
    if (videoRef.current && videoRef.current.playbackRate !== playbackSpeed) {
      videoRef.current.playbackRate = playbackSpeed;
    }
  };

  return (
    <div className="relative rounded overflow-hidden bg-black flex flex-col">
      <div className="flex justify-center">
        <video
          ref={videoRef}
          src={src}
          className="max-w-full max-h-[70vh] object-contain"
          onLoadedMetadata={handleLoadedMetadata}
          onEnded={onEnded}
          onRateChange={handleRateChange}
          onPlay={() => {
            // Some mobile browsers reset playbackRate when play() is called
            if (videoRef.current) {
              videoRef.current.playbackRate = playbackSpeed;
            }
          }}
          playsInline
          crossOrigin="anonymous"
        />
        
        {!isLoaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 text-white">
            {t('video.player.loading')}
          </div>
        )}
      </div>
    </div>
  );
} 