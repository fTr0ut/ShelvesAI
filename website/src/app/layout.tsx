import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import content from "../content.json";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: content.seo.title,
  description: content.seo.description,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className} suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
