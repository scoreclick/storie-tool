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
    fps: 0 // Initialize with 0 instead of 30
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
  
  // Get FPS from video metadata or use a fallback
  const getFps = useCallback(() => {
    // Use detected FPS if available, otherwise fall back to 30fps
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
      fps: 0
    });
  };
  
  // Load video metadata when video is loaded
  const handleVideoLoad = (metadata) => {
    // Attempt to detect actual FPS from the video
    const detectFps = () => {
      if (videoRef.current) {
        // Try to get FPS from the video element if available
        const videoElement = videoRef.current;
        
        // Use requestVideoFrameCallback if available (Chrome 87+)
        if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
          let lastTime = 0;
          let frameCount = 0;
          let measuredFps = 0;
          
          const measureFps = (now, metadata) => {
            frameCount++;
            if (lastTime) {
              if (frameCount >= 10) {
                // Calculate FPS after 10 frames for more accuracy
                const timeDiff = now - lastTime;
                measuredFps = Math.round((frameCount * 1000) / timeDiff);
                
                console.log(`Detected video FPS: ${measuredFps}`);
                
                // Update videoMetadata with detected FPS
                setVideoMetadata(prev => ({
                  ...prev,
                  fps: measuredFps > 10 && measuredFps < 120 ? measuredFps : 30 // Validate the detected FPS
                }));
                
                return; // Stop measuring
              }
            } else {
              lastTime = now;
            }
            
            // Continue measuring
            videoElement.requestVideoFrameCallback(measureFps);
          };
          
          // Start measuring
          videoElement.requestVideoFrameCallback(measureFps);
        } else {
          // Fallback: use estimated 30fps as default for now, we'll try to detect later
          console.log('requestVideoFrameCallback not supported, using estimated FPS');
          
          // Use default browser framerate (typically 30 or 60)
          setVideoMetadata(prev => ({
            ...prev,
            fps: 30
          }));
        }
      }
    };
    
    // Update metadata with sizing info immediately,
    // and attempt to detect FPS separately
    setVideoMetadata({
      ...metadata,
      fps: 0 // Will be updated by detectFps
    });
    
    // Try to detect FPS
    detectFps();
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
    
    // Calculate capture frame rate
    const targetFps = getFps();
    const frameInterval = 1000 / targetFps; // Milliseconds between frames
    const currentTime = video.currentTime * 1000; // Current time in ms
    
    // Check if enough time has passed since last capture
    // If lastCaptureTimeRef.current is 0, this is the first frame
    if (lastCaptureTimeRef.current > 0) {
      const timeSinceLastCapture = currentTime - lastCaptureTimeRef.current;
      
      // Skip this frame if not enough time has passed
      // But don't skip if we're more than 2x frameInterval behind (prevents dropping too many frames)
      if (timeSinceLastCapture < frameInterval && timeSinceLastCapture < frameInterval * 2) {
        return;
      }
    }
    
    // Update last capture time
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
        timestamp: currentTime,
        width: outputWidth,
        height: outputHeight
      });
      
      // Log frame capture at regular intervals for debugging
      if (recordedFramesRef.current.length % 30 === 0) {
        console.log(`Captured ${recordedFramesRef.current.length} frames, current time: ${currentTime}ms`);
      }
    } catch (error) {
      console.error('Error capturing frame:', error);
    }
    
  }, [isRecording, getFps]);
  
  // Handle video ended event
  const handleVideoEnded = async () => {
    setIsPlaying(false);
    setIsRecording(false);
    
    if (recordedFramesRef.current.length > 0) {
      // Start exporting process
      exportVideo();
    }
  };
  
  // Export the recorded frames to MP4 using simpler approach
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
      
      console.log(`Frame dimensions: ${width}x${height}`);
      
      // Create a temporary canvas for encoding
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      
      // Fixed bitrate of 2Mbps
      const bitrate = 2_000_000;
      const frameRate = getFps(); // Use detected FPS instead of fixed 30
      
      console.log(`Using settings: ${frameRate}fps, ${bitrate/1000000}Mbps`);
      
      try {
        // Configure video encoder
        const target = new ArrayBufferTarget();
        const muxer = new Muxer({
          target,
          video: {
            codec: 'avc',
            width,
            height
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
          framerate: frameRate
        });
        
        const totalFrames = frames.length;
        console.log(`Processing ${totalFrames} frames...`);
        
        // Keep track of the last timestamp to ensure monotonically increasing timestamps
        let lastTimestamp = -1;
        
        // Process frames one by one
        for (let i = 0; i < totalFrames; i++) {
          // Update progress
          setExportProgress(Math.round((i + 1) / totalFrames * 100));
          
          // Get frame data
          const frame = frames[i];
          
          // Draw to canvas
          ctx.putImageData(frame.imageData, 0, 0);
          
          // Calculate timestamp that ensures monotonically increasing values
          let timestamp;
          if (i === 0) {
            // First frame always starts at 0
            timestamp = 0;
          } else {
            // Calculate based on frame rate (safe option)
            timestamp = i * (1000000 / frameRate);
            
            // Ensure timestamp is greater than the previous one
            if (timestamp <= lastTimestamp) {
              timestamp = lastTimestamp + (1000000 / frameRate);
            }
          }
          
          // Update the last timestamp
          lastTimestamp = timestamp;
          
          // Log timestamp for debugging
          if (i % 30 === 0) {
            console.log(`Frame ${i} timestamp: ${timestamp}, duration: ${1000000 / frameRate}`);
          }
          
          // Create video frame from canvas
          const videoFrame = new VideoFrame(canvas, {
            timestamp: timestamp,
            duration: 1000000 / frameRate
          });
          
          // Key frame every 30 frames or on first frame
          const keyFrame = i === 0 || i % 30 === 0;
          
          try {
            // Encode frame
            await videoEncoder.encode(videoFrame, { keyFrame });
            videoFrame.close();
          } catch (frameError) {
            console.error(`Error encoding frame ${i}:`, frameError);
            videoFrame.close();
          }
          
          // Clear reference to data
          frames[i].imageData = null;
          
          // Add a small delay every 10 frames to prevent browser from becoming unresponsive
          if (i % 10 === 0 && i > 0) {
            await new Promise(resolve => setTimeout(resolve, 10));
          }
        }
        
        // Finish encoding
        await videoEncoder.flush();
        muxer.finalize();
        
        console.log('Video encoding completed successfully');
        
        // Create URL for the encoded video
        const blob = new Blob([target.buffer], { type: 'video/mp4' });
        console.log(`Output file size: ${(blob.size / (1024 * 1024)).toFixed(2)} MB`);
        
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
      // Use a more consistent approach for frame capture timing
      // Request the first animation frame immediately
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
          
          <div className="mt-4 flex flex-col md:flex-row justify-center gap-4 w-full">
            {!isRecording && !outputVideoUrl && !exportProgress && !processingError && (
              <button
                onClick={startRecording}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                disabled={isPlaying}
              >
                Start Recording
              </button>
            )}
            
            {isRecording && (
              <button
                onClick={handleRestartRecording}
                className="px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700 transition-colors"
              >
                Restart Recording
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
                  Try Again
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
                  Download Video
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
                      fps: 0
                    });
                  }}
                  className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
                >
                  Convert Another Video
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
} 