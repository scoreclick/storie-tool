import { Geist, Geist_Mono } from "next/font/google";
import "../globals.css";
import { getDictionary } from "@/dictionaries";
import { LanguageProvider } from "@/contexts/language-context";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata({ params }) {
  // Get dictionary based on the locale
  const { lang } = await params;
  const dict = await getDictionary(lang);

  return {
    title: dict.metadata.title,
    description: dict.metadata.description,
    metadataBase: new URL('https://score-click.com'),
  };
}

export default async function RootLayout({ children, params }) {
  const { lang } = await params;
  
  return (
    <LanguageProvider lang={lang}>
      {children}
    </LanguageProvider>
  );
} 