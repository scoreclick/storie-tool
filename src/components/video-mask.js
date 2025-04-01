'use client';

import { useState, useEffect, useRef } from 'react';
import { useTranslations } from '@/hooks/use-translations';

export default function VideoMask({ maskRef, videoWidth, videoHeight, isRecording, lang }) {
  const { t } = useTranslations(lang);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  // Track whether dimensions have been initialized
  const hasInitialized = useRef(false);

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
      setPosition({ x: initialX, y: 0 });
      
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

  // Handle mouse down event
  const handleMouseDown = (e) => {
    e.preventDefault();
    setIsDragging(true);
    
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
    setIsDragging(true);
    
    const touch = e.touches[0];
    const rect = e.currentTarget.getBoundingClientRect();
    
    setDragStart({
      x: touch.clientX - rect.left,
      y: touch.clientY - rect.top
    });
  };

  // Handle mouse move event
  const handleMouseMove = (e) => {
    if (!isDragging || !containerRef.current) return;
    
    // Calculate new position
    const containerRect = containerRef.current.getBoundingClientRect();
    let newX = e.clientX - containerRect.left - dragStart.x;
    
    // Ensure mask stays within video boundaries
    newX = Math.max(0, Math.min(newX, containerRect.width - dimensions.width));
    
    setPosition({
      x: newX,
      y: 0 // Mask always stays at the top vertically
    });
  };

  // Handle touch move event
  const handleTouchMove = (e) => {
    if (!isDragging || !containerRef.current) return;
    
    const touch = e.touches[0];
    const containerRect = containerRef.current.getBoundingClientRect();
    let newX = touch.clientX - containerRect.left - dragStart.x;
    
    // Ensure mask stays within video boundaries
    newX = Math.max(0, Math.min(newX, containerRect.width - dimensions.width));
    
    setPosition({
      x: newX,
      y: 0 // Mask always stays at the top vertically
    });
  };

  // Handle mouse up event
  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Handle touch end event
  const handleTouchEnd = () => {
    setIsDragging(false);
  };

  // Add and remove event listeners
  useEffect(() => {
    if (isDragging) {
      // Mouse events
      document.addEventListener('mousemove', handleMouseMove);
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
  }, [isDragging]);

  return (
    <div 
      ref={containerRef}
      className="absolute top-0 left-0 overflow-hidden w-full h-full"
    >
      {/* Message displayed above the mask */}
      <div 
        className="absolute z-10 transform -translate-y-8"
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
          left: `${position.x}px`,
          top: `${position.y}px`,
          backgroundColor: 'rgba(255, 255, 0, 0.1)',
          boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)'
        }}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
      >
      </div>
    </div>
  );
} 