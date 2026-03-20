import type { Metadata } from "next";
import CategoryPage from "../components/CategoryPage";

export const metadata: Metadata = {
  title: "How ShelvesAI Works",
  description: "Learn how to catalog a collection and organize your items using our collection organizer.",
  alternates: { canonical: '/how-it-works' },
  openGraph: { title: "How ShelvesAI Works", url: '/how-it-works' },
  twitter: { title: "How ShelvesAI Works" },
  keywords: "how to catalog a collection, collection organizer",
};

export default function HowItWorksPage() {
  return (
    <CategoryPage
      title="How ShelvesAI Works"
      subtitle="The Easiest Way to Organize"
      description="Getting your entire collection digitized is easier than ever. Follow these simple steps to build your modern, searchable inventory."
      features={[
        { title: "Snap a Photo", description: "No manual data entry required. Just take a picture of your shelves or individual boxes." },
        { title: "Review & Save", description: "Verify the automatically retrieved details and add your own custom tags." },
        { title: "Enjoy Your Catalog", description: "Browse, search, and share your pristine digital collection anytime, anywhere." }
      ]}
      ctaText="Join the Waitlist Now"
      relatedCategories={[
        { title: "Books", href: "/books" },
        { title: "Video Games", href: "/video-games" },
        { title: "Vinyl", href: "/vinyl" },
        { title: "Movies", href: "/movies" },
        { title: "Collectibles", href: "/collectibles" }
      ]}
    />
  );
}
