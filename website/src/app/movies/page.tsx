import type { Metadata } from "next";
import CategoryPage from "../components/CategoryPage";

export const metadata: Metadata = {
  title: "Movie Collection App",
  description: "Automatically retrieve release years, directors, and formats for all your physical media in this movie collection app.",
  alternates: { canonical: '/movies' },
  openGraph: { title: "Movie Collection App", url: '/movies' },
  twitter: { title: "Movie Collection App" },
  keywords: "movie collection app, blu-ray collection tracker",
};

export default function MoviesPage() {
  return (
    <CategoryPage
      title="Movie Collection App"
      subtitle="Track Your DVDs, Blu-rays, and 4K UHDs"
      description="Create a searchable digital copy of your entire physical movie collection. Never wonder what to watch next."
      features={[
        { title: "Comprehensive Database", description: "Automatically pull in cast, crew, and synopsis information." },
        { title: "Format Tracking", description: "Easily distinguish between DVD, Blu-ray, and 4K versions." },
        { title: "Organize by Genre", description: "Sort and filter your movies by genre, director, or runtime." }
      ]}
      ctaText="Catalog Your Movies"
      relatedCategories={[
        { title: "Vinyl", href: "/vinyl" },
        { title: "Video Games", href: "/video-games" }
      ]}
    />
  );
}
