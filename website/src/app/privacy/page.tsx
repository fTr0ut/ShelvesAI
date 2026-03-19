import Link from "next/link";
import styles from "../page.module.css";

export default function PrivacyPolicy() {
  return (
    <main className={styles.hero} style={{ minHeight: "100vh", padding: "4rem 2rem", textAlign: "left", alignItems: "flex-start" }}>
      <header className={`${styles.header} animate-fade-in`} style={{ width: "100%", justifyContent: "flex-start", marginBottom: "3rem" }}>
        <Link href="/" className={styles.brand} style={{ textDecoration: "none" }}>
          <span>&larr; Back to Home</span>
        </Link>
      </header>

      <div className="animate-fade-in stagger-1" style={{ maxWidth: "800px", margin: "0 auto", background: "rgba(255, 255, 255, 0.05)", padding: "3rem", borderRadius: "16px", backdropFilter: "blur(10px)" }}>
        <h1 style={{ fontSize: "2.5rem", marginBottom: "1rem", color: "var(--text-primary, #fff)" }}>Privacy Policy</h1>
        <p style={{ color: "var(--text-secondary, #a1a1aa)", marginBottom: "2rem" }}>Last Updated: March 19, 2026</p>

        <section style={{ marginBottom: "2rem" }}>
          <h2 style={{ fontSize: "1.5rem", marginBottom: "1rem", color: "var(--text-primary, #fff)" }}>1. Introduction</h2>
          <p style={{ color: "var(--text-secondary, #a1a1aa)", lineHeight: "1.6" }}>
            Welcome to ShelvesAI. This Privacy Policy explains how we collect, use, and protect your information when you use our mobile application, website, and related services to organize and track your physical collections.
          </p>
        </section>

        <section style={{ marginBottom: "2rem" }}>
          <h2 style={{ fontSize: "1.5rem", marginBottom: "1rem", color: "var(--text-primary, #fff)" }}>2. Information We Collect</h2>
          <p style={{ color: "var(--text-secondary, #a1a1aa)", lineHeight: "1.6", marginBottom: "1rem" }}>
            We collect the following types of information to provide and improve our services:
          </p>
          <ul style={{ color: "var(--text-secondary, #a1a1aa)", lineHeight: "1.6", paddingLeft: "1.5rem" }}>
            <li style={{ marginBottom: "0.5rem" }}>
              <strong style={{ color: "var(--text-primary, #fff)" }}>Account Information:</strong> When you create an account, we collect your email address, password, and username, and optionally a profile picture.
            </li>
            <li style={{ marginBottom: "0.5rem" }}>
              <strong style={{ color: "var(--text-primary, #fff)" }}>Your Collections & Media:</strong> We store data about the physical media you track, including books, movies, games, vinyl, and TV shows. This involves your custom shelves, wishlists, favorites, and lists.
            </li>
            <li style={{ marginBottom: "0.5rem" }}>
              <strong style={{ color: "var(--text-primary, #fff)" }}>Manual Entries & Photos:</strong> When manually adding items, we collect the details you provide (such as item condition, age statements, barcodes, edition details) and photos you upload for cover media or identification.
            </li>
            <li style={{ marginBottom: "0.5rem" }}>
              <strong style={{ color: "var(--text-primary, #fff)" }}>Social & Activity Data:</strong> If you use our social features, we collect data on your friendships, ratings, check-ins, event logs, likes, and comments. This data's visibility is subject to your privacy settings (Private, Friends, or Public).
            </li>
            <li style={{ marginBottom: "0.5rem" }}>
              <strong style={{ color: "var(--text-primary, #fff)" }}>Device & App Usage:</strong> We collect push notification device tokens to send you alerts, as well as your notification preferences. We also track which news items you have seen or dismissed.
            </li>
            <li style={{ marginBottom: "0.5rem" }}>
              <strong style={{ color: "var(--text-primary, #fff)" }}>Vision AI Processing:</strong> To automatically identify items from photos, we process images you upload through our Vision AI pipeline.
            </li>
          </ul>
        </section>

        <section style={{ marginBottom: "2rem" }}>
          <h2 style={{ fontSize: "1.5rem", marginBottom: "1rem", color: "var(--text-primary, #fff)" }}>3. How We Use Your Information</h2>
          <ul style={{ color: "var(--text-secondary, #a1a1aa)", lineHeight: "1.6", paddingLeft: "1.5rem" }}>
            <li style={{ marginBottom: "0.5rem" }}>To provide, maintain, and improve the ShelvesAI platform.</li>
            <li style={{ marginBottom: "0.5rem" }}>To identify your collectables automatically from images via our AI pipeline.</li>
            <li style={{ marginBottom: "0.5rem" }}>To enable social interactions between you and your friends based on your visibility settings.</li>
            <li style={{ marginBottom: "0.5rem" }}>To send you push notifications, password reset emails, and account alerts.</li>
          </ul>
        </section>

        <section style={{ marginBottom: "2rem" }}>
          <h2 style={{ fontSize: "1.5rem", marginBottom: "1rem", color: "var(--text-primary, #fff)" }}>4. Information Sharing</h2>
          <p style={{ color: "var(--text-secondary, #a1a1aa)", lineHeight: "1.6", marginBottom: "1rem" }}>
            We do not sell your personal data. We share data with third-party service providers (like Google Gemini for image recognition and AWS for media storage) strictly to operate our services. Social data is shared with other users based entirely on the visibility tier you configure.
          </p>
        </section>

        <section style={{ marginBottom: "2rem" }}>
          <h2 style={{ fontSize: "1.5rem", marginBottom: "1rem", color: "var(--text-primary, #fff)" }}>5. Data Retention & Deletion</h2>
          <p style={{ color: "var(--text-secondary, #a1a1aa)", lineHeight: "1.6" }}>
            We retain your data as long as your account is active. You can request to delete your account and all associated data by contacting our support team or using the account deletion feature within the app.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: "1.5rem", marginBottom: "1rem", color: "var(--text-primary, #fff)" }}>6. Contact Us</h2>
          <p style={{ color: "var(--text-secondary, #a1a1aa)", lineHeight: "1.6" }}>
            If you have any questions or concerns about this Privacy Policy or your data, please contact us at <strong>support@shelvesai.com</strong>.
          </p>
        </section>
      </div>
    </main>
  );
}
