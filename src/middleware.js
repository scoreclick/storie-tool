import { NextResponse } from 'next/server';
import { match } from '@formatjs/intl-localematcher';
import Negotiator from 'negotiator';
import { locales, defaultLocale } from './dictionaries/config';

function getLocale(request) {
  // Negotiator expects a plain object so we transform headers
  const headers = Object.fromEntries(request.headers.entries());
  const languages = new Negotiator({ headers }).languages();
  
  try {
    return match(languages, locales, defaultLocale);
  } catch (error) {
    return defaultLocale;
  }
}

export function middleware(request) {
  // Get pathname
  const { pathname } = request.nextUrl;
  
  // Skip if it's an API call, resource, or file
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.includes('/.')
  ) {
    return;
  }
  
  // Check if there is already a locale in the pathname
  const pathnameHasLocale = locales.some(
    (locale) => pathname.startsWith(`/${locale}/`) || pathname === `/${locale}`
  );
  
  if (pathnameHasLocale) {
    // Get the locale from the pathname
    const locale = pathname.split('/')[1];
    
    // Update response with HTML lang attribute
    const response = NextResponse.next();
    response.headers.set('x-middleware-lang', locale);
    
    return response;
  }
  
  // Get the preferred locale
  const locale = getLocale(request);
  
  // Set cookie with the locale for client-side access (for the language switcher)
  const response = NextResponse.redirect(
    new URL(`/${locale}${pathname === '/' ? '' : pathname}`, request.url)
  );
  
  response.cookies.set('NEXT_LOCALE', locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365, // 1 year
  });
  
  // Set the HTML lang attribute
  response.headers.set('x-middleware-lang', locale);
  
  return response;
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
}; 