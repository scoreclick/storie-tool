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
    fps: 0
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
  const frameCountRef = useRef(0);
  const lastTimeRef = useRef(0);
  
  // Get FPS from video metadata or use a fallback
  const getFps = useCallback(() => {
    // Use detected FPS if available, otherwise use a reasonable fallback
    return videoMetadata.fps > 0 ? videoMetadata.fps : 30;
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
    frameCountRef.current = 0;
    lastTimeRef.current = 0;
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
  
  // Calculate FPS from video playback
  const detectFps = useCallback(() => {
    if (!videoRef.current) return;
    
    const now = performance.now();
    const video = videoRef.current;
    
    if (lastTimeRef.current === 0) {
      lastTimeRef.current = now;
      return;
    }
    
    // Increment frame count
    frameCountRef.current++;
    
    // Check if we've been monitoring for at least 500ms
    const elapsed = now - lastTimeRef.current;
    if (elapsed >= 500 && frameCountRef.current > 10) {
      // Calculate FPS
      const detectedFps = Math.round((frameCountRef.current * 1000) / elapsed);
      
      // Ensure FPS is reasonable (between 15 and 60)
      const normalizedFps = Math.max(15, Math.min(detectedFps, 60));
      
      // Update metadata if FPS has changed
      if (normalizedFps !== videoMetadata.fps) {
        setVideoMetadata(prev => ({
          ...prev,
          fps: normalizedFps
        }));
        console.log(`Detected video FPS: ${normalizedFps}`);
      }
      
      // Reset counters
      frameCountRef.current = 0;
      lastTimeRef.current = now;
    }
  }, [videoMetadata.fps]);
  
  // Load video metadata when video is loaded
  const handleVideoLoad = (metadata) => {
    setVideoMetadata({
      ...metadata,
      fps: 0 // Will be detected during playback
    });
  };
  
  // Start recording process with countdown
  const startRecording = () => {
    if (!videoRef.current || isRecording) return;
    
    // Reset video to beginning
    videoRef.current.currentTime = 0;
    recordedFramesRef.current = [];
    lastCaptureTimeRef.current = 0;
    frameCountRef.current = 0;
    lastTimeRef.current = 0;
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
    frameCountRef.current = 0;
    lastTimeRef.current = 0;
    
    // Small delay before starting new countdown
    setTimeout(() => {
      startRecording();
    }, 500);
  };
  
  // Run FPS detection during video playback
  useEffect(() => {
    let fpsDetectionInterval;
    
    if (isPlaying && videoMetadata.fps === 0) {
      // Sample FPS every 100ms during playback
      fpsDetectionInterval = setInterval(detectFps, 100);
    }
    
    return () => {
      if (fpsDetectionInterval) {
        clearInterval(fpsDetectionInterval);
      }
    };
  }, [isPlaying, videoMetadata.fps, detectFps]);
  
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
    const timeSinceLastCapture = currentTime - lastCaptureTimeRef.current;
    if (timeSinceLastCapture < frameInterval) {
      return; // Skip this frame - not enough time has passed
    }
    
    // Update last capture time to maintain consistent intervals
    // Use a multiple of frameInterval to maintain proper timing
    lastCaptureTimeRef.current += frameInterval;
    
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
    
    // Calculate ideal width based on video duration
    let outputWidth = canvas.width;
    let outputHeight = canvas.height;
    
    // Scale down resolution for longer videos to reduce file size
    if (videoMetadata.duration > 120) {
      // For very long videos, reduce to 720p equivalent
      const scale = 720 / outputHeight;
      outputWidth = Math.floor(outputWidth * scale / 2) * 2;
      outputHeight = Math.floor(outputHeight * scale / 2) * 2;
    } else if (videoMetadata.duration > 60) {
      // For long videos, reduce to 900p equivalent
      const scale = 900 / outputHeight;
      outputWidth = Math.floor(outputWidth * scale / 2) * 2;
      outputHeight = Math.floor(outputHeight * scale / 2) * 2;
    }
    
    // Create smaller canvas for scaled output if needed
    let finalCanvas = canvas;
    let finalCtx = ctx;
    
    if (outputWidth !== canvas.width || outputHeight !== canvas.height) {
      // Create a temporary canvas for scaling
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = outputWidth;
      tempCanvas.height = outputHeight;
      const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
      
      // Draw scaled image
      tempCtx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, outputWidth, outputHeight);
      finalCanvas = tempCanvas;
      finalCtx = tempCtx;
    }
    
    // Capture the frame
    recordedFramesRef.current.push({
      imageData: finalCtx.getImageData(0, 0, outputWidth, outputHeight),
      timestamp: currentTime,
      width: outputWidth,
      height: outputHeight
    });
    
  }, [isRecording, videoMetadata.duration, getFps]);
  
  // Handle video ended event
  const handleVideoEnded = async () => {
    setIsPlaying(false);
    setIsRecording(false);
    
    if (recordedFramesRef.current.length > 0) {
      // Start exporting process
      exportVideo();
    }
  };
  
  // Process frames in chunks to avoid memory issues
  const processFramesInChunks = async (frames, videoEncoder, totalFrames, frameRate) => {
    const CHUNK_SIZE = 30; // Process 30 frames at a time
    let processedCount = 0;
    
    try {
      for (let chunkStart = 0; chunkStart < totalFrames; chunkStart += CHUNK_SIZE) {
        const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, totalFrames);
        
        // Process each frame in the current chunk
        for (let i = chunkStart; i < chunkEnd; i++) {
          const frame = frames[i];
          
          // Create a VideoFrame
          const videoFrame = new VideoFrame(
            frame.imageData, 
            {
              timestamp: Math.round(frame.timestamp * 1000), // Convert to microseconds
              duration: Math.round(1000000 / frameRate), // Duration in microseconds
            }
          );
          
          // Determine if this should be a keyframe (every 30 frames or first frame)
          const keyFrame = i === 0 || i % 30 === 0;
          
          // Encode the frame
          await videoEncoder.encode(videoFrame, { keyFrame });
          videoFrame.close();
          
          // Release memory by removing processed frame data
          frames[i].imageData = null;
          
          // Update progress
          processedCount++;
          setExportProgress(Math.round(processedCount / totalFrames * 100));
        }
        
        // Small delay to allow for GC
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    } catch (error) {
      throw error;
    }
  };
  
  // Export the recorded frames to MP4
  const exportVideo = async () => {
    const frames = recordedFramesRef.current;
    if (!frames.length) return;
    
    try {
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
      
      // Get input video's frame rate
      const frameRate = getFps();
      
      // Fixed bitrate of 2Mbps
      const bitrate = 2_000_000;
      
      // Configure video encoder
      const target = new ArrayBufferTarget();
      const muxer = new Muxer({
        target,
        video: {
          codec: 'avc',
          width,
          height
        },
        fastStart: 'in-memory',
        firstTimestampBehavior: 'offset'
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
        framerate: frameRate,
        // Add AVC encoder specific settings
        avc: {
          format: 'annexb',
          profile: 'baseline', // Widest device compatibility
          level: '4.1' // Good balance of quality & compatibility
        }
      });
      
      const totalFrames = frames.length;
      
      console.log(`Encoding video: ${width}x${height} at ${frameRate}fps (matched from input) with ${bitrate/1000000}Mbps`);
      
      // Process frames in chunks to avoid memory issues
      await processFramesInChunks(frames, videoEncoder, totalFrames, frameRate);
      
      // Finish encoding
      await videoEncoder.flush();
      muxer.finalize();
      
      // Create URL for the encoded video
      const blob = new Blob([target.buffer], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);
      
      // Log file size
      console.log(`Output file size: ${(blob.size / (1024 * 1024)).toFixed(2)} MB`);
      
      setOutputVideoUrl(url);
      setExportProgress(100);
      
    } catch (error) {
      console.error('Error exporting video:', error);
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
            <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 text-white text-6xl font-bold z-10">
              {countdown}
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