'use client';

import { useEffect, useState } from 'react';

export default function VideoPlayer({ videoRef, src, onLoad, onEnded, isPlaying, lang }) {
  const [isLoaded, setIsLoaded] = useState(false);
  
  useEffect(() => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.play().catch(err => console.error('Failed to play:', err));
      } else {
        videoRef.current.pause();
      }
    }
  }, [isPlaying, videoRef]);

  const handleLoadedMetadata = () => {
    if (!videoRef.current) return;
    
    const video = videoRef.current;
    setIsLoaded(true);
    
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

  return (
    <div className="relative rounded overflow-hidden bg-black flex justify-center">
      <video
        ref={videoRef}
        src={src}
        className="max-w-full max-h-[70vh] object-contain"
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={onEnded}
        playsInline
      />
      
      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 text-white">
          {lang?.loading_video || "Loading video..."}
        </div>
      )}
    </div>
  );
} 