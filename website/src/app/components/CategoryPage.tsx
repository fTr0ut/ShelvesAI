import React from "react";
import WaitlistForm from "../WaitlistForm";
import styles from "./category-page.module.css";
import homeStyles from "../page.module.css";
import Link from "next/link";
import Image from "next/image";
import content from "../../content.json";

interface Feature {
  title: string;
  description: string;
}

interface CategoryPageProps {
  title: string;
  subtitle: string;
  description: string;
  features: Feature[];
  ctaText: string;
  relatedCategories: { title: string; href: string }[];
}

export default function CategoryPage({
  title,
  subtitle,
  description,
  features,
  ctaText,
  relatedCategories
}: CategoryPageProps) {
  return (
    <main className={styles.hero}>
      <header className={`${homeStyles.header} animate-fade-in`} style={{ flexWrap: "wrap", gap: "1rem" }}>
        <Link href="/" className={homeStyles.brand} style={{ textDecoration: "none" }}>
          <div className={homeStyles.brandLogoBox} style={{ overflow: 'hidden' }}>
            <Image src="/logo.png" alt="ShelvesAI Logo" width={44} height={44} style={{ objectFit: 'cover' }} />
          </div>
          <span>{content.brand.name}</span>
        </Link>
        <nav style={{ display: "flex", alignItems: "center", gap: "1.5rem", flexWrap: "wrap", justifyContent: "center" }}>
          <Link href="/books" style={{ color: "var(--text-secondary, #a1a1aa)", textDecoration: "none", fontSize: "0.875rem", fontWeight: 500 }}>Books</Link>
          <Link href="/video-games" style={{ color: "var(--text-secondary, #a1a1aa)", textDecoration: "none", fontSize: "0.875rem", fontWeight: 500 }}>Video Games</Link>
          <Link href="/vinyl" style={{ color: "var(--text-secondary, #a1a1aa)", textDecoration: "none", fontSize: "0.875rem", fontWeight: 500 }}>Vinyl</Link>
          <Link href="/movies" style={{ color: "var(--text-secondary, #a1a1aa)", textDecoration: "none", fontSize: "0.875rem", fontWeight: 500 }}>Movies</Link>
          <Link href="/collectibles" style={{ color: "var(--text-secondary, #a1a1aa)", textDecoration: "none", fontSize: "0.875rem", fontWeight: 500 }}>Collectibles</Link>
          <Link href="/how-it-works" style={{ color: "var(--text-secondary, #a1a1aa)", textDecoration: "none", fontSize: "0.875rem", fontWeight: 500 }}>How It Works</Link>
          <Link href="/about" style={{ color: "var(--text-secondary, #a1a1aa)", textDecoration: "none", fontSize: "0.875rem", fontWeight: 500 }}>About</Link>
        </nav>
      </header>

      <div className={styles.heroContent}>
        <h1 className={`${styles.title} animate-fade-in`}>{title}</h1>
        <p className={`${styles.subtitle} animate-fade-in`} style={{ fontSize: "1.5rem", fontWeight: "bold", color: "var(--foreground)" }}>{subtitle}</p>
        <p className={`${styles.subtitle} animate-fade-in`}>{description}</p>
      </div>

      <div className={`${styles.featuresGrid} animate-fade-in`}>
        {features.map((feature, i) => (
          <div key={i} className={styles.featureCard}>
            <h3 className={styles.featureTitle}>{feature.title}</h3>
            <p className={styles.featureDesc}>{feature.description}</p>
          </div>
        ))}
      </div>

      <div className={`${styles.howItWorks} animate-fade-in`}>
        <h2>How It Works</h2>
        <div className={styles.steps}>
          <div className={styles.step}>
            <div className={styles.stepNumber}>1</div>
            <h3 className={styles.stepTitle}>Scan</h3>
            <p className={styles.stepDesc}>Simply point your camera at your items to capture them.</p>
          </div>
          <div className={styles.step}>
            <div className={styles.stepNumber}>2</div>
            <h3 className={styles.stepTitle}>Organize</h3>
            <p className={styles.stepDesc}>Details and metadata are automatically retrieved and organized.</p>
          </div>
          <div className={styles.step}>
            <div className={styles.stepNumber}>3</div>
            <h3 className={styles.stepTitle}>Search</h3>
            <p className={styles.stepDesc}>Easily search, manage, and share your newly digitized collection.</p>
          </div>
        </div>
      </div>

      <div className={`${styles.ctaSection} animate-fade-in`}>
        <WaitlistForm ctaLabel={ctaText} />
      </div>

      <div style={{ marginTop: "6rem", textAlign: "center" }} className="animate-fade-in">
        <h3 style={{ marginBottom: "1.5rem", color: "var(--text-secondary)" }}>Explore More</h3>
        <div style={{ display: "flex", gap: "1.5rem", justifyContent: "center", flexWrap: "wrap" }}>
          {relatedCategories.map((cat, i) => (
            <Link key={i} href={cat.href} style={{ color: "var(--text-secondary)", textDecoration: "underline" }}>
              {cat.title}
            </Link>
          ))}
          <Link href="/" style={{ color: "var(--text-secondary)", textDecoration: "underline" }}>Back to Home</Link>
        </div>
      </div>
    </main>
  );
}
