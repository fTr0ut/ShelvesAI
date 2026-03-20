import type { Metadata } from "next";
import CategoryPage from "../components/CategoryPage";

export const metadata: Metadata = {
  title: "Vinyl Record Collection App",
  description: "Organize, track, and share your vinyl records. The perfect vinyl collection app for serious collectors.",
  alternates: { canonical: '/vinyl' },
  openGraph: { title: "Vinyl Record Collection App", url: '/vinyl' },
  twitter: { title: "Vinyl Record Collection App" },
  keywords: "vinyl collection app, vinyl record catalog",
};

export default function VinylPage() {
  return (
    <CategoryPage
      title="Vinyl Record Collection App"
      subtitle="Digitize Your Record Collection"
      description="Keep track of your physical music collection. Catalog every LP, EP, and single with ease."
      features={[
        { title: "Quick Cataloging", description: "Snap photos of album covers or barcodes to add records to your database." },
        { title: "Release Specifics", description: "Store pressing details, condition notes, and release years." },
        { title: "Share Your Taste", description: "Show off your curated music collection with friends." }
      ]}
      ctaText="Organize Your Vinyl"
      relatedCategories={[
        { title: "Movies", href: "/movies" },
        { title: "Collectibles", href: "/collectibles" }
      ]}
    />
  );
}
