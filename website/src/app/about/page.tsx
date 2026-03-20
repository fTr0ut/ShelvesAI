import type { Metadata } from "next";
import CategoryPage from "../components/CategoryPage";

export const metadata: Metadata = {
  title: "About ShelvesAI",
  description: "Learn more about the team behind the ultimate collection catalog app.",
  alternates: { canonical: '/about' },
  openGraph: { title: "About ShelvesAI", url: '/about' },
  twitter: { title: "About ShelvesAI" },
  keywords: "ShelvesAI, collection catalog app",
};

export default function AboutPage() {
  return (
    <CategoryPage
      title="About ShelvesAI"
      subtitle="Built for Collectors"
      description="We believe that physical collections are special. We're building the perfect tool to help you preserve, enjoy, and share the items you love."
      features={[
        { title: "Our Mission", description: "To make cataloging effortless so you can focus on enjoying your collections." },
        { title: "Privacy First", description: "Your data is yours. Keep your collections private or share them on your own terms." },
        { title: "Community Driven", description: "We're building features based directly on feedback from passionate collectors." }
      ]}
      ctaText="Get Early Access"
      relatedCategories={[
        { title: "How It Works", href: "/how-it-works" },
        { title: "Books", href: "/books" }
      ]}
    />
  );
}
