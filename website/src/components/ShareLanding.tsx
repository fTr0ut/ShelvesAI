import Link from "next/link";
import Image from "next/image";
import ShareFallbackRedirect from "./ShareFallbackRedirect";
import styles from "./ShareLanding.module.css";
import type { SharePayload } from "@/lib/shareMetadata";

type ShareLandingProps = {
  payload: SharePayload;
};

export default function ShareLanding({ payload }: ShareLandingProps) {
  const locked = payload.visibility !== "public";
  const iosStoreUrl = process.env.NEXT_PUBLIC_IOS_STORE_URL || "";
  const androidStoreUrl = process.env.NEXT_PUBLIC_ANDROID_STORE_URL || "";

  return (
    <main className={styles.page}>
      <ShareFallbackRedirect
        appUrl={payload.appUrl}
        iosStoreUrl={iosStoreUrl}
        androidStoreUrl={androidStoreUrl}
        downloadUrl="/download"
      />
      <article className={styles.card}>
        {payload.imageUrl ? (
          <Image
            className={styles.previewImage}
            src={payload.imageUrl}
            alt={payload.title}
            width={1200}
            height={630}
            unoptimized
          />
        ) : null}
        <div className={styles.body}>
          <p className={`${styles.status} ${locked ? styles.statusLocked : ""}`}>
            {locked ? "Private Share" : "Shared from ShelvesAI"}
          </p>
          <h1 className={styles.title}>{payload.title}</h1>
          <p className={styles.description}>{payload.description}</p>
          <div className={styles.actions}>
            <a className={styles.primaryButton} href={payload.appUrl}>
              Open in app
            </a>
            <Link className={styles.secondaryButton} href="/download">
              Download app
            </Link>
          </div>
          <p className={styles.hint}>
            If the app does not open automatically, use the download option.
          </p>
        </div>
      </article>
    </main>
  );
}
