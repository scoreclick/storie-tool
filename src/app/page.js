'use client';

import { useState, useRef } from 'react';
import VideoConverter from '@/components/video-converter';

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-4">
      <h1 className="text-2xl md:text-3xl font-bold mb-6">Horizontal to Vertical Video Converter</h1>
      <p className="text-sm md:text-base mb-8 max-w-md text-center">
        Upload a horizontal video and convert it to vertical format with interactive camera movement.
      </p>
      
      <VideoConverter />
      
      <footer className="mt-8 text-xs text-center text-gray-500">
        <p>Built with Next.js and Canvas API</p>
      </footer>
    </div>
  );
}
