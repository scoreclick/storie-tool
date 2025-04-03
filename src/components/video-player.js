'use client';

import { useEffect, useState, forwardRef, useImperativeHandle } from 'react';
import { useTranslations } from '@/hooks/use-translations';

const VideoPlayer = forwardRef(function VideoPlayer({ src, onLoad, onEnded, isPlaying, lang, playbackSpeed = 1.0 }, ref) {
  const { t } = useTranslations(lang);
  const [isLoaded, setIsLoaded] = useState(false);
  const [internalPlaybackSpeed, setInternalPlaybackSpeed] = useState(playbackSpeed);
  
  // Set playback rate when component mounts and whenever playbackSpeed changes
  useEffect(() => {
    setInternalPlaybackSpeed(playbackSpeed || 1.0);
    
    if (ref && ref.current) {
      // Set both default and current playback rate
      ref.current.defaultPlaybackRate = playbackSpeed || 1.0;
      ref.current.playbackRate = playbackSpeed || 1.0;
    }
  }, [playbackSpeed, ref]);
  
  useEffect(() => {
    if (ref && ref.current) {
      if (isPlaying) {
        ref.current.play().catch(err => console.error('Failed to play:', err));
        // Re-apply playback rate as some mobile browsers reset it when play() is called
        ref.current.playbackRate = internalPlaybackSpeed;
      } else {
        ref.current.pause();
      }
      
      // Ensure playback rate is set
      ref.current.playbackRate = internalPlaybackSpeed;
    }
  }, [isPlaying, ref, internalPlaybackSpeed]);

  const handleLoadedMetadata = () => {
    if (!ref || !ref.current) return;
    
    const video = ref.current;
    setIsLoaded(true);
    
    // Set playback rate after metadata is loaded (important for mobile)
    video.playbackRate = internalPlaybackSpeed;
    
    // Just pass the basic metadata
    const metadata = {
      width: video.videoWidth,
      height: video.videoHeight,
      duration: video.duration,
      fps: 30 // We're always using 30fps for output now
    };
    
    // Pass metadata to parent component
    if (onLoad) onLoad(metadata);
  };
  
  // Handle rate change (for mobile browsers that might reset playback rate)
  const handleRateChange = () => {
    if (ref && ref.current && ref.current.playbackRate !== internalPlaybackSpeed) {
      ref.current.playbackRate = internalPlaybackSpeed;
    }
  };

  return (
    <div className="relative rounded overflow-hidden bg-black flex flex-col">
      <div className="flex justify-center">
        <video
          ref={ref}
          src={src}
          className="max-w-full max-h-[70vh] object-contain"
          onLoadedMetadata={handleLoadedMetadata}
          onEnded={onEnded}
          onRateChange={handleRateChange}
          onPlay={() => {
            // Some mobile browsers reset playbackRate when play() is called
            if (ref && ref.current) {
              ref.current.playbackRate = internalPlaybackSpeed;
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
});

export default VideoPlayer; 