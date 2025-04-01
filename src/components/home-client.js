'use client';

import { useState, useRef } from 'react';
import VideoConverter from './video-converter';
import LanguageSwitcher from './language-switcher';
import { useTranslations } from '@/hooks/use-translations';

export default function HomeClient({ lang }) {
  const { t } = useTranslations(lang);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-4">
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>
      
      <h1 className="text-2xl md:text-3xl font-bold mb-6">
        {t('home.title')}
      </h1>
      <p className="text-sm md:text-base mb-4 max-w-md text-center">
        {t('home.description')}
      </p>
      
      <VideoConverter lang={lang} />
      
      <footer className="mt-8 text-xs text-center text-gray-500">
        <p>{t('home.footer')}</p>
      </footer>
    </div>
  );
} 