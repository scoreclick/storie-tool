'use client';

import { useCallback, useEffect, useState } from 'react';

// This is a client-side implementation that will load the translations
export function useTranslations(locale) {
  const [translations, setTranslations] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Dynamically import the translation file based on the locale
    const loadTranslations = async () => {
      console.log(`Loading translations for locale: ${locale}`);
      setIsLoading(true);
      try {
        // Import the translation dictionary dynamically
        const dictionary = await import(`@/dictionaries/${locale}.json`);
        console.log('Loaded translations:', dictionary.default);
        setTranslations(dictionary.default);
      } catch (error) {
        console.error(`Failed to load translations for ${locale}:`, error);
        // Fallback to English if the translation file doesn't exist
        const fallback = await import('@/dictionaries/en-US.json');
        console.log('Fallback to English translations:', fallback.default);
        setTranslations(fallback.default);
      } finally {
        setIsLoading(false);
      }
    };

    loadTranslations();
  }, [locale]);

  // Function to get a translation by key (supports nested paths like 'home.title')
  const t = useCallback((key, replacements = {}) => {
    if (!translations) {
      console.log(`Translation not found for key "${key}" (translations not loaded yet)`);
      return key; // Return the key if translations aren't loaded yet
    }

    // Split the key by dots to access nested properties
    const keys = key.split('.');
    let value = translations;

    // Navigate through the nested structure
    for (const k of keys) {
      value = value?.[k];
      if (value === undefined) {
        console.log(`Translation not found for key "${key}" at part "${k}"`);
        return key; // Return the key if path doesn't exist
      }
    }

    // If the value is not a string, return the key
    if (typeof value !== 'string') {
      console.log(`Translation for key "${key}" is not a string:`, value);
      return key;
    }

    // Replace placeholders like {name} with their values
    return value.replace(/{([^}]+)}/g, (_, name) => {
      return replacements[name] || `{${name}}`;
    });
  }, [translations]);

  return { t, isLoading };
} 