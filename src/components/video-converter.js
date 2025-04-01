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
    duration: 0
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [exportProgress, setExportProgress] = useState(0);
  const [outputVideoUrl, setOutputVideoUrl] = useState('');
  const [videoResetKey, setVideoResetKey] = useState(0);
  
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const maskRef = useRef(null);
  const animationFrameRef = useRef(null);
  const recordedFramesRef = useRef([]);
  
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
    recordedFramesRef.current = [];
    // Increment key to force re-mount of mask
    setVideoResetKey(prevKey => prevKey + 1);
    // Reset video metadata to ensure proper recalculation
    setVideoMetadata({
      width: 0,
      height: 0,
      duration: 0
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
      videoRef.current.play()
    }
  };
  
  // Restart recording process
  const handleRestartRecording = () => {
    // Stop current recording
    setIsRecording(false);
    setIsPlaying(false);
    
    // Reset video to beginning
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.pause();
    }
    
    // Clear recorded frames
    recordedFramesRef.current = [];
    
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
    
    // Capture the frame
    recordedFramesRef.current.push({
      imageData: ctx.getImageData(0, 0, canvas.width, canvas.height),
      timestamp: video.currentTime * 1000 // Convert to milliseconds
    });
    
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
      // Check if WebCodecs API is available
      if (typeof window !== 'undefined' && !('VideoEncoder' in window)) {
        throw new Error(
          'WebCodecs API is not supported in this browser. ' +
          'Please use a modern browser like Chrome, Edge, or Opera.'
        );
      }
      
      // Create canvas for encoding
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const firstFrame = frames[0].imageData;
      
      // Ensure dimensions are even numbers for H.264 encoding
      const width = Math.floor(firstFrame.width / 2) * 2;
      const height = Math.floor(firstFrame.height / 2) * 2;
    
      canvas.width = width;
      canvas.height = height;
      
      // Configure video encoder
      const target = new ArrayBufferTarget();
      const muxer = new Muxer({
        target,
        video: {
          codec: 'avc',
          width: canvas.width,
          height: canvas.height
        },
        fastStart: 'in-memory',
        firstTimestampBehavior: 'offset'
      });
      
      // Initialize encoder
      const videoEncoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (e) => console.error('Encoder error:', e)
      });
      
      await videoEncoder.configure({
        codec: 'avc1.42001f', // H.264 baseline profile
        width: canvas.width,
        height: canvas.height,
        bitrate: 5_000_000, // 5 Mbps
        framerate: 30
      });
      
      const totalFrames = frames.length;
      
      // Process each frame
      for (let i = 0; i < totalFrames; i++) {
        const frame = frames[i];
        ctx.putImageData(frame.imageData, 0, 0);
        
        const videoFrame = new VideoFrame(canvas, {
          timestamp: frame.timestamp * 1000, // Convert to microseconds for VideoFrame
          duration: 33333 // ~30fps in microseconds
        });
        
        // Determine if this should be a keyframe (every 30 frames or first frame)
        const keyFrame = i === 0 || i % 30 === 0;
        
        // Encode the frame
        await videoEncoder.encode(videoFrame, { keyFrame });
        videoFrame.close();
        
        // Update progress
        setExportProgress(Math.round((i + 1) / totalFrames * 100));
      }
      
      // Finish encoding
      await videoEncoder.flush();
      muxer.finalize();
      
      // Create URL for the encoded video
      const blob = new Blob([target.buffer], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);
      
      setOutputVideoUrl(url);
      setExportProgress(100);
      
    } catch (error) {
      console.error('Error exporting video:', error);
      setExportProgress(0);
      alert('Failed to export video: ' + error.message);
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
            {!isRecording && !outputVideoUrl && !exportProgress && (
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
            
            {exportProgress > 0 && !outputVideoUrl && (
              <ExportProgress progress={exportProgress} />
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
                    // Reset mask state by incrementing key
                    setVideoResetKey(prevKey => prevKey + 1);
                    // Reset video metadata
                    setVideoMetadata({
                      width: 0,
                      height: 0,
                      duration: 0
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