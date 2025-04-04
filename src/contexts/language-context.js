'use client';

import { createContext, useContext } from 'react';

// Create context with null default value
const LanguageContext = createContext(null);

/**
 * Provider component for language context
 * @param {Object} props - Component props
 * @param {string} props.lang - Current language code
 * @param {React.ReactNode} props.children - Child components
 * @returns {JSX.Element} Context provider
 */
export function LanguageProvider({ lang, children }) {
  return (
    <LanguageContext.Provider value={lang}>
      {children}
    </LanguageContext.Provider>
  );
}

/**
 * Hook to access the current language
 * @returns {string} Current language code
 */
export function useLanguage() {
  const lang = useContext(LanguageContext);
  if (lang === null) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return lang;
} 