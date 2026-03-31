import type { Metadata } from "next";
import Link from "next/link";
import styles from "../page.module.css";
import Image from "next/image";
import termsData from "./termsContent.json";

export const metadata: Metadata = {
  title: "Terms of Service",
  alternates: { canonical: '/terms' },
  openGraph: {
    title: "Terms of Service",
    url: '/terms',
  },
  twitter: {
    title: "Terms of Service",
  },
};

export default function TermsOfService() {
  return (
    <main className={styles.hero} style={{ minHeight: "100vh", padding: "4rem 2rem", textAlign: "left", alignItems: "flex-start" }}>
      <header className={`${styles.header} animate-fade-in`} style={{ width: "100%", marginBottom: "3rem", flexWrap: "wrap", gap: "1rem" }}>
        <Link href="/" className={styles.brand} style={{ textDecoration: "none" }}>
          <div className={styles.brandLogoBox} style={{ overflow: 'hidden' }}>
            <Image src="/logo.png" alt="ShelvesAI Logo" width={44} height={44} style={{ objectFit: 'cover' }} />
          </div>
          <span>ShelvesAI</span>
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

      <div className="animate-fade-in stagger-1" style={{ maxWidth: "800px", margin: "0 auto", background: "rgba(255, 255, 255, 0.05)", padding: "3rem", borderRadius: "16px", backdropFilter: "blur(10px)" }}>
        <h1 style={{ fontSize: "2.5rem", marginBottom: "1rem", color: "var(--text-primary, #fff)" }}>{termsData.title}</h1>
        <p style={{ color: "var(--text-secondary, #a1a1aa)", marginBottom: "2rem" }}>Last Updated: {termsData.lastUpdated}</p>

        {termsData.sections.map((section) => (
          <section key={section.id} style={{ marginBottom: "2rem" }}>
            <h2 style={{ fontSize: "1.5rem", marginBottom: "1rem", color: "var(--text-primary, #fff)" }}>{section.title}</h2>
            
            {section.content?.map((pText, i) => (
              <p key={i} style={{ color: "var(--text-secondary, #a1a1aa)", lineHeight: "1.6", marginBottom: section.list ? "1rem" : (i === section.content.length - 1 ? "0" : "1rem") }}>
                {pText.includes("**") ? (
                  <>
                    {pText.split("**")[0]}
                    <strong style={{ color: "var(--text-primary, #fff)" }}>{pText.split("**")[1]}</strong>
                    {pText.split("**")[2]}
                  </>
                ) : (
                  pText
                )}
              </p>
            ))}

            {section.list && (
              <ul style={{ color: "var(--text-secondary, #a1a1aa)", lineHeight: "1.6", paddingLeft: "1.5rem" }}>
                {section.list.map((item, idx) => (
                  <li key={idx} style={{ marginBottom: "0.5rem" }}>
                    <strong style={{ color: "var(--text-primary, #fff)" }}>{item.title}</strong> {item.text}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}
