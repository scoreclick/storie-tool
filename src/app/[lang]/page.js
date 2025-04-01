import HomeClient from '@/components/home-client';

export default async function Home({ params }) {
  const { lang } = await params;
  return <HomeClient lang={lang} />;
} 