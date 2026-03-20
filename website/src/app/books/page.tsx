import type { Metadata } from "next";
import CategoryPage from "../components/CategoryPage";

export const metadata: Metadata = {
  title: "Book Collection App",
  description: "Organize and catalog your home library easily. The ultimate book collection app to scan and track your books.",
  alternates: { canonical: '/books' },
  openGraph: { title: "Book Collection App", url: '/books' },
  twitter: { title: "Book Collection App" },
  keywords: "book collection app, catalog home library, scan bookshelf",
};

export default function BooksPage() {
  return (
    <CategoryPage
      title="Book Collection App"
      subtitle="Catalog Your Home Library"
      description="Keep track of every book you own. Scan your bookshelf to instantly recognize titles, authors, and editions."
      features={[
        { title: "Instant Book Recognition", description: "Snap a photo of your shelves to digitize your library." },
        { title: "Author & Edition Tracking", description: "Automatically fetch accurate metadata for every book in your collection." },
        { title: "Searchable Inventory", description: "Never buy a duplicate copy again with a fully searchable catalog." }
      ]}
      ctaText="Start Your Book Catalog"
      relatedCategories={[
        { title: "Movies", href: "/movies" },
        { title: "Video Games", href: "/video-games" }
      ]}
    />
  );
}
