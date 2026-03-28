import type { Metadata } from "next";
import Link from "next/link";
import styles from "./download.module.css";

const iosStoreUrl = (process.env.NEXT_PUBLIC_IOS_STORE_URL || "").trim();
const androidStoreUrl = (process.env.NEXT_PUBLIC_ANDROID_STORE_URL || "").trim();

export const metadata: Metadata = {
  title: "Download ShelvesAI",
  description: "Get ShelvesAI on iOS and Android.",
};

export default function DownloadPage() {
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <p className={styles.eyebrow}>ShelvesAI</p>
        <h1 className={styles.title}>Download the app</h1>
        <p className={styles.description}>
          Store links will appear here once the public releases are available.
        </p>
        <div className={styles.actions}>
          {iosStoreUrl ? (
            <a className={`${styles.button} ${styles.buttonPrimary}`} href={iosStoreUrl}>
              Open in App Store
            </a>
          ) : null}
          {androidStoreUrl ? (
            <a className={`${styles.button} ${styles.buttonPrimary}`} href={androidStoreUrl}>
              Open in Google Play
            </a>
          ) : null}
          {!iosStoreUrl && !androidStoreUrl ? (
            <p className={styles.hint}>
              iOS and Android links are not published yet.
            </p>
          ) : null}
          <Link className={styles.button} href="/">
            Back to ShelvesAI
          </Link>
        </div>
      </section>
    </main>
  );
}
