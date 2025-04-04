'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '@/contexts/language-context';

// This is a client-side implementation that will load the translations
export function useTranslations() {
  const locale = useLanguage();
  const [translations, setTranslations] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Dynamically import the translation file based on the locale
    const loadTranslations = async () => {
      setIsLoading(true);
      try {
        // Import the translation dictionary dynamically
        const dictionary = await import(`@/dictionaries/${locale}.json`);
        setTranslations(dictionary.default);
      } catch (error) {
        console.error(`Failed to load translations for ${locale}:`, error);
        // Fallback to English if the translation file doesn't exist
        const fallback = await import('@/dictionaries/en-US.json');
        setTranslations(fallback.default);
      } finally {
        setIsLoading(false);
      }
    };

    loadTranslations();
  }, [locale]);

  // Function to get a translation by key (supports nested paths like 'home.title')
  const t = useCallback((key, replacements = {}) => {
    if (!translations) return key; // Return the key if translations aren't loaded yet

    // Split the key by dots to access nested properties
    const keys = key.split('.');
    let value = translations;

    // Navigate through the nested structure
    for (const k of keys) {
      value = value?.[k];
      if (value === undefined) return key; // Return the key if path doesn't exist
    }

    // If the value is not a string, return the key
    if (typeof value !== 'string') return key;

    // Replace placeholders like {name} with their values
    return value.replace(/{([^}]+)}/g, (_, name) => {
      return replacements[name] || `{${name}}`;
    });
  }, [translations]);

  return { t, isLoading };
} 