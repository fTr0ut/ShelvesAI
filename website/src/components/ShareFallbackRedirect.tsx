"use client";

import { useEffect } from "react";

type ShareFallbackRedirectProps = {
  appUrl: string;
  iosStoreUrl?: string;
  androidStoreUrl?: string;
  downloadUrl?: string;
};

function detectPlatform() {
  const ua = navigator.userAgent || "";
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  return "other";
}

export default function ShareFallbackRedirect({
  appUrl,
  iosStoreUrl = "",
  androidStoreUrl = "",
  downloadUrl = "/download",
}: ShareFallbackRedirectProps) {
  useEffect(() => {
    if (!appUrl || typeof window === "undefined" || typeof document === "undefined") return;

    const platform = detectPlatform();
    if (platform === "other") {
      window.location.replace(downloadUrl);
      return;
    }

    let appOpened = false;
    const visibilityHandler = () => {
      if (document.hidden) appOpened = true;
    };
    document.addEventListener("visibilitychange", visibilityHandler);

    const launchTimer = window.setTimeout(() => {
      window.location.assign(appUrl);
    }, 100);

    const fallbackTimer = window.setTimeout(() => {
      if (appOpened) return;
      const storeUrl = platform === "ios" ? iosStoreUrl : androidStoreUrl;
      if (storeUrl) {
        window.location.replace(storeUrl);
        return;
      }
      window.location.replace(downloadUrl);
    }, 1600);

    return () => {
      window.clearTimeout(launchTimer);
      window.clearTimeout(fallbackTimer);
      document.removeEventListener("visibilitychange", visibilityHandler);
    };
  }, [appUrl, iosStoreUrl, androidStoreUrl, downloadUrl]);

  return null;
}
