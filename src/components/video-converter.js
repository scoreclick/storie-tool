'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import VideoUploader from './video-uploader';
import VideoPlayer from './video-player';
import VideoMask from './video-mask';
import ExportProgress from './export-progress';
import { useTranslations } from '@/hooks/use-translations';

// Constants for video encoding
const VIDEO_CONFIG = {
  width: 610,
  height: 1084,
  bitrate: 2_000_000, // 2Mbps
  fps: 30,
  chunkSize: 30, // Process 30 frames at a time
  queueThreshold: 60, // Process after accumulating 60 frames (2 seconds at 30fps)
  initialThreshold: 10, // Start processing after just 10 frames for smoother start
  initialChunkSize: 5, // Use smaller chunks for the first processing batch
};

export default function VideoConverter({ lang }) {
  const { t } = useTranslations(lang);
  
  // State for video handling
  const [videoFile, setVideoFile] = useState(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [videoMetadata, setVideoMetadata] = useState({
    width: 0,
    height: 0,
    duration: 0,
    fps: 30 // Default to 30fps, will be updated when video is loaded
  });
  
  // UI state
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
  const [memoryUsage, setMemoryUsage] = useState(0);
  
  // Refs for DOM elements
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const maskRef = useRef(null);
  const offscreenCanvasRef = useRef(null);
  
  // Refs for frame capturing and processing
  const lastFrameTimeRef = useRef(0);
  const animationFrameRef = useRef(null);
  const lastCaptureTimeRef = useRef(0);
  const recordedFramesRef = useRef([]);
  const imageDataPoolRef = useRef([]);
  const frameQueueRef = useRef([]);
  
  // Refs for video encoding
  const isProcessingQueueRef = useRef(false);
  const lastProcessedTimeRef = useRef(0);
  const videoEncoderRef = useRef(null);
  const muxerRef = useRef(null);
  const targetRef = useRef(null);
  const encoderInitializedRef = useRef(false);
  const totalFramesProcessedRef = useRef(0);
  const recordingStartTimeRef = useRef(0);
  const isFinalizingRef = useRef(false);
  
  // Generate a random filename for the output video
  const generateRandomFileName = useCallback(() => {
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    const randomStr = Math.random().toString(36).substring(2, 10);
    return `vertical-video-${dateStr}-${randomStr}.mp4`;
  }, []);
  
  // Get FPS from video metadata
  const getFps = useCallback(() => {
    return videoMetadata.fps || 30;
  }, [videoMetadata.fps]);
  
  // Helper function to safely close the encoder
  const closeEncoder = useCallback(() => {
    if (videoEncoderRef.current) {
      try {
        videoEncoderRef.current.close();
      } catch (e) {
        console.error('Error closing encoder:', e);
      }
      videoEncoderRef.current = null;
    }
  }, []);
  
  // Helper function to reset encoder state
  const resetEncoderState = useCallback(() => {
    encoderInitializedRef.current = false;
    closeEncoder();
    muxerRef.current = null;
    targetRef.current = null;
    totalFramesProcessedRef.current = 0;
    lastProcessedTimeRef.current = 0;
  }, [closeEncoder]);
  
  // Helper function to reset frame data
  const resetFrameData = useCallback(() => {
    recordedFramesRef.current = [];
    frameQueueRef.current = [];
    imageDataPoolRef.current = [];
    lastCaptureTimeRef.current = 0;
    isProcessingQueueRef.current = false;
    isFinalizingRef.current = false;
  }, []);
  
  // Reset all video processing state
  const resetVideoProcessingState = useCallback(() => {
    resetEncoderState();
    resetFrameData();
    
    // Reset video position if available
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.pause();
    }
    
    // UI state reset
    setProcessingError('');
    setExportProgress(0);
    
    // Force remount of mask
    setVideoResetKey(prevKey => prevKey + 1);
  }, [resetEncoderState, resetFrameData]);
  
  // Helper function to get ImageData from pool
  const getImageDataFromPool = useCallback((width, height) => {
    const pool = imageDataPoolRef.current;
    const index = pool.findIndex(item => 
      item.width === width && item.height === height);
    
    if (index >= 0) {
      return pool.splice(index, 1)[0];
    }
    return null;
  }, []);
  
  // Helper function to return ImageData to pool
  const returnImageDataToPool = useCallback((imageData) => {
    if (!imageData) return;
    
    const pool = imageDataPoolRef.current;
    if (pool.length < 20) { // Limit pool size
      pool.push(imageData);
    }
  }, []);
  
  // Trigger garbage collection (as much as browser allows)
  const triggerGC = useCallback(async () => {
    // Clear references to help garbage collector
    const tempArray = new Array(10000).fill('x');
    tempArray.length = 0;
    
    // Give browser a chance to perform GC
    await new Promise(resolve => setTimeout(resolve, 0));
    
    // Attempt to estimate memory usage (rough approximation)
    if (window.performance && window.performance.memory) {
      setMemoryUsage(Math.round(window.performance.memory.usedJSHeapSize / (1024 * 1024)));
    }
  }, []);
  
  // Initialize video encoder and muxer
  const initializeEncoder = useCallback(async () => {
    if (encoderInitializedRef.current) return;
    
    try {
      // Check if WebCodecs API is available
      if (typeof window !== 'undefined' && !('VideoEncoder' in window)) {
        throw new Error(t('video.converter.browserNotSupported'));
      }
      
      // Create target for muxer
      targetRef.current = new ArrayBufferTarget();
      
      // Configure muxer
      muxerRef.current = new Muxer({
        target: targetRef.current,
        video: {
          codec: 'avc',
          width: VIDEO_CONFIG.width,
          height: VIDEO_CONFIG.height,
          frameRate: VIDEO_CONFIG.fps
        },
        fastStart: 'in-memory'
      });
      
      // Initialize encoder with basic configuration
      const encoderConfig = {
        codec: 'avc1.42001f', // H.264 baseline profile
        width: VIDEO_CONFIG.width,
        height: VIDEO_CONFIG.height,
        bitrate: VIDEO_CONFIG.bitrate,
        framerate: VIDEO_CONFIG.fps
      };
      
      // Initialize encoder
      videoEncoderRef.current = new VideoEncoder({
        output: (chunk, meta) => {
          try {
            muxerRef.current?.addVideoChunk(chunk, meta);
          } catch (e) {
            console.error('Error adding video chunk to muxer:', e);
          }
        },
        error: (e) => {
          console.error('Encoder error:', e);
          setProcessingError(t('video.converter.errorEncoding') + ' ' + e.message);
        }
      });
      
      try {
        await videoEncoderRef.current.configure(encoderConfig);
        encoderInitializedRef.current = true;
        console.log('Encoder initialized');
      } catch (configError) {
        console.error('Encoder configuration error:', configError);
        
        // Attempt with even more basic configuration as fallback
        console.log('Attempting with fallback configuration...');
        await videoEncoderRef.current.configure({
          codec: 'avc1.42001f',
          width: VIDEO_CONFIG.width,
          height: VIDEO_CONFIG.height,
          bitrate: 1_000_000 // Lower bitrate
        });
        
        encoderInitializedRef.current = true;
        console.log('Encoder initialized with fallback configuration');
      }
      
    } catch (error) {
      console.error('Error initializing encoder:', error);
      setProcessingError('Error: ' + (error.message || 'Failed to create encoder. Your browser may not support this feature.'));
      throw error;
    }
  }, [t]);
  
  // Helper to find closest frame by time
  const findClosestFrameByTime = useCallback((frames, targetTime) => {
    if (!frames.length) return null;
    
    let closestFrame = frames[0];
    let smallestDiff = Math.abs(frames[0].timestamp - targetTime);
    
    for (let i = 1; i < frames.length; i++) {
      const diff = Math.abs(frames[i].timestamp - targetTime);
      if (diff < smallestDiff) {
        smallestDiff = diff;
        closestFrame = frames[i];
      }
    }
    
    return closestFrame;
  }, []);
  
  // Process a single frame
  const processFrame = useCallback(async (frame, timestampMicros) => {
    if (!frame?.imageData || !videoEncoderRef.current || !offscreenCanvasRef.current) return;
    
    const canvas = offscreenCanvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    
    if (!ctx) {
      console.error('Could not get 2D context from canvas');
      return;
    }
    
    try {
      // Draw frame to canvas
      ctx.putImageData(frame.imageData, 0, 0);
      
      // Create video frame
      const videoFrame = new VideoFrame(canvas, {
        timestamp: timestampMicros,
        duration: Math.round(1000000 / VIDEO_CONFIG.fps)
      });
      
      // Key frame every 30 frames or on first frame
      const keyFrame = totalFramesProcessedRef.current === 0 || totalFramesProcessedRef.current % 30 === 0;
      
      // Encode frame with timeout protection
      const encodePromise = videoEncoderRef.current.encode(videoFrame, { keyFrame });
      
      // Set a timeout for encoding (5 seconds)
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Frame encoding timed out')), 5000);
      });
      
      // Race between encode and timeout
      await Promise.race([encodePromise, timeoutPromise]).catch(err => {
        console.error('Error during frame encoding:', err);
      }).finally(() => {
        // Always close the video frame to free up resources
        videoFrame.close();
      });
      
      // Increment processed frames counter
      totalFramesProcessedRef.current++;
      
    } catch (error) {
      console.error('Error processing frame:', error);
    }
  }, []);
  
  // Process frames from queue
  const processFrameQueue = useCallback(async () => {
    if (isProcessingQueueRef.current || frameQueueRef.current.length < 1 || isFinalizingRef.current) return;
    
    isProcessingQueueRef.current = true;
    
    try {
      // Initialize encoder if not already done
      if (!encoderInitializedRef.current) {
        await initializeEncoder();
      }
      
      // Use smaller chunk size for first batch to reduce stutter
      const actualChunkSize = totalFramesProcessedRef.current === 0 
        ? VIDEO_CONFIG.initialChunkSize 
        : VIDEO_CONFIG.chunkSize;
      
      // Additional yield before taking frames
      if (totalFramesProcessedRef.current === 0) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      // Take frames to process
      const framesToProcess = frameQueueRef.current.splice(0, actualChunkSize);
      
      if (framesToProcess.length === 0) {
        isProcessingQueueRef.current = false;
        return;
      }
      
      // Sort frames by timestamp
      framesToProcess.sort((a, b) => a.timestamp - b.timestamp);
      
      // Calculate time range for this batch
      const startTime = framesToProcess[0].timestamp;
      const endTime = framesToProcess[framesToProcess.length - 1].timestamp;
      const timeRangeMs = endTime - startTime;
      
      // For first batch, initialize the recording start time
      if (totalFramesProcessedRef.current === 0) {
        recordingStartTimeRef.current = startTime;
        lastProcessedTimeRef.current = startTime;
        
        // Extra yield to main thread before starting processing to prevent UI stutter
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      // Calculate frames needed for this time range
      const framesNeeded = Math.max(1, Math.ceil(timeRangeMs * VIDEO_CONFIG.fps / 1000));
      
      // Process frames with consistent timing and yield between frames to prevent stutter
      for (let i = 0; i < framesNeeded; i++) {
        // Calculate target time relative to batch start
        const targetTime = startTime + (i * 1000 / VIDEO_CONFIG.fps);
        
        // Skip if we've passed the end time
        if (targetTime > endTime) break;
        
        // Find closest frame to target time
        const closestFrame = findClosestFrameByTime(framesToProcess, targetTime);
        
        if (closestFrame) {
          // Calculate global timestamp in microseconds
          // This ensures timestamps always increase monotonically from the recording start
          const elapsedFromStartMs = targetTime - recordingStartTimeRef.current;
          const globalTimestampMicros = Math.round(elapsedFromStartMs * 1000);
          
          // Process frame
          await processFrame(closestFrame, globalTimestampMicros);
          
          // Update last processed time
          lastProcessedTimeRef.current = targetTime;
          
          // Yield to main thread more frequently during the first batch
          if (totalFramesProcessedRef.current < 30 && i % 2 === 0) {
            await new Promise(resolve => setTimeout(resolve, 10));
          }
        }
      }
      
      // Update progress
      if (videoRef.current) {
        const videoDuration = videoRef.current.duration * 1000; // in ms
        const progressPercent = Math.min(100, Math.round((lastProcessedTimeRef.current - recordingStartTimeRef.current) / videoDuration * 100));
        setExportProgress(progressPercent);
      }
      
      // Clean up processed frames
      framesToProcess.forEach(frame => {
        if (frame?.imageData) {
          returnImageDataToPool(frame.imageData);
          frame.imageData = null;
        }
      });
      
      // Trigger garbage collection
      await triggerGC();
      
    } catch (error) {
      console.error('Error processing frame queue:', error);
    } finally {
      isProcessingQueueRef.current = false;
      
      // Check if more frames need processing
      if (frameQueueRef.current.length > 0 && !isFinalizingRef.current) {
        // Use a longer timeout for the first few batches to allow UI to remain responsive
        const timeout = totalFramesProcessedRef.current < 60 ? 10 : 0;
        setTimeout(processFrameQueue, timeout);
      }
    }
  }, [initializeEncoder, findClosestFrameByTime, processFrame, returnImageDataToPool, triggerGC]);
  
  // Clean up URLs when component unmounts
  useEffect(() => {
    return () => {
      // Cleanup URL objects
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      if (outputVideoUrl) URL.revokeObjectURL(outputVideoUrl);
      
      // Clean up encoder and resources
      closeEncoder();
      
      // Clear data structures
      resetFrameData();
    };
  }, [videoUrl, outputVideoUrl, closeEncoder, resetFrameData]);
  
  // Finalize video processing
  const finalizeVideo = useCallback(async () => {
    if (isFinalizingRef.current) return;
    isFinalizingRef.current = true;
    
    try {
      // If encoder isn't initialized, no frames were processed
      if (!encoderInitializedRef.current || !videoEncoderRef.current || !muxerRef.current) {
        setProcessingError(t('video.converter.noFramesCaptured'));
        isFinalizingRef.current = false;
        return;
      }
      
      // Flush encoder and finalize muxer
      await videoEncoderRef.current.flush();
      muxerRef.current.finalize();
      
      // Create blob from buffer
      const blob = new Blob([targetRef.current.buffer], { type: 'video/mp4' });
      
      // Create URL for the encoded video
      const url = URL.createObjectURL(blob);
      setOutputVideoUrl(url);
      setOutputFileName(generateRandomFileName());
      setExportProgress(100);
      setShowVideoInput(false); // Hide the video input when export is complete
      
      console.log(`Video export complete. Processed ${totalFramesProcessedRef.current} frames.`);
      
      // Clean up resources
      resetFrameData();
      resetEncoderState();
      
      // Trigger garbage collection
      await triggerGC();
      
    } catch (error) {
      console.error('Error finalizing video:', error);
      setProcessingError(t('video.converter.errorProcessing') + ' ' + error.message);
      setExportProgress(0);
    } finally {
      isFinalizingRef.current = false;
    }
  }, [t, triggerGC, generateRandomFileName, resetFrameData, resetEncoderState]);

  // Handle video file upload
  const handleVideoUpload = useCallback((file) => {
    // Clean up existing resources
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    if (outputVideoUrl) {
      URL.revokeObjectURL(outputVideoUrl);
      setOutputVideoUrl('');
    }
    
    // Close existing encoder
    resetEncoderState();
    
    // Set up new video
    setVideoFile(file);
    setVideoUrl(URL.createObjectURL(file));
    
    // Reset UI state
    setIsPlaying(false);
    setIsRecording(false);
    setExportProgress(0);
    setProcessingError('');
    setShowVideoInput(true);
    
    // Reset processing state
    resetFrameData();
    
    // Increment key to force re-mount of mask
    setVideoResetKey(prevKey => prevKey + 1);
    
    // Reset video metadata to ensure proper recalculation
    setVideoMetadata({
      width: 0,
      height: 0,
      duration: 0,
      fps: 30 // Will be updated when video is loaded
    });
  }, [videoUrl, outputVideoUrl, resetEncoderState, resetFrameData]);
  
  // Initialize OffscreenCanvas if available
  useEffect(() => {
    // Create offscreen canvas if supported
    if (typeof OffscreenCanvas !== 'undefined') {
      offscreenCanvasRef.current = new OffscreenCanvas(VIDEO_CONFIG.width, VIDEO_CONFIG.height);
    } else {
      // Fallback to regular canvas
      const canvas = document.createElement('canvas');
      canvas.width = VIDEO_CONFIG.width;
      canvas.height = VIDEO_CONFIG.height;
      offscreenCanvasRef.current = canvas;
    }
  }, []);
  
  // Load video metadata when video is loaded
  const handleVideoLoad = useCallback((metadata) => {
    setVideoMetadata(metadata);
  }, []);
  
  // Start recording process with countdown
  const startRecording = useCallback(() => {
    if (!videoRef.current || isRecording) return;
    
    // Reset video to beginning
    videoRef.current.currentTime = 0;
    videoRef.current.pause(); // Pause until countdown finishes
    
    // Reset state
    resetFrameData();
    totalFramesProcessedRef.current = 0;
    lastProcessedTimeRef.current = 0;
    recordingStartTimeRef.current = 0;
    setProcessingError('');
    
    // Pre-initialize encoder before starting countdown to reduce stutter
    const startCountdown = () => {
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
    
    // Initialize encoder first to avoid stutter during recording
    if (!encoderInitializedRef.current) {
      initializeEncoder()
        .then(() => {
          console.log('Encoder pre-initialized successfully');
          startCountdown();
        })
        .catch(err => {
          console.error('Failed to initialize encoder during recording start:', err);
          setProcessingError(t('video.converter.errorProcessing') + ' ' + err.message);
        });
    } else {
      startCountdown();
    }
  }, [isRecording, initializeEncoder, t, resetFrameData]);
  
  // Begin actual recording after countdown
  const beginRecording = useCallback(() => {
    setIsRecording(true);
    setIsPlaying(true);
    
    // Reset state for clean recording
    resetFrameData();
    totalFramesProcessedRef.current = 0;
    lastProcessedTimeRef.current = 0;
    recordingStartTimeRef.current = 0;
    
    // Give a small delay before starting video playback
    // This allows the encoder to be ready before frames start processing
    setTimeout(() => {
      // Start video playback
      if (videoRef.current) {
        // Create a promise to start playback
        const playPromise = videoRef.current.play();
        
        // Handle potential play() rejection (browsers may prevent autoplay)
        if (playPromise !== undefined) {
          playPromise.catch(error => {
            console.error('Video playback failed:', error);
            // Reset recording state if playback fails
            setIsRecording(false);
            setIsPlaying(false);
            setProcessingError('Video playback failed. Please try again or use a different browser.');
          });
        }
      }
    }, 300); // Increased delay to ensure encoder is fully initialized
  }, [resetFrameData]);
  
  // Restart recording process
  const handleRestartRecording = useCallback(() => {
    // Stop current recording
    setIsRecording(false);
    setIsPlaying(false);
    setProcessingError('');
    setExportProgress(0); // Reset export progress
    
    // Reset video to beginning
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.pause();
    }
    
    // Reset all processing state
    resetVideoProcessingState();
    
    // Small delay before starting new countdown
    setTimeout(() => {
      startRecording();
    }, 500);
  }, [resetVideoProcessingState, startRecording]);
  
  // Capture frames during recording
  const captureFrame = useCallback(() => {
    if (!isRecording || !videoRef.current || !maskRef.current || !offscreenCanvasRef.current) return;
    
    const video = videoRef.current;
    const mask = maskRef.current;
    const offscreenCanvas = offscreenCanvasRef.current;
    const offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
    
    // Get the current video time in milliseconds
    const currentTime = video.currentTime * 1000;
    
    // Skip duplicate frames based on timestamp
    if (lastCaptureTimeRef.current === currentTime) return;
    
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
      
      // Set canvas dimensions
      offscreenCanvas.width = VIDEO_CONFIG.width;
      offscreenCanvas.height = VIDEO_CONFIG.height;
      
      // Draw the current frame to the offscreen canvas
      offscreenCtx.drawImage(
        video,
        sourceX, sourceY, sourceWidth, sourceHeight,
        0, 0, VIDEO_CONFIG.width, VIDEO_CONFIG.height
      );
      
      // Reuse ImageData from pool or create new one
      let imageData = getImageDataFromPool(VIDEO_CONFIG.width, VIDEO_CONFIG.height);
      if (!imageData) {
        imageData = offscreenCtx.createImageData(VIDEO_CONFIG.width, VIDEO_CONFIG.height);
      }
      
      // Get current canvas data
      const canvasData = offscreenCtx.getImageData(0, 0, VIDEO_CONFIG.width, VIDEO_CONFIG.height);
      
      // Copy canvas data to our reusable ImageData
      imageData.data.set(canvasData.data);
      
      // Add frame to queue
      frameQueueRef.current.push({
        imageData,
        timestamp: currentTime,
        width: VIDEO_CONFIG.width,
        height: VIDEO_CONFIG.height
      });
      
      // Start processing at appropriate threshold
      const threshold = totalFramesProcessedRef.current === 0 
        ? VIDEO_CONFIG.initialThreshold 
        : VIDEO_CONFIG.queueThreshold;
      
      // Process frames when queue reaches threshold
      if (frameQueueRef.current.length >= threshold && !isProcessingQueueRef.current) {
        processFrameQueue();
      }
      
      // Periodically update memory usage
      if (frameQueueRef.current.length % 30 === 0) {
        triggerGC();
      }
      
    } catch (error) {
      console.error('Error capturing frame:', error);
    }
  }, [isRecording, getImageDataFromPool, processFrameQueue, triggerGC]);
  
  // Handle video ended event
  const handleVideoEnded = useCallback(async () => {
    setIsPlaying(false);
    setIsRecording(false);
    
    console.log(`Video ended. Frames in queue: ${frameQueueRef.current.length}`);
    
    // Process any remaining frames in the queue
    if (frameQueueRef.current.length > 0) {
      // Process remaining frames
      const checkQueue = setInterval(() => {
        if (frameQueueRef.current.length === 0 && !isProcessingQueueRef.current) {
          clearInterval(checkQueue);
          finalizeVideo();
        } else if (frameQueueRef.current.length > 0 && !isProcessingQueueRef.current) {
          processFrameQueue();
        }
      }, 100);
    } else {
      // If no frames to process, just finalize the video
      await finalizeVideo();
    }
  }, [finalizeVideo, processFrameQueue]);
  
  // Set up animation frame for frame capture
  useEffect(() => {
    const captureFrameLoop = () => {
      const now = performance.now();
      const elapsed = now - lastFrameTimeRef.current;
      const frameInterval = 1000 / VIDEO_CONFIG.fps;
      
      if (elapsed >= frameInterval) {
        lastFrameTimeRef.current = now - (elapsed % frameInterval);
        
        // Skip frame capture in the first 200ms to let playback stabilize
        const videoCurrentTime = videoRef.current?.currentTime || 0;
        if (videoCurrentTime > 0.2) {
          captureFrame();
        }
      }
      
      animationFrameRef.current = requestAnimationFrame(captureFrameLoop);
    };
    
    if (isRecording) {
      // Set playback speed
      if (videoRef.current) {
        videoRef.current.playbackRate = playbackSpeed;
      }
      
      // Start the capture loop
      lastFrameTimeRef.current = performance.now();
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
  }, [isRecording, captureFrame, playbackSpeed]);

  // Reset processing state and try again button handler
  const handleTryAgain = useCallback(() => {
    setProcessingError('');
    setExportProgress(0);
    resetVideoProcessingState();
  }, [resetVideoProcessingState]);
  
  // Record again button handler
  const handleRecordAgain = useCallback(() => {
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
    
    // Reset all processing state
    resetVideoProcessingState();
    
    // Reset video position
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.pause();
    }
  }, [videoFile, videoUrl, outputVideoUrl, resetVideoProcessingState]);
  
  // Convert another video button handler
  const handleConvertAnotherVideo = useCallback(() => {
    // Clean up URLs
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    if (outputVideoUrl) URL.revokeObjectURL(outputVideoUrl);
    
    // Reset state
    setVideoFile(null);
    setVideoUrl('');
    setOutputVideoUrl('');
    setProcessingError('');
    setShowVideoInput(true);
    
    // Reset mask state by incrementing key
    setVideoResetKey(prevKey => prevKey + 1);
    
    // Reset video metadata
    setVideoMetadata({
      width: 0,
      height: 0,
      duration: 0,
      fps: 30
    });
    
    // Reset processing state
    resetVideoProcessingState();
  }, [videoUrl, outputVideoUrl, resetVideoProcessingState]);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {!videoFile ? (
        <VideoUploader onUpload={handleVideoUpload} lang={lang} />
      ) : (
        <div className="relative flex flex-col items-center">
          {/* Back/New Video button always visible after video upload */}
          <div className="self-start mb-4">
            <button
              onClick={handleConvertAnotherVideo}
              className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors text-sm"
            >
              ← {t('video.converter.convertAnotherVideo')}
            </button>
          </div>
          
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
                  onClick={handleTryAgain}
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
                    onClick={handleRecordAgain}
                    className="px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700 transition-colors"
                  >
                    {t('video.converter.recordAgain')}
                  </button>
                </div>
              </div>
            )}
            
            {/* Memory usage indicator (only shown during debug) */}
            {process.env.NODE_ENV === 'development' && (
              <div className="text-xs text-gray-500 mt-2">
                Memory: ~{memoryUsage} MB | Queue: {frameQueueRef.current.length} | Processed: {totalFramesProcessedRef.current}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
} 