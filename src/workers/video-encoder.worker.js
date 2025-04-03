/* eslint-disable no-restricted-globals */
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

// Listen for messages from the main thread
self.addEventListener('message', async (event) => {
  const { type, data } = event.data;

  switch (type) {
    case 'encode':
      try {
        await encodeVideo(data);
      } catch (error) {
        self.postMessage({
          type: 'error',
          error: error.message || 'Unknown encoding error'
        });
      }
      break;
    default:
      console.warn(`Unknown message type: ${type}`);
  }
});

// Video encoding function
async function encodeVideo({
  frames,
  width,
  height,
  videoDuration,
  bitrate = 2_000_000,
  outputFrameRate = 30
}) {
  try {
    // Check if WebCodecs API is available
    if (typeof self !== 'undefined' && !('VideoEncoder' in self)) {
      throw new Error('Your browser does not support the WebCodecs API');
    }

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
        throw new Error('Error encoding video: ' + e.message);
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

    // Calculate microseconds per frame for 30fps output
    const microSecondsPerFrame = 1000000 / outputFrameRate;

    // Create temporary offscreen canvas for frame processing
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // Process frames with improved timing adjustment
    let outputFrameIndex = 0;
    let lastProcessedInputFrame = -1;

    // Track frame indices to ensure no frame is skipped
    const processedFrameIndices = new Set();

    while (outputFrameIndex * microSecondsPerFrame <= videoDuration * 1000) {
      // Calculate the target time for this output frame
      const targetOutputTime = outputFrameIndex * microSecondsPerFrame / 1000; // in ms

      // Find the closest input frame to this target time
      let closestFrameIndex = 0;
      let smallestTimeDiff = Number.MAX_VALUE;

      for (let i = 0; i < totalFrames; i++) {
        const timeDiff = Math.abs(frames[i].timestamp - targetOutputTime);
        if (timeDiff < smallestTimeDiff) {
          smallestTimeDiff = timeDiff;
          closestFrameIndex = i;
        }

        // If we've passed the target time by a reasonable margin, no need to check further frames
        if (frames[i].timestamp > targetOutputTime + 100) {
          break;
        }
      }

      // Report progress periodically
      if (outputFrameIndex % 10 === 0) {
        self.postMessage({
          type: 'progress',
          progress: Math.round((outputFrameIndex * microSecondsPerFrame / 1000 / videoDuration) * 100)
        });
      }

      // Mark this frame as processed
      processedFrameIndices.add(closestFrameIndex);

      // Get the closest frame
      const frame = frames[closestFrameIndex];

      // Only skip duplicate frames when we're not close to the end of the video
      const isNearEnd = targetOutputTime >= videoDuration * 0.9;

      // If we've already processed this exact input frame and it's not the only frame,
      // we can skip creating a duplicate frame unless we're near the end
      if (!isNearEnd && closestFrameIndex === lastProcessedInputFrame && totalFrames > 1 && outputFrameIndex > 0) {
        outputFrameIndex++;
        continue;
      }

      lastProcessedInputFrame = closestFrameIndex;

      // Draw to canvas
      if (frame.bitmap) {
        ctx.drawImage(frame.bitmap, 0, 0);

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

      // Add a small delay every 10 frames to prevent worker from becoming unresponsive
      if (outputFrameIndex % 10 === 0) {
        await new Promise(resolve => setTimeout(resolve, 5));
      }
    }

    // Process any skipped frames at the end to avoid missing frames
    for (let i = 0; i < totalFrames; i++) {
      if (!processedFrameIndices.has(i)) {
        const frame = frames[i];

        if (frame.bitmap) {
          ctx.drawImage(frame.bitmap, 0, 0);

          const videoFrame = new VideoFrame(canvas, {
            timestamp: Math.round(outputFrameIndex * microSecondsPerFrame),
            duration: microSecondsPerFrame
          });

          const keyFrame = outputFrameIndex % 30 === 0;

          try {
            await videoEncoder.encode(videoFrame, { keyFrame });
            videoFrame.close();
            outputFrameIndex++;
          } catch (frameError) {
            console.error(`Error encoding extra frame ${i}:`, frameError);
            videoFrame.close();
          }
        }
      }
    }

    // Finish encoding
    await videoEncoder.flush();
    muxer.finalize();

    // Send the encoded video buffer back to the main thread
    self.postMessage({
      type: 'complete',
      buffer: target.buffer
    }, [target.buffer]); // Transfer ownership of the buffer

  } catch (error) {
    console.error('Worker encoding error:', error);
    self.postMessage({
      type: 'error',
      error: error.message || 'Unknown encoding error'
    });
  }
} 