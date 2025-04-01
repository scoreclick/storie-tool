import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { headers } from 'next/headers';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "Storie Tool By Score Click",
  description: "Transform your horizontal video, to a vertical Storie video, controlling the camera with your finger.",
};

export default async function RootLayout({ children }) {
  const headersList = await headers();
  const lang = headersList.get('x-middleware-lang') || 'en';
  
  return (
    <html lang={lang} suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}

// Prevent Next.js from revalidating this layout on every request
export const revalidate = false;
