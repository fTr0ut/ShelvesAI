import type { Metadata } from "next";
import CategoryPage from "../components/CategoryPage";

export const metadata: Metadata = {
  title: "Video Game Collection Tracker",
  description: "Log your retro cartridges and modern discs to build an ultimate catalog of your video game collection.",
  alternates: { canonical: '/video-games' },
  openGraph: { title: "Video Game Collection Tracker", url: '/video-games' },
  twitter: { title: "Video Game Collection Tracker" },
  keywords: "video game collection tracker, retro game catalog",
};

export default function VideoGamesPage() {
  return (
    <CategoryPage
      title="Video Game Collection Tracker"
      subtitle="Build Your Ultimate Gaming Catalog"
      description="Track every game you own, from classic retro cartridges to modern digital releases. Organize your entire gaming history in one place."
      features={[
        { title: "Retro & Modern Support", description: "Seamlessly log games across all console generations." },
        { title: "Detailed Game Info", description: "Instantly retrieve release dates, developers, and platform details." },
        { title: "Track Your Backlog", description: "Mark games as completed, playing, or in your backlog." }
      ]}
      ctaText="Track Your Games"
      relatedCategories={[
        { title: "Collectibles", href: "/collectibles" },
        { title: "Books", href: "/books" }
      ]}
    />
  );
}
