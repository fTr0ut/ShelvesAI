import type { Metadata } from "next";
import Image from "next/image";
import content from "../content.json";
import styles from "./page.module.css";

const Icons = {
  library: (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m16 6 4 14" /><path d="M12 6v14" /><path d="M8 8v12" /><path d="M4 4v16" /></svg>
  ),
  book: (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" /></svg>
  ),
  movie: (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M7 3v18" /><path d="M3 7.5h4" /><path d="M3 12h18" /><path d="M3 16.5h4" /><path d="M17 3v18" /><path d="M17 7.5h4" /><path d="M17 16.5h4" /></svg>
  ),
  gamepad: (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="6" x2="10" y1="12" y2="12" /><line x1="8" x2="8" y1="10" y2="14" /><line x1="15" x2="15.01" y1="13" y2="13" /><line x1="18" x2="18.01" y1="11" y2="11" /><rect width="20" height="12" x="2" y="6" rx="2" /></svg>
  ),
  sparkles: (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" /></svg>
  ),
  shield: (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /></svg>
  ),
  globe: (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /><path d="M2 12h20" /></svg>
  )
};

export default function Home() {
  return (
    <main className={styles.hero}>
      <header className={`${styles.header} animate-fade-in`}>
        <div className={styles.brand}>
          <div className={styles.brandLogoBox} style={{ overflow: 'hidden' }}>
            <Image src="/logo.png" alt="ShelvesAI Logo" width={44} height={44} style={{ objectFit: 'cover' }} />
          </div>
          <span>{content.brand.name}</span>
        </div>
      </header>



      <div className={styles.heroContent}>
        <div className={`${styles.badge} animate-fade-in`}>
          {content.hero.badge}
        </div>

        <h1 className={`${styles.title} animate-fade-in stagger-1`}>
          <span className="text-gradient">Your physical collections,</span><br />
          magically organized.
        </h1>

        <p className={`${styles.subtitle} animate-fade-in stagger-2`}>
          {content.hero.subtitle}
        </p>

        <div className="animate-fade-in stagger-3">
          <button className="btn-primary">
            {content.hero.cta}
          </button>
        </div>
      </div>

      <div className={`${styles.featuresGrid} animate-fade-in stagger-3`}>
        {content.features.map((feature, i) => (
          <div key={i} className={styles.featureCard}>
            <div className={styles.featureIcon}>
              {Icons[feature.icon as keyof typeof Icons]}
            </div>
            <h3 className={styles.featureTitle}>{feature.title}</h3>
            <p className={styles.featureDesc}>{feature.description}</p>
          </div>
        ))}
      </div>

      <footer className={styles.footer}>
        {content.footer.text}
      </footer>
    </main>
  );
}
