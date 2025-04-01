'use client';

import { useTranslations } from '@/hooks/use-translations';

export default function ExportProgress({ progress, lang }) {
  const { t } = useTranslations(lang);
  
  return (
    <div className="w-full">
      <div className="flex justify-between mb-1">
        <span className="text-sm font-medium">{t('video.converter.exporting')}</span>
        <span className="text-sm font-medium">{progress}%</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2.5">
        <div 
          className="bg-blue-600 h-2.5 rounded-full transition-all duration-300" 
          style={{ width: `${progress}%` }}
        ></div>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        {t('video.converter.processingVideo')}
      </p>
    </div>
  );
} 