'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

export function useVideoEncoderWorker() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  
  const workerRef = useRef(null);
  
  // Initialize the worker
  useEffect(() => {
    // Only initialize on the client
    if (typeof window === 'undefined') return;
    
    // Create the worker if it doesn't exist
    if (!workerRef.current) {
      try {
        workerRef.current = new Worker(new URL('../workers/video-encoder.worker.js', import.meta.url), {
          type: 'module',
        });
        
        setIsInitialized(true);
      } catch (err) {
        console.error('Failed to initialize video encoder worker:', err);
        setError('Failed to initialize video encoder worker');
      }
    }
    
    // Clean up worker when component unmounts
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, []);
  
  // Set up message handlers
  useEffect(() => {
    if (!workerRef.current) return;
    
    const handleMessage = (event) => {
      const { type, progress: workerProgress, buffer, error: workerError } = event.data;
      
      switch (type) {
        case 'progress':
          setProgress(workerProgress);
          break;
        case 'complete':
          setIsProcessing(false);
          setProgress(100);
          break;
        case 'error':
          setIsProcessing(false);
          setError(workerError);
          break;
        default:
          console.warn(`Unknown message type from worker: ${type}`);
      }
    };
    
    workerRef.current.addEventListener('message', handleMessage);
    
    return () => {
      if (workerRef.current) {
        workerRef.current.removeEventListener('message', handleMessage);
      }
    };
  }, []);
  
  // Process frames using the worker
  const encodeVideo = useCallback(async (frames, options) => {
    if (!workerRef.current || !isInitialized) {
      setError('Video encoder worker not initialized');
      return null;
    }
    
    try {
      setIsProcessing(true);
      setProgress(0);
      setError('');
      
      // Create a promise that resolves when encoding completes
      return new Promise((resolve, reject) => {
        // Set up one-time message handler for this encoding job
        const handleCompleteMessage = (event) => {
          const { type, buffer, error: workerError } = event.data;
          
          if (type === 'complete') {
            // Create a blob from the buffer
            const blob = new Blob([buffer], { type: 'video/mp4' });
            workerRef.current.removeEventListener('message', handleCompleteMessage);
            resolve(blob);
          } else if (type === 'error') {
            workerRef.current.removeEventListener('message', handleCompleteMessage);
            reject(new Error(workerError));
          }
        };
        
        workerRef.current.addEventListener('message', handleCompleteMessage);
        
        // Convert ImageData to transferable ImageBitmap objects
        // This is more efficient for transferring between threads
        Promise.all(
          frames.map(async (frame) => {
            if (!frame.imageData) return null;
            
            // Create ImageBitmap from ImageData
            const bitmap = await createImageBitmap(frame.imageData);
            
            return {
              bitmap,
              timestamp: frame.timestamp,
              width: frame.width,
              height: frame.height
            };
          })
        )
        .then((frameData) => {
          // Filter out any null frames
          const validFrames = frameData.filter(Boolean);
          
          // Send frames and options to worker
          const transferables = validFrames.map(frame => frame.bitmap);
          
          workerRef.current.postMessage({
            type: 'encode',
            data: {
              frames: validFrames,
              width: options.width,
              height: options.height,
              videoDuration: options.duration,
              bitrate: options.bitrate || 2_000_000,
              outputFrameRate: options.outputFrameRate || 30
            }
          }, transferables);
        })
        .catch(err => {
          reject(err);
        });
      });
    } catch (err) {
      setIsProcessing(false);
      setError(err.message);
      return null;
    }
  }, [isInitialized]);
  
  return {
    encodeVideo,
    isInitialized,
    isProcessing,
    progress,
    error,
  };
} 