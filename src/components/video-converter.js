'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import VideoUploader from './video-uploader';
import VideoPlayer from './video-player';
import VideoMask from './video-mask';
import ExportProgress from './export-progress';

export default function VideoConverter({ lang }) {
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
  
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const maskRef = useRef(null);
  const animationFrameRef = useRef(null);
  const recordedFramesRef = useRef([]);
  const lastCaptureTimeRef = useRef(0);
  
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
  
  // Export the recorded frames to MP4
  const exportVideo = async () => {
    const frames = recordedFramesRef.current;
    if (!frames.length) return;
    
    try {
      console.log(`Starting export with ${frames.length} frames...`);
      
      // Check if WebCodecs API is available
      if (typeof window !== 'undefined' && !('VideoEncoder' in window)) {
        throw new Error(
          'WebCodecs API is not supported in this browser. ' +
          'Please use a modern browser like Chrome, Edge, or Opera.'
        );
      }
      
      // Get frame dimensions from the first frame
      const firstFrame = frames[0];
      const width = firstFrame.width;
      const height = firstFrame.height;
      
      // Create a temporary canvas for encoding
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      
      // Fixed bitrate of 2Mbps
      const bitrate = 2_000_000;
      const outputFrameRate = 30; // Always use 30 FPS for the output
      
      try {
        // Configure video encoder
        const target = new ArrayBufferTarget();
        const muxer = new Muxer({
          target,
          video: {
            codec: 'avc',
            width,
            height,
            frameRate: outputFrameRate
          },
          fastStart: 'in-memory'
        });
        
        // Initialize encoder with optimized settings
        const videoEncoder = new VideoEncoder({
          output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
          error: (e) => {
            console.error('Encoder error:', e);
            setProcessingError(`Encoding error: ${e.message}`);
          }
        });
        
        await videoEncoder.configure({
          codec: 'avc1.42001f', // H.264 baseline profile
          width,
          height,
          bitrate,
          framerate: outputFrameRate
        });
        
        // Sort frames by timestamp to ensure correct ordering
        frames.sort((a, b) => a.timestamp - b.timestamp);
        
        const totalFrames = frames.length;
        const videoDuration = frames[totalFrames - 1].timestamp; // Last frame timestamp
        
        // Calculate microseconds per frame for 30fps output
        const microSecondsPerFrame = 1000000 / outputFrameRate;
        
        // Process frames with timing adjustment
        // We'll create frames at 30fps intervals but use the closest captured frame
        let outputFrameIndex = 0;
        let lastProcessedInputFrame = -1;
        
        while (outputFrameIndex * microSecondsPerFrame <= videoDuration * 1000) {
          // Calculate the target time for this output frame
          const targetOutputTime = outputFrameIndex * microSecondsPerFrame / 1000; // in ms
          
          // Find the closest input frame to this target time
          let closestFrameIndex = 0;
          let smallestTimeDiff = Number.MAX_VALUE;
          
          for (let i = lastProcessedInputFrame + 1; i < totalFrames; i++) {
            const timeDiff = Math.abs(frames[i].timestamp - targetOutputTime);
            if (timeDiff < smallestTimeDiff) {
              smallestTimeDiff = timeDiff;
              closestFrameIndex = i;
            }
            
            // If we've passed the target time, no need to check further frames
            if (frames[i].timestamp > targetOutputTime) {
              break;
            }
          }
          
          // Update progress periodically
          if (outputFrameIndex % 10 === 0) {
            setExportProgress(Math.round((outputFrameIndex * microSecondsPerFrame / 1000 / videoDuration) * 100));
          }
          
          // Get the closest frame
          const frame = frames[closestFrameIndex];
          
          // If we've already processed this exact input frame and it's not the only frame,
          // we can skip creating a duplicate frame
          if (closestFrameIndex === lastProcessedInputFrame && totalFrames > 1 && outputFrameIndex > 0) {
            outputFrameIndex++;
            continue;
          }
          
          lastProcessedInputFrame = closestFrameIndex;
          
          // Draw to canvas
          if (frame.imageData) {
            ctx.putImageData(frame.imageData, 0, 0);
            
            // Create video frame from canvas with proper timestamp
            const videoFrame = new VideoFrame(canvas, {
              timestamp: Math.round(outputFrameIndex * microSecondsPerFrame),
              duration: microSecondsPerFrame
            });
            
            // Key frame every 30 frames or on first frame
            const keyFrame = outputFrameIndex === 0 || outputFrameIndex % 30 === 0;
            
            try {
              // Encode frame
              await videoEncoder.encode(videoFrame, { keyFrame });
              videoFrame.close();
            } catch (frameError) {
              console.error(`Error encoding frame ${outputFrameIndex}:`, frameError);
              videoFrame.close();
            }
          }
          
          outputFrameIndex++;
          
          // Add a small delay every 10 frames to prevent browser from becoming unresponsive
          if (outputFrameIndex % 10 === 0) {
            await new Promise(resolve => setTimeout(resolve, 10));
          }
        }
        
        // Clear original frame data to free memory
        frames.forEach(frame => {
          frame.imageData = null;
        });
        
        // Finish encoding
        await videoEncoder.flush();
        muxer.finalize();
        
        // Create URL for the encoded video
        const blob = new Blob([target.buffer], { type: 'video/mp4' });
        
        const url = URL.createObjectURL(blob);
        setOutputVideoUrl(url);
        setExportProgress(100);
        
      } catch (encoderError) {
        console.error('Encoder setup/processing error:', encoderError);
        throw new Error(`Video encoding failed: ${encoderError.message}`);
      }
      
    } catch (error) {
      console.error('Export error:', error);
      setExportProgress(0);
      setProcessingError(`Failed to export video: ${error.message}`);
    }
  };
  
  // Set up animation frame for frame capture
  useEffect(() => {
    const captureFrameLoop = () => {
      captureFrame();
      animationFrameRef.current = requestAnimationFrame(captureFrameLoop);
    };
    
    if (isRecording) {
      animationFrameRef.current = requestAnimationFrame(captureFrameLoop);
    } else if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isRecording, captureFrame]);

  return (
    <div className="w-full max-w-4xl mx-auto">
      {!videoFile ? (
        <VideoUploader onUpload={handleVideoUpload} lang={lang} />
      ) : (
        <div className="relative flex flex-col items-center">
          <div className="relative">
            <VideoPlayer
              videoRef={videoRef}
              src={videoUrl}
              onLoad={handleVideoLoad}
              onEnded={handleVideoEnded}
              isPlaying={isPlaying}
              lang={lang}
            />
            
            {videoMetadata.width > 0 && (
              <VideoMask
                key={videoResetKey} 
                maskRef={maskRef}
                videoWidth={videoMetadata.width}
                videoHeight={videoMetadata.height}
                isRecording={isRecording}
              />
            )}
            
            {/* Hidden canvas for capturing frames */}
            <canvas 
              ref={canvasRef} 
              className="hidden"
            />
          </div>
          
          {countdown > 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
              <div className="bg-blue-600 rounded-full w-20 h-20 flex items-center justify-center text-white text-5xl font-bold shadow-lg">
                {countdown}
              </div>
            </div>
          )}
          
          <div className="mt-4 flex flex-col items-center justify-center gap-4 w-full">
            {!isRecording && !outputVideoUrl && !exportProgress && !processingError && (
              <button
                onClick={startRecording}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                disabled={isPlaying}
              >
                {lang?.start_recording || "Start Recording"}
              </button>
            )}
            
            {isRecording && (
              <button
                onClick={handleRestartRecording}
                className="px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700 transition-colors"
              >
                {lang?.restart_recording || "Restart Recording"}
              </button>
            )}
            
            {exportProgress > 0 && !outputVideoUrl && !processingError && (
              <ExportProgress progress={exportProgress} />
            )}
            
            {processingError && (
              <div className="text-red-500 bg-red-100 p-3 rounded w-full text-center">
                <p>{processingError}</p>
                <button
                  onClick={() => {
                    setProcessingError('');
                    setExportProgress(0);
                  }}
                  className="mt-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                >
                  {lang?.try_again || "Try Again"}
                </button>
              </div>
            )}
            
            {outputVideoUrl && (
              <div className="flex flex-col items-center gap-2 w-full">
                <video
                  className="max-h-60 max-w-full border rounded"
                  src={outputVideoUrl}
                  controls
                />
                <a
                  href={outputVideoUrl}
                  download="vertical-video.mp4"
                  className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors text-center"
                >
                  {lang?.download_video || "Download Video"}
                </a>
                <button
                  onClick={() => {
                    setVideoFile(null);
                    setVideoUrl('');
                    setOutputVideoUrl('');
                    setProcessingError('');
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
                  {lang?.convert_another || "Convert Another Video"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
} 