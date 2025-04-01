import Link from 'next/link';
import { defaultLocale } from '@/dictionaries/config';

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      <h2 className="text-2xl font-bold mb-4">404 - Page Not Found</h2>
      <p className="mb-4">The page you are looking for does not exist.</p>
      <Link
        href={`/${defaultLocale}`}
        className="text-blue-500 hover:text-blue-700 underline"
      >
        Return to Home
      </Link>
    </div>
  );
} 