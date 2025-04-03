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
  const [frameRate, setFrameRate] = useState(15); // Default to 15fps
  const [workerStatus, setWorkerStatus] = useState({ frameCount: 0 });
  const [memoryUsage, setMemoryUsage] = useState(null);
  const lastFrameTimeRef = useRef(0);
  
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const maskRef = useRef(null);
  const animationFrameRef = useRef(null);
  const workerRef = useRef(null);
  const memoryMonitorRef = useRef(null);
  
  // Streaming implementation
  const recordedFramesRef = useRef([]);
  const frameChunksRef = useRef([]); // Store chunks of processed frames
  const processingStateRef = useRef({
    isProcessing: false,
    processedChunks: 0,
    targetFPS: 30,
    lastCaptureTime: 0,
    frameBufferSize: 30, // Process frames in chunks of 30
    encoder: null,
    muxer: null,
    target: null,
    canvas: null,
    ctx: null,
    outputWidth: 0,
    outputHeight: 0,
    keyFrameInterval: 30
  });
  
  // Initialize web worker
  useEffect(() => {
    // Only initialize in browser environment
    if (typeof window === 'undefined') return;
    
    // Clean up existing worker
    if (workerRef.current) {
      workerRef.current.terminate();
    }
    
    // Create worker with dynamic import for Next.js compatibility
    const initWorker = async () => {
      try {
        // Dynamic import of the worker module
        const workerModule = await import('../workers/frame-processor.js');
        
        // Create a worker URL from the module
        const workerBlob = new Blob([workerModule.default], { type: 'text/javascript' });
        const workerUrl = URL.createObjectURL(workerBlob);
        const worker = new Worker(workerUrl);
        
        // Store the worker reference
        workerRef.current = worker;
        
        // Set up message handler
        worker.onmessage = (event) => {
          const { type, data } = event.data;
          
          switch (type) {
            case 'FRAMES_PROCESSED':
              // Add processed frames to chunks
              frameChunksRef.current.push({
                frames: data.frames,
                processed: true
              });
              
              // Update UI with frame status
              setWorkerStatus(prev => ({
                ...prev,
                frameCount: (prev.frameCount || 0) + data.frames.length,
                remaining: data.remaining
              }));
              break;
              
            case 'CACHE_UPDATE':
              // Update UI with cache size
              setWorkerStatus(prev => ({
                ...prev,
                cacheSize: data.cacheSize
              }));
              break;
              
            case 'ERROR':
              console.error('Worker error:', data.message);
              setProcessingError(t('video.converter.errorProcessing') + ' ' + data.message);
              break;
              
            default:
              console.log('Worker message:', type, data);
          }
        };
      } catch (error) {
        console.error('Failed to initialize worker:', error);
      }
    };
    
    // Initialize the worker
    initWorker();
    
    // Clean up worker when component unmounts
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, [t]);
  
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
    setWorkerStatus({ frameCount: 0 });
    
    // Reset recording state
    recordedFramesRef.current = [];
    frameChunksRef.current = [];
    processingStateRef.current = {
      ...processingStateRef.current,
      isProcessing: false,
      processedChunks: 0,
      lastCaptureTime: 0
    };
    
    // Clear worker cache
    if (workerRef.current) {
      workerRef.current.postMessage({
        type: 'CLEAR_CACHE'
      });
    }
    
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
    processingStateRef.current.lastCaptureTime = 0;
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
    processingStateRef.current.lastCaptureTime = 0;
    
    // Small delay before starting new countdown
    setTimeout(() => {
      startRecording();
    }, 500);
  };
  
  // Monitor memory usage to prevent crashes
  useEffect(() => {
    // Only run in browsers that support performance.memory
    if (typeof window === 'undefined' || !window.performance || !window.performance.memory) {
      return;
    }
    
    const checkMemoryUsage = () => {
      const memory = window.performance.memory;
      const usedHeapSizeInMB = Math.round(memory.usedJSHeapSize / (1024 * 1024));
      const totalHeapSizeInMB = Math.round(memory.totalJSHeapSize / (1024 * 1024));
      const usagePercentage = Math.round((usedHeapSizeInMB / totalHeapSizeInMB) * 100);
      
      // Update memory usage state
      setMemoryUsage({
        used: usedHeapSizeInMB,
        total: totalHeapSizeInMB,
        percentage: usagePercentage
      });
      
      // If memory usage is too high, try to free up memory
      if (usagePercentage > 80) {
        console.warn('High memory usage detected, triggering garbage collection');
        
        // Force free any unused image buffers by nullifying references
        if (recordedFramesRef.current.length > 0) {
          // Take the excess frames and send them to the worker
          processFrameChunk();
        }
      }
    };
    
    // Only monitor memory during recording
    if (isRecording) {
      // Check memory usage every 2 seconds
      memoryMonitorRef.current = setInterval(checkMemoryUsage, 2000);
    } else if (memoryMonitorRef.current) {
      clearInterval(memoryMonitorRef.current);
    }
    
    return () => {
      if (memoryMonitorRef.current) {
        clearInterval(memoryMonitorRef.current);
      }
    };
  }, [isRecording]);
  
  // Handle GC triggering
  const triggerGarbageCollection = useCallback(() => {
    // Clean up any unused objects
    if (typeof window !== 'undefined' && window.gc) {
      try {
        window.gc();
      } catch (e) {
        console.log('Manual GC not available');
      }
    }
    
    // In Chrome, forcing allocations and dereferencing can help trigger GC
    const forceGC = () => {
      const memoryHog = [];
      try {
        // Allocate a large object and immediately dereference it
        for (let i = 0; i < 10; i++) {
          memoryHog.push(new ArrayBuffer(1024 * 1024)); // Allocate 1MB
        }
      } catch (e) {
        console.error('Error forcing GC', e);
      }
      
      // Clear the memory hog
      while (memoryHog.length) {
        memoryHog.pop();
      }
    };
    
    forceGC();
  }, []);
  
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
    if (processingStateRef.current.lastCaptureTime === currentTime) {
      return;
    }
    
    processingStateRef.current.lastCaptureTime = currentTime;
    
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
      
      // Save output dimensions for encoder initialization
      if (processingStateRef.current.outputWidth === 0) {
        processingStateRef.current.outputWidth = evenSourceWidth;
        processingStateRef.current.outputHeight = evenSourceHeight;
      }
      
      // Draw the current frame to the canvas
      ctx.drawImage(
        video,
        sourceX, sourceY, sourceWidth, sourceHeight,
        0, 0, canvas.width, canvas.height
      );
      
      // Capture the frame
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      
      // Instead of adding directly to recordedFramesRef, create a simplified object
      // This reduces memory usage by not storing the full ImageData object
      const frame = {
        // Store the image data as an ArrayBuffer which can be transferred to the worker
        buffer: imageData.data.buffer,
        width: canvas.width,
        height: canvas.height,
        timestamp: currentTime
      };
      
      // Add to local buffer
      recordedFramesRef.current.push(frame);
      
      // Process frames in chunks to avoid memory issues
      // Changed threshold to be more aggressive on memory cleanup
      if (recordedFramesRef.current.length >= processingStateRef.current.frameBufferSize) {
        processFrameChunk();
        
        // Try to trigger garbage collection after processing a chunk
        setTimeout(() => {
          triggerGarbageCollection();
        }, 100);
      }
    } catch (error) {
      console.error('Error capturing frame:', error);
    }
    
  }, [isRecording, triggerGarbageCollection]);

  // Process a chunk of frames to avoid memory buildup
  const processFrameChunk = async () => {
    if (processingStateRef.current.isProcessing || recordedFramesRef.current.length === 0 || !workerRef.current) {
      return;
    }
    
    processingStateRef.current.isProcessing = true;
    
    try {
      // Take frames from the buffer
      const framesChunk = [...recordedFramesRef.current];
      // Clear the buffer
      recordedFramesRef.current = [];
      
      // Send to worker for processing instead of storing directly
      // Use transferable objects to avoid copying the large buffer data
      const transferables = framesChunk.map(frame => frame.buffer);
      
      workerRef.current.postMessage({
        type: 'ADD_FRAMES',
        data: {
          frames: framesChunk
        }
      }, transferables);
      
      console.log(`Frame chunk sent to worker: ${framesChunk.length} frames`);
      
    } catch (error) {
      console.error('Error processing frame chunk:', error);
      // If worker fails, fallback to storing locally
      frameChunksRef.current.push({
        frames: recordedFramesRef.current,
        processed: false
      });
      recordedFramesRef.current = [];
    } finally {
      processingStateRef.current.isProcessing = false;
    }
  };
  
  // Handle video ended event
  const handleVideoEnded = async () => {
    setIsPlaying(false);
    setIsRecording(false);
    
    // Process any remaining frames in the buffer
    if (recordedFramesRef.current.length > 0) {
      await processFrameChunk();
    }
    
    // Give worker a moment to finish processing
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Start exporting
    exportVideo();
  };
  
  // Export the recorded frames to MP4
  const exportVideo = async () => {
    // Wait for worker to finish processing frames
    if (workerRef.current && workerStatus.remaining > 0) {
      // Trigger processing of any remaining frames
      workerRef.current.postMessage({ type: 'PROCESS_FRAMES' });
      
      // Give the worker a moment to finish
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Count total frames from chunks
    const totalFrames = frameChunksRef.current.reduce(
      (count, chunk) => count + chunk.frames.length, 
      0
    );
    
    if (totalFrames === 0) return;
    
    try {
      console.log(`Starting export with ${totalFrames} frames...`);
      
      // Check if WebCodecs API is available
      if (typeof window !== 'undefined' && !('VideoEncoder' in window)) {
        throw new Error(t('video.converter.browserNotSupported'));
      }
      
      // Get frame dimensions from the first chunk's first frame
      const firstChunk = frameChunksRef.current[0];
      const firstFrame = firstChunk.frames[0];
      const width = firstFrame.width;
      const height = firstFrame.height;
      
      // Store for later use
      processingStateRef.current.outputWidth = width;
      processingStateRef.current.outputHeight = height;
      
      // Create a temporary canvas for encoding if not already created
      if (!processingStateRef.current.canvas) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        
        processingStateRef.current.canvas = canvas;
        processingStateRef.current.ctx = ctx;
      }
      
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
            setProcessingError(t('video.converter.errorEncoding') + ' ' + e.message);
          }
        });
        
        await videoEncoder.configure({
          codec: 'avc1.42001f', // H.264 baseline profile
          width,
          height,
          bitrate,
          framerate: outputFrameRate
        });
        
        // Store encoder and muxer for potential early cleanup
        processingStateRef.current.encoder = videoEncoder;
        processingStateRef.current.muxer = muxer;
        processingStateRef.current.target = target;
        
        // Calculate the last frame timestamp
        let lastTimestamp = 0;
        for (const chunk of frameChunksRef.current) {
          const chunkFrames = chunk.frames;
          if (chunkFrames.length > 0) {
            const lastFrameInChunk = chunkFrames[chunkFrames.length - 1];
            lastTimestamp = Math.max(lastTimestamp, lastFrameInChunk.timestamp);
          }
        }
        
        const videoDuration = lastTimestamp; // Last frame timestamp
        
        // Calculate microseconds per frame for 30fps output
        const microSecondsPerFrame = 1000000 / outputFrameRate;
        
        // Process all chunks sequentially
        let processedFrameCount = 0;
        let outputFrameIndex = 0;
        let lastProgressUpdate = 0;
        
        // Create temporary ImageData for rendering frames
        const tempImageData = new ImageData(width, height);
        
        // Flatten all frames for processing
        const allFrames = [];
        for (const chunk of frameChunksRef.current) {
          allFrames.push(...chunk.frames);
        }
        
        // Sort frames by timestamp to ensure correct ordering
        allFrames.sort((a, b) => a.timestamp - b.timestamp);
        
        // Track frame indices to ensure no frame is skipped
        const processedFrameIndices = new Set();
        let lastProcessedInputFrame = -1;
        
        while (outputFrameIndex * microSecondsPerFrame <= videoDuration * 1000) {
          // Calculate the target time for this output frame
          const targetOutputTime = outputFrameIndex * microSecondsPerFrame / 1000; // in ms
          
          // Find the closest input frame to this target time
          let closestFrameIndex = 0;
          let smallestTimeDiff = Number.MAX_VALUE;
          
          for (let i = 0; i < allFrames.length; i++) {
            const timeDiff = Math.abs(allFrames[i].timestamp - targetOutputTime);
            if (timeDiff < smallestTimeDiff) {
              smallestTimeDiff = timeDiff;
              closestFrameIndex = i;
            }
            
            // If we've passed the target time by a reasonable margin, no need to check further frames
            if (allFrames[i].timestamp > targetOutputTime + 100) {
              break;
            }
          }
          
          // Update progress every 30 frames (approximately once per second at 30fps)
          if (outputFrameIndex % 30 === 0) {
            const now = Date.now();
            // Only update UI every 250ms to reduce rendering load
            if (now - lastProgressUpdate > 250) {
              lastProgressUpdate = now;
              setExportProgress(Math.round((outputFrameIndex * microSecondsPerFrame / 1000 / videoDuration) * 100));
              // Allow UI to update
              await new Promise(resolve => setTimeout(resolve, 0));
            }
          }
          
          // Mark this frame as processed
          processedFrameIndices.add(closestFrameIndex);
          
          // Get the closest frame
          const frame = allFrames[closestFrameIndex];
          
          // Only skip duplicate frames when we're not close to the end of the video
          const isNearEnd = targetOutputTime >= videoDuration * 0.9;
          
          // If we've already processed this exact input frame and it's not the only frame,
          // we can skip creating a duplicate frame unless we're near the end
          if (!isNearEnd && closestFrameIndex === lastProcessedInputFrame && allFrames.length > 1 && outputFrameIndex > 0) {
            outputFrameIndex++;
            continue;
          }
          
          lastProcessedInputFrame = closestFrameIndex;
          
          // Draw to canvas
          if (frame.buffer) {
            // Reconstruct ImageData from buffer
            tempImageData.data.set(new Uint8ClampedArray(frame.buffer));
            processingStateRef.current.ctx.putImageData(tempImageData, 0, 0);
            
            // Create video frame from canvas with proper timestamp
            const videoFrame = new VideoFrame(processingStateRef.current.canvas, {
              timestamp: Math.round(outputFrameIndex * microSecondsPerFrame),
              duration: microSecondsPerFrame
            });
            
            // Key frame every 30 frames or on first frame
            const keyFrame = outputFrameIndex === 0 || outputFrameIndex % processingStateRef.current.keyFrameInterval === 0;
            
            try {
              // Encode frame
              await videoEncoder.encode(videoFrame, { keyFrame });
              videoFrame.close();
              
              // Free memory by nullifying processed frame's buffer reference
              frame.buffer = null;
              
              processedFrameCount++;
            } catch (frameError) {
              console.error(`Error encoding frame ${outputFrameIndex}:`, frameError);
              videoFrame.close();
            }
          }
          
          outputFrameIndex++;
          
          // Add a small delay every 10 frames to prevent browser from becoming unresponsive
          if (outputFrameIndex % 10 === 0) {
            await new Promise(resolve => setTimeout(resolve, 5));
          }
        }
        
        // Process any skipped frames at the end to avoid missing frames
        for (let i = 0; i < allFrames.length; i++) {
          if (!processedFrameIndices.has(i)) {
            const frame = allFrames[i];
            
            if (frame.buffer) {
              // Reconstruct ImageData from buffer
              tempImageData.data.set(new Uint8ClampedArray(frame.buffer));
              processingStateRef.current.ctx.putImageData(tempImageData, 0, 0);
              
              const videoFrame = new VideoFrame(processingStateRef.current.canvas, {
                timestamp: Math.round(outputFrameIndex * microSecondsPerFrame),
                duration: microSecondsPerFrame
              });
              
              const keyFrame = outputFrameIndex % processingStateRef.current.keyFrameInterval === 0;
              
              try {
                await videoEncoder.encode(videoFrame, { keyFrame });
                videoFrame.close();
                outputFrameIndex++;
                processedFrameCount++;
                
                // Free memory
                frame.buffer = null;
              } catch (frameError) {
                console.error(`Error encoding extra frame ${i}:`, frameError);
                videoFrame.close();
              }
            }
          }
        }
        
        // Clear all frame data to free memory
        frameChunksRef.current = [];
        allFrames.length = 0;
        
        // Finish encoding
        await videoEncoder.flush();
        muxer.finalize();
        
        // Create URL for the encoded video
        const blob = new Blob([target.buffer], { type: 'video/mp4' });
        
        const url = URL.createObjectURL(blob);
        setOutputVideoUrl(url);
        setOutputFileName(generateRandomFileName());
        setExportProgress(100);
        setShowVideoInput(false); // Hide the video input when export is complete
        
        // Clean up resources
        processingStateRef.current.encoder = null;
        processingStateRef.current.muxer = null;
        processingStateRef.current.target = null;
        
      } catch (encoderError) {
        console.error('Encoder setup/processing error:', encoderError);
        throw new Error(t('video.converter.errorProcessing') + ' ' + encoderError.message);
      }
      
    } catch (error) {
      console.error('Error exporting video:', error);
      setProcessingError(t('video.converter.errorProcessing') + ' ' + error.message);
      setExportProgress(0);
      
      // Clean up resources on error
      frameChunksRef.current = [];
      recordedFramesRef.current = [];
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
              
              {/* Frame status indicator during recording (optional) */}
              {isRecording && workerStatus.frameCount > 0 && (
                <div className="mt-2 text-xs text-gray-500">
                  {t('video.converter.framesRecorded')}: {workerStatus.frameCount}
                  {memoryUsage && (
                    <span className="ml-2">
                      {" | "} 
                      {t('video.converter.memoryUsage')}: {memoryUsage.used}MB / {memoryUsage.total}MB 
                      ({memoryUsage.percentage}%)
                    </span>
                  )}
                </div>
              )}
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
                      processingStateRef.current.lastCaptureTime = 0;
                      
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