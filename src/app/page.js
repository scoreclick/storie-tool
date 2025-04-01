import { redirect } from 'next/navigation';
import { defaultLocale } from '@/dictionaries/config';

export default function Home() {
  redirect(`/${defaultLocale}`);
}
