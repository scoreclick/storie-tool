'use server';

import 'server-only';
import { locales, defaultLocale } from './config';

// Dictionary imports
const dictionaries = {
  'en-US': () => import('./en-US.json').then((module) => module.default),
  'pt-BR': () => import('./pt-BR.json').then((module) => module.default),
  'es': () => import('./es.json').then((module) => module.default),
};

export async function getDictionary(locale) {
  // If the locale is not supported, fall back to default
  if (!locales.includes(locale)) {
    locale = defaultLocale;
  }
  
  return dictionaries[locale]();
} 