import type { Metadata } from "next";
import CategoryPage from "../components/CategoryPage";

export const metadata: Metadata = {
  title: "Collectibles Inventory App",
  description: "Track your memorabilia and unique items with this collectibles inventory app.",
  alternates: { canonical: '/collectibles' },
  openGraph: { title: "Collectibles Inventory App", url: '/collectibles' },
  twitter: { title: "Collectibles Inventory App" },
  keywords: "collectibles inventory app, memorabilia catalog",
};

export default function CollectiblesPage() {
  return (
    <CategoryPage
      title="Collectibles Inventory App"
      subtitle="Catalog Your Precious Memorabilia"
      description="From action figures to trading cards and vintage toys, keep a pristine digital record of your most valuable items."
      features={[
        { title: "Custom Entries", description: "Add photos and unique notes for items that are one-of-a-kind." },
        { title: "Condition Tracking", description: "Mark the condition, purchase date, and rarity of each item." },
        { title: "Visual Showcase", description: "Create a beautiful visual gallery of your prized possessions." }
      ]}
      ctaText="Start Your Inventory"
      relatedCategories={[
        { title: "Video Games", href: "/video-games" },
        { title: "Books", href: "/books" }
      ]}
    />
  );
}
