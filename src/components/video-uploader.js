'use client';

import { useState, useRef } from 'react';

export default function VideoUploader({ onUpload }) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFile(files[0]);
    }
  };

  const handleFileChange = (e) => {
    e.preventDefault();
    const files = e.target.files;
    if (files.length > 0) {
      handleFile(files[0]);
    }
  };

  const handleFile = (file) => {
    // Check if it's a video file
    if (!file.type.startsWith('video/')) {
      alert('Please upload a video file.');
      return;
    }
    
    onUpload(file);
  };

  return (
    <div
      className={`w-full max-w-xl mx-auto p-8 border-2 border-dashed rounded-lg flex flex-col items-center justify-center transition-colors ${
        isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300'
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{ minHeight: '300px' }}
    >
      <svg 
        xmlns="http://www.w3.org/2000/svg" 
        className="h-12 w-12 text-gray-400 mb-4"
        fill="none" 
        viewBox="0 0 24 24" 
        stroke="currentColor"
      >
        <path 
          strokeLinecap="round" 
          strokeLinejoin="round" 
          strokeWidth={2} 
          d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" 
        />
      </svg>
      
      <p className="mb-4 text-center text-gray-600">
        Drag and drop your video here, or
      </p>
      
      <button
        onClick={(e) => {
          e.preventDefault();
          fileInputRef.current.click();
        }}
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
      >
        Select Video
      </button>
      
      <input
        ref={fileInputRef}
        type="file"
        accept=".mp4,.webm,.mov,.avi,video/mp4,video/webm,video/quicktime,video/x-msvideo"
        capture="false"
        onChange={handleFileChange}
        className="hidden"
      />
      
      <p className="mt-4 text-xs text-gray-500 text-center">
        Supported formats: MP4, WebM, MKV, AVI, etc.
      </p>
    </div>
  );
} 