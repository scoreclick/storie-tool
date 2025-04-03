/**
 * Web Worker for processing video frames in the background
 * This helps prevent the main thread from being blocked during recording
 */

// Worker context
const ctx = self;

// Cache for frames that are being processed
let frameCache = [];
let isProcessing = false;

// Listen for messages from the main thread
ctx.addEventListener('message', function(event) {
  const { type, data } = event.data;

  switch (type) {
    case 'ADD_FRAMES':
      // Add new frames to the cache
      addFrames(data.frames);
      break;
    
    case 'PROCESS_FRAMES':
      // Process the frames (manipulate, compress, etc.)
      processFrames();
      break;
      
    case 'CLEAR_CACHE':
      // Clear the frame cache
      clearCache();
      break;
      
    default:
      console.error('Unknown message type:', type);
  }
});

/**
 * Add new frames to the processing cache
 * @param {Array} frames - Array of frame objects
 */
function addFrames(frames) {
  if (!Array.isArray(frames) || frames.length === 0) return;
  
  // Add frames to the cache
  frameCache.push(...frames);
  
  // Notify the main thread of the current cache size
  ctx.postMessage({
    type: 'CACHE_UPDATE',
    data: {
      cacheSize: frameCache.length
    }
  });
  
  // Start processing if not already in progress
  if (!isProcessing && frameCache.length > 0) {
    processFrames();
  }
}

/**
 * Process frames in the cache
 */
function processFrames() {
  if (isProcessing || frameCache.length === 0) return;
  
  isProcessing = true;
  
  try {
    // Take a chunk of frames to process (limited batch size to avoid memory issues)
    const batchSize = 30;
    const framesToProcess = frameCache.splice(0, batchSize);
    
    // Sort frames by timestamp to ensure proper order
    framesToProcess.sort((a, b) => a.timestamp - b.timestamp);
    
    // Send processed frames back to the main thread
    ctx.postMessage({
      type: 'FRAMES_PROCESSED',
      data: {
        frames: framesToProcess,
        remaining: frameCache.length
      }
    });
    
    // Schedule the next batch if there are more frames
    if (frameCache.length > 0) {
      setTimeout(() => {
        isProcessing = false;
        processFrames();
      }, 10); // Small delay to prevent UI blocking
    } else {
      isProcessing = false;
    }
    
  } catch (error) {
    console.error('Error processing frames in worker:', error);
    isProcessing = false;
    
    // Notify main thread of the error
    ctx.postMessage({
      type: 'ERROR',
      data: {
        message: error.message || 'Unknown error in frame processor',
        stack: error.stack
      }
    });
  }
}

/**
 * Clear the frame cache
 */
function clearCache() {
  frameCache = [];
  isProcessing = false;
  
  // Notify the main thread that the cache is cleared
  ctx.postMessage({
    type: 'CACHE_CLEARED',
    data: {
      cacheSize: 0
    }
  });
}

// Worker code as a string that can be used with Blob in Next.js
const workerCode = `
/**
 * Web Worker for processing video frames in the background
 * This helps prevent the main thread from being blocked during recording
 */

// Worker context
const ctx = self;

// Cache for frames that are being processed
let frameCache = [];
let isProcessing = false;

// Listen for messages from the main thread
ctx.addEventListener('message', function(event) {
  const { type, data } = event.data;

  switch (type) {
    case 'ADD_FRAMES':
      // Add new frames to the cache
      addFrames(data.frames);
      break;
    
    case 'PROCESS_FRAMES':
      // Process the frames (manipulate, compress, etc.)
      processFrames();
      break;
      
    case 'CLEAR_CACHE':
      // Clear the frame cache
      clearCache();
      break;
      
    default:
      console.error('Unknown message type:', type);
  }
});

/**
 * Add new frames to the processing cache
 * @param {Array} frames - Array of frame objects
 */
function addFrames(frames) {
  if (!Array.isArray(frames) || frames.length === 0) return;
  
  // Add frames to the cache
  frameCache.push(...frames);
  
  // Notify the main thread of the current cache size
  ctx.postMessage({
    type: 'CACHE_UPDATE',
    data: {
      cacheSize: frameCache.length
    }
  });
  
  // Start processing if not already in progress
  if (!isProcessing && frameCache.length > 0) {
    processFrames();
  }
}

/**
 * Process frames in the cache
 */
function processFrames() {
  if (isProcessing || frameCache.length === 0) return;
  
  isProcessing = true;
  
  try {
    // Take a chunk of frames to process (limited batch size to avoid memory issues)
    const batchSize = 30;
    const framesToProcess = frameCache.splice(0, batchSize);
    
    // Sort frames by timestamp to ensure proper order
    framesToProcess.sort((a, b) => a.timestamp - b.timestamp);
    
    // Send processed frames back to the main thread
    ctx.postMessage({
      type: 'FRAMES_PROCESSED',
      data: {
        frames: framesToProcess,
        remaining: frameCache.length
      }
    });
    
    // Schedule the next batch if there are more frames
    if (frameCache.length > 0) {
      setTimeout(() => {
        isProcessing = false;
        processFrames();
      }, 10); // Small delay to prevent UI blocking
    } else {
      isProcessing = false;
    }
    
  } catch (error) {
    console.error('Error processing frames in worker:', error);
    isProcessing = false;
    
    // Notify main thread of the error
    ctx.postMessage({
      type: 'ERROR',
      data: {
        message: error.message || 'Unknown error in frame processor',
        stack: error.stack
      }
    });
  }
}

/**
 * Clear the frame cache
 */
function clearCache() {
  frameCache = [];
  isProcessing = false;
  
  // Notify the main thread that the cache is cleared
  ctx.postMessage({
    type: 'CACHE_CLEARED',
    data: {
      cacheSize: 0
    }
  });
}`;

// Export the worker code as the default export
export default workerCode; 