'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import VideoUploader from './video-uploader';
import VideoPlayer from './video-player';
import VideoMask from './video-mask';
import ExportProgress from './export-progress';
import { useTranslations } from '@/hooks/use-translations';
import { useVideoEncoderWorker } from '@/hooks/use-video-encoder-worker';

export default function VideoConverter({ lang }) {
  const { t } = useTranslations(lang);
  const { encodeVideo, isProcessing, progress: encodingProgress, error: encodingError } = useVideoEncoderWorker();
  
  const [videoFile, setVideoFile] = useState(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [videoMetadata, setVideoMetadata] = useState({
    width: 0,
    height: 0,
    duration: 0,
    fps: 30 // Default to 30fps, will be updated when video is loaded
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [exportProgress, setExportProgress] = useState(0);
  const [outputVideoUrl, setOutputVideoUrl] = useState('');
  const [videoResetKey, setVideoResetKey] = useState(0);
  const [processingError, setProcessingError] = useState('');
  const [showVideoInput, setShowVideoInput] = useState(true);
  const [outputFileName, setOutputFileName] = useState('');
  const [playbackSpeed, setPlaybackSpeed] = useState(0.5);
  const [frameRate, setFrameRate] = useState(15); // Default to 15fps
  const lastFrameTimeRef = useRef(0);
  
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const maskRef = useRef(null);
  const animationFrameRef = useRef(null);
  const recordedFramesRef = useRef([]);
  const lastCaptureTimeRef = useRef(0);
  const frameBufferSizeRef = useRef(5); // Fixed buffer size
  
  // Generate a random filename for the output video
  const generateRandomFileName = () => {
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    const randomStr = Math.random().toString(36).substring(2, 10);
    return `vertical-video-${dateStr}-${randomStr}.mp4`;
  };
  
  // Get FPS from video metadata
  const getFps = useCallback(() => {
    // Return the detected fps or fallback to 30fps
    return videoMetadata.fps || 30;
  }, [videoMetadata.fps]);
  
  // Clean up URLs when component unmounts
  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      if (outputVideoUrl) URL.revokeObjectURL(outputVideoUrl);
    };
  }, [videoUrl, outputVideoUrl]);

  // Update exportProgress when encodingProgress changes
  useEffect(() => {
    if (isProcessing) {
      setExportProgress(encodingProgress);
    }
  }, [encodingProgress, isProcessing]);

  // Handle encoding errors
  useEffect(() => {
    if (encodingError) {
      setProcessingError(encodingError);
      setExportProgress(0);
    }
  }, [encodingError]);

  // Handle video file upload
  const handleVideoUpload = (file) => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    if (outputVideoUrl) {
      URL.revokeObjectURL(outputVideoUrl);
      setOutputVideoUrl('');
    }
    
    setVideoFile(file);
    setVideoUrl(URL.createObjectURL(file));
    setIsPlaying(false);
    setIsRecording(false);
    setExportProgress(0);
    setProcessingError('');
    setShowVideoInput(true);
    recordedFramesRef.current = [];
    lastCaptureTimeRef.current = 0;
    // Increment key to force re-mount of mask
    setVideoResetKey(prevKey => prevKey + 1);
    // Reset video metadata to ensure proper recalculation
    setVideoMetadata({
      width: 0,
      height: 0,
      duration: 0,
      fps: 30 // Will be updated when video is loaded
    });
  };
  
  // Load video metadata when video is loaded
  const handleVideoLoad = (metadata) => {
    setVideoMetadata(metadata);
  };
  
  // Start recording process with countdown
  const startRecording = () => {
    if (!videoRef.current || isRecording) return;
    
    // Reset video to beginning
    videoRef.current.currentTime = 0;
    recordedFramesRef.current = [];
    lastCaptureTimeRef.current = 0;
    setProcessingError('');
    
    // Start countdown
    setCountdown(3);
    
    const countdownInterval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownInterval);
          beginRecording();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };
  
  // Begin actual recording after countdown
  const beginRecording = () => {
    setIsRecording(true);
    setIsPlaying(true);
    
    // Start video playback
    if (videoRef.current) {
      videoRef.current.play();
    }
  };
  
  // Restart recording process
  const handleRestartRecording = () => {
    // Stop current recording
    setIsRecording(false);
    setIsPlaying(false);
    setProcessingError('');
    
    // Reset video to beginning
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.pause();
    }
    
    // Clear recorded frames
    recordedFramesRef.current = [];
    lastCaptureTimeRef.current = 0;
    
    // Small delay before starting new countdown
    setTimeout(() => {
      startRecording();
    }, 500);
  };
  
  // Capture frames during recording
  const captureFrame = useCallback(() => {
    if (!isRecording || !videoRef.current || !canvasRef.current || !maskRef.current) return;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const mask = maskRef.current;
    
    // Get the current video time in milliseconds
    const currentTime = video.currentTime * 1000;
    
    // Skip duplicate frames based on timestamp
    if (lastCaptureTimeRef.current === currentTime) {
      return;
    }
    
    lastCaptureTimeRef.current = currentTime;
    
    try {
      // Get mask position and dimensions
      const maskRect = mask.getBoundingClientRect();
      const videoRect = video.getBoundingClientRect();
      
      // Calculate relative position of mask over video
      const relX = (maskRect.left - videoRect.left) / videoRect.width;
      const relY = (maskRect.top - videoRect.top) / videoRect.height;
      const relWidth = maskRect.width / videoRect.width;
      const relHeight = maskRect.height / videoRect.height;
      
      // Calculate source and destination coordinates for drawing
      const sourceX = relX * video.videoWidth;
      const sourceY = relY * video.videoHeight;
      const sourceWidth = relWidth * video.videoWidth;
      const sourceHeight = relHeight * video.videoHeight;
      
      // Ensure dimensions are even numbers (required by H.264 encoding)
      // Floor to even number
      const evenSourceWidth = Math.floor(sourceWidth / 2) * 2;
      const evenSourceHeight = Math.floor(sourceHeight / 2) * 2;
      
      // Set canvas dimensions for 9:16 aspect ratio with even numbers
      canvas.width = evenSourceWidth;
      canvas.height = evenSourceHeight;
      
      // Draw the current frame to the canvas
      ctx.drawImage(
        video,
        sourceX, sourceY, sourceWidth, sourceHeight,
        0, 0, canvas.width, canvas.height
      );
      
      // Keep original resolution - scaling is now handled in the export process
      const outputWidth = canvas.width;
      const outputHeight = canvas.height;
      
      // Capture the frame
      const imageData = ctx.getImageData(0, 0, outputWidth, outputHeight);
      
      recordedFramesRef.current.push({
        imageData,
        timestamp: currentTime, // Store exact video timestamp
        width: outputWidth,
        height: outputHeight
      });
    } catch (error) {
      console.error('Error capturing frame:', error);
    }
    
  }, [isRecording]);
  
  // Handle video ended event
  const handleVideoEnded = async () => {
    setIsPlaying(false);
    setIsRecording(false);
    
    if (recordedFramesRef.current.length > 0) {
      // Start exporting process
      exportVideo();
    }
  };
  
  // Export the recorded frames to MP4 using the worker
  const exportVideo = async () => {
    const frames = recordedFramesRef.current;
    if (!frames.length) return;
    
    try {
      console.log(`Starting export with ${frames.length} frames...`);
      
      // Check if WebCodecs API is available
      if (typeof window !== 'undefined' && !('VideoEncoder' in window)) {
        throw new Error(t('video.converter.browserNotSupported'));
      }
      
      // Get frame dimensions from the first frame
      const firstFrame = frames[0];
      const width = firstFrame.width;
      const height = firstFrame.height;
      
      try {
        // Use the worker to encode the video
        const blob = await encodeVideo(frames, {
          width,
          height,
          duration: frames[frames.length - 1].timestamp,
          outputFrameRate: 30
        });
        
        if (blob) {
          // Create URL for the encoded video
          const url = URL.createObjectURL(blob);
          setOutputVideoUrl(url);
          setOutputFileName(generateRandomFileName());
          setExportProgress(100);
          setShowVideoInput(false); // Hide the video input when export is complete
        }
        
        // Clear original frame data to free memory
        frames.forEach(frame => {
          frame.imageData = null;
        });
        
      } catch (encoderError) {
        console.error('Encoder setup/processing error:', encoderError);
        throw new Error(t('video.converter.errorProcessing') + ' ' + encoderError.message);
      }
      
    } catch (error) {
      console.error('Error exporting video:', error);
      setProcessingError(t('video.converter.errorProcessing') + ' ' + error.message);
      setExportProgress(0);
    }
  };
  
  // Set up animation frame for frame capture
  useEffect(() => {
    const captureFrameLoop = () => {
      const now = performance.now();
      const elapsed = now - lastFrameTimeRef.current;
      const frameInterval = 1000 / frameRate;
      
      if (elapsed >= frameInterval) {
        lastFrameTimeRef.current = now - (elapsed % frameInterval);
        captureFrame();
      }
      
      animationFrameRef.current = requestAnimationFrame(captureFrameLoop);
    };
    
    if (isRecording) {
      // Use lower playback speed for high bitrate videos to ensure consistent frame capture
      if (videoRef.current) {
        // Store original playback rate to restore later
        videoRef.current.playbackRate = playbackSpeed;
      }
      
      // Start the capture loop
      animationFrameRef.current = requestAnimationFrame(captureFrameLoop);
    } else if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      
      // Restore original playback rate when not recording
      if (videoRef.current) {
        videoRef.current.playbackRate = 1.0;
      }
    }
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isRecording, frameRate, captureFrame, playbackSpeed]);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {!videoFile ? (
        <VideoUploader onUpload={handleVideoUpload} lang={lang} />
      ) : (
        <div className="relative flex flex-col items-center">
          {showVideoInput && (
            <>
              {/* Video and mask container */}
              <div className="relative">
                <VideoPlayer
                  ref={videoRef}
                  src={videoUrl}
                  onLoad={handleVideoLoad}
                  onEnded={handleVideoEnded}
                  isPlaying={isPlaying}
                  lang={lang}
                  playbackSpeed={playbackSpeed}
                />
                
                {videoMetadata.width > 0 && (
                  <VideoMask
                    key={videoResetKey} 
                    maskRef={maskRef}
                    videoWidth={videoMetadata.width}
                    videoHeight={videoMetadata.height}
                    isRecording={isRecording}
                    lang={lang}
                  />
                )}
                
                {/* Hidden canvas for capturing frames */}
                <canvas 
                  ref={canvasRef} 
                  className="absolute top-0 left-0 pointer-events-none opacity-0"
                />
              </div>
            </>
          )}
          
          {countdown > 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
              <div className="bg-blue-600 rounded-full w-20 h-20 flex items-center justify-center text-white text-5xl font-bold shadow-lg">
                {countdown}
              </div>
            </div>
          )}
          
          <div className="mt-4 flex flex-col items-center justify-center gap-4 w-full">
            {!isRecording && !outputVideoUrl && !exportProgress && !processingError && (
              <div className="flex flex-col sm:flex-row items-center gap-4">
                <button
                  onClick={startRecording}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                  disabled={isPlaying}
                >
                  {t('video.converter.startRecording')}
                </button>
                
                <div className="flex flex-col sm:flex-row items-center gap-4">
                  {/* Playback speed control */}
                  {videoMetadata.width > 0 && (
                    <div className="flex items-center">
                      <label htmlFor="playback-speed" className="mr-2 text-sm font-medium">
                        {t('video.player.speed')}:
                      </label>
                      <select
                        id="playback-speed"
                        value={playbackSpeed}
                        onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
                        className="bg-white border border-gray-300 rounded px-2 py-1 text-sm"
                        disabled={isRecording}
                      >
                        <option value="0.25">0.25x</option>
                        <option value="0.5">0.5x</option>
                        <option value="0.75">0.75x</option>
                        <option value="1">1.0x</option>
                      </select>
                    </div>
                  )}
                </div>
              </div>
            )}
            
            {isRecording && (
              <button
                onClick={handleRestartRecording}
                className="px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700 transition-colors"
              >
                {t('video.converter.restartRecording')}
              </button>
            )}
            
            {exportProgress > 0 && !outputVideoUrl && !processingError && (
              <ExportProgress progress={exportProgress} lang={lang} />
            )}
            
            {processingError && (
              <div className="text-red-500 bg-red-100 p-3 rounded w-full text-center">
                <p>{processingError}</p>
                <button
                  onClick={() => {
                    setProcessingError('');
                    setExportProgress(0);
                    // Reset mask position by forcing a remount
                    setVideoResetKey(prevKey => prevKey + 1);
                  }}
                  className="mt-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                >
                  {t('video.converter.tryAgain')}
                </button>
              </div>
            )}
            
            {outputVideoUrl && (
              <div className="flex flex-col items-center gap-2 w-full">
                <video
                  className="max-h-96 max-w-full border rounded"
                  src={outputVideoUrl}
                  controls
                  autoPlay
                  playsInline
                />
                <div className="flex flex-row gap-2 w-full justify-center">
                  <a
                    href={outputVideoUrl}
                    download={outputFileName}
                    className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors text-center"
                  >
                    {t('video.converter.downloadVideo')}
                  </a>
                  
                  <button
                    onClick={() => {
                      if (videoFile) {
                        // Revoke existing URLs
                        if (videoUrl) URL.revokeObjectURL(videoUrl);
                        if (outputVideoUrl) URL.revokeObjectURL(outputVideoUrl);
                        
                        // Create a fresh URL from the same file to reset security context
                        setVideoUrl(URL.createObjectURL(videoFile));
                      }
                      
                      // Reset state
                      setOutputVideoUrl('');
                      setProcessingError('');
                      setExportProgress(0);
                      setShowVideoInput(true); // Show the video input again
                      recordedFramesRef.current = [];
                      lastCaptureTimeRef.current = 0;
                      
                      // Reset video position
                      if (videoRef.current) {
                        videoRef.current.currentTime = 0;
                        videoRef.current.pause();
                      }
                      
                      // Reset mask position by forcing a remount
                      setVideoResetKey(prevKey => prevKey + 1);
                      
                      // Give a small delay before allowing recording to start
                      // This ensures the video element has time to properly reset
                      setTimeout(() => {
                        // Ready for recording again
                      }, 100);
                    }}
                    className="px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700 transition-colors"
                  >
                    {t('video.converter.recordAgain')}
                  </button>
                </div>
                
                <button
                  onClick={() => {
                    setVideoFile(null);
                    setVideoUrl('');
                    setOutputVideoUrl('');
                    setProcessingError('');
                    setShowVideoInput(true); // Show the video input for the next upload
                    // Reset mask state by incrementing key
                    setVideoResetKey(prevKey => prevKey + 1);
                    // Reset video metadata
                    setVideoMetadata({
                      width: 0,
                      height: 0,
                      duration: 0,
                      fps: 30
                    });
                  }}
                  className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
                >
                  {t('video.converter.convertAnotherVideo')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
} 