'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import VideoUploader from './video-uploader';
import VideoPlayer from './video-player';
import VideoMask from './video-mask';
import ExportProgress from './export-progress';
import { useTranslations } from '@/hooks/use-translations';

export default function VideoConverter({ lang }) {
  const { t } = useTranslations(lang);
  
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
  const [frameRate, setFrameRate] = useState(30);
  const [memoryUsage, setMemoryUsage] = useState(0);
  
  const lastFrameTimeRef = useRef(0);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const maskRef = useRef(null);
  const animationFrameRef = useRef(null);
  const recordedFramesRef = useRef([]);
  const lastCaptureTimeRef = useRef(0);
  const imageDataPoolRef = useRef([]);
  const offscreenCanvasRef = useRef(null);
  
  // New refs for streaming processing
  const frameQueueRef = useRef([]);
  const isProcessingQueueRef = useRef(false);
  const lastProcessedTimeRef = useRef(0);
  const videoEncoderRef = useRef(null);
  const muxerRef = useRef(null);
  const targetRef = useRef(null);
  const encoderInitializedRef = useRef(false);
  const totalFramesProcessedRef = useRef(0);
  const recordingStartTimeRef = useRef(0);
  const isFinalizingRef = useRef(false);
  
  // Constants for video encoding
  const TARGET_WIDTH = 610;
  const TARGET_HEIGHT = 1084;
  const TARGET_BITRATE = 2_000_000; // 2Mbps
  const TARGET_FPS = 30;
  const CHUNK_SIZE = 30; // Process 30 frames at a time
  const QUEUE_THRESHOLD = 60; // Process after accumulating 60 frames (2 seconds at 30fps)
  const INITIAL_THRESHOLD = 10; // Start processing after just 10 frames for smoother start
  const INITIAL_CHUNK_SIZE = 5; // Use smaller chunks for the first processing batch
  
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
          width: TARGET_WIDTH,
          height: TARGET_HEIGHT,
          frameRate: TARGET_FPS
        },
        fastStart: 'in-memory'
      });
      
      // Initialize encoder with basic configuration
      // Simplify config to avoid unsupported options
      const encoderConfig = {
        codec: 'avc1.42001f', // H.264 baseline profile
        width: TARGET_WIDTH,
        height: TARGET_HEIGHT,
        bitrate: TARGET_BITRATE,
        framerate: TARGET_FPS
      };
      
      // Initialize encoder
      videoEncoderRef.current = new VideoEncoder({
        output: (chunk, meta) => {
          try {
            muxerRef.current.addVideoChunk(chunk, meta);
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
          width: TARGET_WIDTH,
          height: TARGET_HEIGHT,
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
    if (!frame || !frame.imageData || !videoEncoderRef.current || !offscreenCanvasRef.current) return;
    
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
        duration: Math.round(1000000 / TARGET_FPS)
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
        // Close the frame even if encoding fails
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
        ? INITIAL_CHUNK_SIZE 
        : CHUNK_SIZE;
      
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
      const framesNeeded = Math.max(1, Math.ceil(timeRangeMs * TARGET_FPS / 1000));
      
      // Process frames with consistent timing and yield between frames to prevent stutter
      for (let i = 0; i < framesNeeded; i++) {
        // Calculate target time relative to batch start
        const targetTime = startTime + (i * 1000 / TARGET_FPS);
        
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
        if (frame && frame.imageData) {
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
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      if (outputVideoUrl) URL.revokeObjectURL(outputVideoUrl);
      
      // Clean up encoder and muxer
      if (videoEncoderRef.current) {
        try {
          videoEncoderRef.current.close();
        } catch (e) {
          console.error('Error closing encoder:', e);
        }
      }
      
      // Clear image data pool
      imageDataPoolRef.current = [];
      frameQueueRef.current = [];
    };
  }, [videoUrl, outputVideoUrl]);
  
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
      frameQueueRef.current = [];
      recordedFramesRef.current = [];
      imageDataPoolRef.current = [];
      
      // Close encoder
      try {
        videoEncoderRef.current.close();
      } catch (e) {
        console.error('Error closing encoder:', e);
      }
      
      // Reset references for future recordings
      videoEncoderRef.current = null;
      muxerRef.current = null;
      targetRef.current = null;
      encoderInitializedRef.current = false;
      lastProcessedTimeRef.current = 0;
      totalFramesProcessedRef.current = 0;
      
      // Trigger garbage collection
      await triggerGC();
      
    } catch (error) {
      console.error('Error finalizing video:', error);
      setProcessingError(t('video.converter.errorProcessing') + ' ' + error.message);
      setExportProgress(0);
    } finally {
      isFinalizingRef.current = false;
    }
  }, [t, triggerGC]);

  // Handle video file upload
  const handleVideoUpload = (file) => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    if (outputVideoUrl) {
      URL.revokeObjectURL(outputVideoUrl);
      setOutputVideoUrl('');
    }
    
    // Close existing encoder if any
    if (videoEncoderRef.current) {
      try {
        videoEncoderRef.current.close();
      } catch (e) {
        console.error('Error closing encoder:', e);
      }
    }
    
    setVideoFile(file);
    setVideoUrl(URL.createObjectURL(file));
    setIsPlaying(false);
    setIsRecording(false);
    setExportProgress(0);
    setProcessingError('');
    setShowVideoInput(true);
    recordedFramesRef.current = [];
    frameQueueRef.current = [];
    lastCaptureTimeRef.current = 0;
    imageDataPoolRef.current = []; // Clear image data pool
    
    // Reset encoder state completely for a new video
    encoderInitializedRef.current = false;
    videoEncoderRef.current = null;
    muxerRef.current = null;
    targetRef.current = null;
    totalFramesProcessedRef.current = 0;
    lastProcessedTimeRef.current = 0;
    
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
  
  // Initialize OffscreenCanvas if available
  useEffect(() => {
    // Create offscreen canvas if supported
    if (typeof OffscreenCanvas !== 'undefined') {
      offscreenCanvasRef.current = new OffscreenCanvas(TARGET_WIDTH, TARGET_HEIGHT);
    } else {
      // Fallback to regular canvas
      const canvas = document.createElement('canvas');
      canvas.width = TARGET_WIDTH;
      canvas.height = TARGET_HEIGHT;
      offscreenCanvasRef.current = canvas;
    }
  }, []);
  
  // Load video metadata when video is loaded
  const handleVideoLoad = (metadata) => {
    setVideoMetadata(metadata);
  };
  
  // Start recording process with countdown
  const startRecording = () => {
    if (!videoRef.current || isRecording) return;
    
    // Reset video to beginning
    videoRef.current.currentTime = 0;
    videoRef.current.pause(); // Pause until countdown finishes
    
    // Reset state
    recordedFramesRef.current = [];
    frameQueueRef.current = [];
    lastCaptureTimeRef.current = 0;
    totalFramesProcessedRef.current = 0;
    lastProcessedTimeRef.current = 0;
    recordingStartTimeRef.current = 0;
    setProcessingError('');
    
    // Pre-initialize encoder before starting countdown to reduce stutter
    // We use a small delay to ensure UI is responsive during initialization
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
  };
  
  // Begin actual recording after countdown
  const beginRecording = () => {
    setIsRecording(true);
    setIsPlaying(true);
    
    // Clear image data pool before starting new recording
    imageDataPoolRef.current = [];
    frameQueueRef.current = [];
    
    // Reset frame processing counters to ensure proper initialization
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
  };
  
  // Restart recording process
  const handleRestartRecording = () => {
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
    
    // Clear frames and state
    recordedFramesRef.current = [];
    frameQueueRef.current = [];
    imageDataPoolRef.current = [];
    lastCaptureTimeRef.current = 0;
    totalFramesProcessedRef.current = 0;
    lastProcessedTimeRef.current = 0;
    
    // Reset processing flags
    isProcessingQueueRef.current = false;
    isFinalizingRef.current = false;
    
    // We need to close and reinitialize encoder and muxer for each recording session
    // to avoid timestamp issues with the muxer
    encoderInitializedRef.current = false;
    if (videoEncoderRef.current) {
      try {
        videoEncoderRef.current.close();
      } catch (e) {
        console.error('Error closing encoder:', e);
      }
    }
    videoEncoderRef.current = null;
    muxerRef.current = null;
    targetRef.current = null;
    
    // Trigger garbage collection
    triggerGC();
    
    // Small delay before starting new countdown
    setTimeout(() => {
      startRecording();
    }, 500);
  };
  
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
      
      // Ensure dimensions match our target resolution with even numbers
      const evenSourceWidth = Math.min(Math.floor(sourceWidth / 2) * 2, TARGET_WIDTH);
      const evenSourceHeight = Math.min(Math.floor(sourceHeight / 2) * 2, TARGET_HEIGHT);
      
      // Set canvas dimensions
      offscreenCanvas.width = TARGET_WIDTH;
      offscreenCanvas.height = TARGET_HEIGHT;
      
      // Draw the current frame to the offscreen canvas
      offscreenCtx.drawImage(
        video,
        sourceX, sourceY, sourceWidth, sourceHeight,
        0, 0, TARGET_WIDTH, TARGET_HEIGHT
      );
      
      // Reuse ImageData from pool or create new one
      let imageData = getImageDataFromPool(TARGET_WIDTH, TARGET_HEIGHT);
      if (!imageData) {
        imageData = offscreenCtx.createImageData(TARGET_WIDTH, TARGET_HEIGHT);
      }
      
      // Get current canvas data
      const canvasData = offscreenCtx.getImageData(0, 0, TARGET_WIDTH, TARGET_HEIGHT);
      
      // Copy canvas data to our reusable ImageData
      imageData.data.set(canvasData.data);
      
      // Add frame to queue instead of large array
      frameQueueRef.current.push({
        imageData,
        timestamp: currentTime,
        width: TARGET_WIDTH,
        height: TARGET_HEIGHT
      });
      
      // Start processing earlier with a smaller number of frames to reduce initial stutter
      // Use INITIAL_THRESHOLD for first batch and QUEUE_THRESHOLD for subsequent batches
      const threshold = totalFramesProcessedRef.current === 0 ? INITIAL_THRESHOLD : QUEUE_THRESHOLD;
      
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
  const handleVideoEnded = async () => {
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
  };
  
  // Set up animation frame for frame capture
  useEffect(() => {
    const captureFrameLoop = () => {
      const now = performance.now();
      const elapsed = now - lastFrameTimeRef.current;
      const frameInterval = 1000 / frameRate;
      
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
      // Use lower playback speed for high bitrate videos to ensure consistent frame capture
      if (videoRef.current) {
        // Store original playback rate to restore later
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
                    
                    // Clear memory
                    recordedFramesRef.current = [];
                    frameQueueRef.current = [];
                    imageDataPoolRef.current = [];
                    
                    // Reset processing flags
                    isProcessingQueueRef.current = false;
                    isFinalizingRef.current = false;
                    
                    // We need to close and reinitialize encoder and muxer for each recording session
                    // to avoid timestamp issues with the muxer
                    encoderInitializedRef.current = false;
                    if (videoEncoderRef.current) {
                      try {
                        videoEncoderRef.current.close();
                      } catch (e) {
                        console.error('Error closing encoder:', e);
                      }
                    }
                    videoEncoderRef.current = null;
                    muxerRef.current = null;
                    targetRef.current = null;
                    totalFramesProcessedRef.current = 0;
                    
                    triggerGC();
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
                      frameQueueRef.current = [];
                      imageDataPoolRef.current = [];
                      lastCaptureTimeRef.current = 0;
                      
                      // Reset processing flags
                      isProcessingQueueRef.current = false;
                      isFinalizingRef.current = false;
                      
                      // We need to close and reinitialize encoder and muxer for each recording session
                      // to avoid timestamp issues with the muxer
                      encoderInitializedRef.current = false;
                      if (videoEncoderRef.current) {
                        try {
                          videoEncoderRef.current.close();
                        } catch (e) {
                          console.error('Error closing encoder:', e);
                        }
                      }
                      videoEncoderRef.current = null;
                      muxerRef.current = null;
                      targetRef.current = null;
                      totalFramesProcessedRef.current = 0;
                      
                      triggerGC();
                      
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
                    
                    // Clear memory
                    recordedFramesRef.current = [];
                    frameQueueRef.current = [];
                    imageDataPoolRef.current = [];
                    
                    // Reset encoder state
                    encoderInitializedRef.current = false;
                    if (videoEncoderRef.current) {
                      try {
                        videoEncoderRef.current.close();
                      } catch (e) {
                        console.error('Error closing encoder:', e);
                      }
                    }
                    videoEncoderRef.current = null;
                    muxerRef.current = null;
                    targetRef.current = null;
                    
                    triggerGC();
                  }}
                  className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
                >
                  {t('video.converter.convertAnotherVideo')}
                </button>
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