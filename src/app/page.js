import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { defaultLocale } from '@/dictionaries/config';

export default async function Home({ searchParams }) {
  const headersList = await headers();
  const locale = headersList.get('x-middleware-lang') || defaultLocale;
  
  // Build the redirect URL with preserved search parameters
  const params = await searchParams;
  const queryString = new URLSearchParams(params).toString();
  const redirectUrl = `/${locale}${queryString ? `?${queryString}` : ''}`;
  
  redirect(redirectUrl);
}
