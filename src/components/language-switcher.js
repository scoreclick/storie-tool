'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useCallback } from 'react';
import { locales } from '@/dictionaries/config';
import Link from 'next/link';

export default function LanguageSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  
  const switchLanguage = useCallback((locale) => {
    // Get the current path segments
    const segments = pathname.split('/');
    
    // Replace the first segment (which is the current locale) with the new locale
    segments[1] = locale;
    
    // Join segments back together
    const newPath = segments.join('/');
    
    // Navigate to the new path
    router.push(newPath);
    
    // Set the locale in a cookie for future visits
    document.cookie = `NEXT_LOCALE=${locale}; path=/; max-age=${60 * 60 * 24 * 365}`;
  }, [pathname, router]);

  // Get the current locale from the pathname
  const currentLocale = pathname.split('/')[1];

  return (
    <div className="flex space-x-2">
      {locales.map((locale) => (
        <button
          key={locale}
          onClick={() => switchLanguage(locale)}
          className={`text-sm p-1 rounded ${
            currentLocale === locale
              ? 'bg-blue-500 text-white'
              : 'bg-gray-200 hover:bg-gray-300'
          }`}
          aria-label={`Switch language to ${locale}`}
        >
          {locale === 'en-US' && '🇺🇸'}
          {locale === 'pt-BR' && '🇧🇷'}
          {locale === 'es' && '🇪🇸'}
        </button>
      ))}
    </div>
  );
} 