import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import content from "../content.json";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    template: "%s | ShelvesAI",
    default: content.seo.title,
  },
  description: content.seo.description,
  metadataBase: new URL(content.seo.siteUrl),
  openGraph: {
    description: content.seo.description,
    siteName: "ShelvesAI",
    images: [
      {
        url: content.seo.ogImage,
        width: 1200,
        height: 630,
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    description: content.seo.description,
    images: [content.seo.ogImage],
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "ShelvesAI",
    url: content.seo.siteUrl,
    applicationCategory: "LifestyleApplication",
    operatingSystem: "Any",
    description: content.seo.description,
  };

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className} suppressHydrationWarning>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {children}
      </body>
    </html>
  );
}
