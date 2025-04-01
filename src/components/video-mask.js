'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslations } from '@/hooks/use-translations';

export default function VideoMask({ 
  maskRef, 
  videoWidth, 
  videoHeight, 
  isRecording, 
  lang,
  onInteractionStart,
  onInteractionEnd
}) {
  const { t } = useTranslations(lang);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  // Track whether dimensions have been initialized
  const hasInitialized = useRef(false);
  // Ref to store the current position for animation frame updates
  const positionRef = useRef({ x: 0, y: 0 });
  // Ref to store the target position (where we want to end up)
  const targetPositionRef = useRef({ x: 0, y: 0 });
  // Ref to store the animation frame ID
  const animationFrameRef = useRef(null);
  // Ref to track the last time position was updated
  const lastUpdateTimeRef = useRef(0);

  // Calculate mask dimensions based on actual rendered video size
  useEffect(() => {
    if (!containerRef.current) return;
    
    const updateDimensions = () => {
      // Only continue if we have a valid container
      if (!containerRef.current) return;
      
      const containerRect = containerRef.current.getBoundingClientRect();
      
      // Use the actual rendered height of the video container
      const renderedHeight = containerRect.height;
      // Width for 9:16 aspect ratio based on rendered height
      const renderedWidth = (9 / 16) * renderedHeight;
      
      // Ensure dimensions are even numbers for H.264 encoding compatibility
      const evenWidth = Math.floor(renderedWidth / 2) * 2;
      const evenHeight = Math.floor(renderedHeight / 2) * 2;
      
      setDimensions({
        width: evenWidth,
        height: evenHeight
      });
      
      // Center the mask horizontally
      const initialX = (containerRect.width - evenWidth) / 2;
      
      // Initialize all position refs
      setPosition({ x: initialX, y: 0 });
      positionRef.current = { x: initialX, y: 0 };
      targetPositionRef.current = { x: initialX, y: 0 };
      
      // Mark as initialized
      hasInitialized.current = true;
    };
    
    // Reset initialization flag when component mounts or video changes
    hasInitialized.current = false;
    
    // Initial calculation
    updateDimensions();
    
    // Additional timeout to ensure video has rendered properly
    setTimeout(updateDimensions, 100);
    
    // Recalculate on window resize
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, [videoWidth, videoHeight]);

  // Simple linear interpolation function for smooth movement
  const lerp = (start, end, factor) => start * (1 - factor) + end * factor;
  
  // Update animation with linear interpolation - much more stable than spring physics
  const animatePosition = useCallback(() => {
    // Calculate the distance to target
    const dx = targetPositionRef.current.x - positionRef.current.x;
    
    // If we're very close to target, just snap to the final position
    if (Math.abs(dx) < 0.5) {
      positionRef.current.x = targetPositionRef.current.x;
      setPosition({ x: targetPositionRef.current.x, y: 0 });
      animationFrameRef.current = null;
      return;
    }
    
    // Use lerp for smooth movement - higher factor = faster movement
    // Use different interpolation factors for dragging vs. releasing
    const interpFactor = isDragging ? 0.4 : 0.2;
    
    // Update position with interpolation
    positionRef.current.x = lerp(
      positionRef.current.x, 
      targetPositionRef.current.x, 
      interpFactor
    );
    
    // Update the React state for UI
    setPosition({ 
      x: positionRef.current.x, 
      y: 0 
    });
    
    // Continue animation
    animationFrameRef.current = requestAnimationFrame(animatePosition);
  }, [isDragging]);

  // Update target position with minimal throttling
  const updateTargetPosition = useCallback((newPosition) => {
    const now = performance.now();
    // Use a reasonable throttle (16ms ≈ 60fps) for position updates
    if (now - lastUpdateTimeRef.current < 16) return;
    lastUpdateTimeRef.current = now;
    
    // Update the target position directly
    targetPositionRef.current = newPosition;
    
    // Start animation loop if not already running
    if (!animationFrameRef.current) {
      animationFrameRef.current = requestAnimationFrame(animatePosition);
    }
  }, [animatePosition]);

  // Handle mouse down event
  const handleMouseDown = (e) => {
    e.preventDefault();
    
    // Stop any current animations to ensure responsiveness
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    setIsDragging(true);
    
    // Notify parent component about interaction start
    if (onInteractionStart) onInteractionStart();
    
    // Calculate drag starting position
    const rect = e.currentTarget.getBoundingClientRect();
    setDragStart({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    });
  };

  // Handle touch start event
  const handleTouchStart = (e) => {
    e.preventDefault();
    
    // Stop any current animations to ensure responsiveness
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    setIsDragging(true);
    
    // Notify parent component about interaction start
    if (onInteractionStart) onInteractionStart();
    
    const touch = e.touches[0];
    const rect = e.currentTarget.getBoundingClientRect();
    
    setDragStart({
      x: touch.clientX - rect.left,
      y: touch.clientY - rect.top
    });
  };

  // Handle mouse move event
  const handleMouseMove = useCallback((e) => {
    if (!isDragging || !containerRef.current) return;
    
    // Calculate new position
    const containerRect = containerRef.current.getBoundingClientRect();
    let newX = e.clientX - containerRect.left - dragStart.x;
    
    // Simple clamping to boundaries instead of elasticity
    newX = Math.max(0, Math.min(newX, containerRect.width - dimensions.width));
    
    updateTargetPosition({
      x: newX,
      y: 0 // Mask always stays at the top vertically
    });
  }, [isDragging, dragStart, dimensions.width, updateTargetPosition]);

  // Handle touch move event
  const handleTouchMove = useCallback((e) => {
    if (!isDragging || !containerRef.current) return;
    
    const touch = e.touches[0];
    const containerRect = containerRef.current.getBoundingClientRect();
    let newX = touch.clientX - containerRect.left - dragStart.x;
    
    // Simple clamping to boundaries instead of elasticity
    newX = Math.max(0, Math.min(newX, containerRect.width - dimensions.width));
    
    updateTargetPosition({
      x: newX,
      y: 0 // Mask always stays at the top vertically
    });
  }, [isDragging, dragStart, dimensions.width, updateTargetPosition]);

  // Handle mouse up event
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    
    // Notify parent component about interaction end
    if (onInteractionEnd) onInteractionEnd();
    
    // Ensure we have an animation frame running for final positioning
    if (!animationFrameRef.current) {
      animationFrameRef.current = requestAnimationFrame(animatePosition);
    }
  }, [animatePosition, onInteractionEnd]);

  // Handle touch end event
  const handleTouchEnd = useCallback(() => {
    handleMouseUp(); // Reuse the same logic
  }, [handleMouseUp]);

  // Cleanup animation frame on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  // Add and remove event listeners
  useEffect(() => {
    if (isDragging) {
      // Mouse events
      document.addEventListener('mousemove', handleMouseMove, { passive: false });
      document.addEventListener('mouseup', handleMouseUp);
      
      // Touch events
      document.addEventListener('touchmove', handleTouchMove, { passive: false });
      document.addEventListener('touchend', handleTouchEnd);
      document.addEventListener('touchcancel', handleTouchEnd);
    }
    
    return () => {
      // Mouse events
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      
      // Touch events
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
      document.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [isDragging, handleMouseMove, handleMouseUp, handleTouchMove, handleTouchEnd]);

  return (
    <div 
      ref={containerRef}
      className="absolute top-0 left-0 overflow-hidden w-full h-full touch-none"
    >
      {/* Message displayed above the mask */}
      <div 
        className="absolute z-10 transform -translate-y-8 pointer-events-none"
        style={{ 
          left: `${position.x + dimensions.width/2 - 75}px`, 
          top: `${position.y}px`
        }}
      >
        {isRecording ? (
          <div className="bg-red-500 text-white text-xs rounded-sm px-2 py-1 whitespace-nowrap">
            {t('video.mask.recording')}
          </div>
        ) : (
          <div className="bg-black bg-opacity-50 text-white text-xs rounded-sm px-2 py-1 whitespace-nowrap">
            {t('video.mask.dragToPosition')}
          </div>
        )}
      </div>

      <div
        ref={maskRef}
        className={`absolute border-2 ${
          isRecording ? 'border-red-500' : 'border-yellow-400'
        } ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        style={{
          width: dimensions.width ? `${dimensions.width}px` : '0',
          height: dimensions.height ? `${dimensions.height}px` : '0',
          transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
          backgroundColor: 'rgba(255, 255, 0, 0.1)',
          boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)',
          willChange: 'transform', // Optimize for animations
          touchAction: 'none' // Prevent browser handling of all touch gestures
        }}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
      >
      </div>
    </div>
  );
} 