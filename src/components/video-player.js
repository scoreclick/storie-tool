'use client';

import { useEffect, useState } from 'react';

export default function VideoPlayer({ videoRef, src, onLoad, onEnded, isPlaying }) {
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

  // Add specific iOS detection and handling
  useEffect(() => {
    // iOS-specific fullscreen prevention
    if (videoRef.current) {
      // For iOS, ensure playsInline is set programmatically as well
      videoRef.current.playsInline = true;
      // Using setAttribute for non-standard attributes
      videoRef.current.setAttribute('webkit-playsinline', 'true');
      videoRef.current.setAttribute('x5-playsinline', 'true');
      
      // Prevent default touchstart behavior on iOS
      const preventIOSFullscreen = (e) => {
        // Only preventDefault for iOS to avoid interfering with other browser behaviors
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        if (isIOS) {
          e.preventDefault();
        }
      };
      
      videoRef.current.addEventListener('touchstart', preventIOSFullscreen);
      
      return () => {
        if (videoRef.current) {
          videoRef.current.removeEventListener('touchstart', preventIOSFullscreen);
        }
      };
    }
  }, [videoRef]);

  const handleLoadedMetadata = () => {
    if (!videoRef.current) return;
    
    const video = videoRef.current;
    setIsLoaded(true);
    
    onLoad({
      width: video.videoWidth,
      height: video.videoHeight,
      duration: video.duration
    });
  };

  return (
    <div className="relative rounded overflow-hidden bg-black flex justify-center">
      <video
        ref={videoRef}
        src={src}
        className="max-w-full max-h-[70vh] object-contain"
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={onEnded}
        playsInline={true}
        // Non-standard attributes must be set via useEffect
        disablePictureInPicture={true}
        disableRemotePlayback={true}
        controls={false}
        controlsList="nodownload nofullscreen noremoteplayback"
        style={{
          // Force iOS to respect playsinline attribute
          objectFit: 'contain',
          width: '100%',
          height: 'auto'
        }}
      />
      
      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 text-white">
          Loading video...
        </div>
      )}
    </div>
  );
} 