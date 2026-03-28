import type { Metadata } from "next";

export type ShareKind = "collectables" | "manuals" | "shelves" | "events";
export type ShareVisibility = "public" | "restricted" | "not_found";

export type SharePayload = {
  visibility: ShareVisibility;
  entityType: string;
  id: string | null;
  slug: string;
  title: string;
  description: string;
  imageUrl: string | null;
  canonicalUrl: string;
  appUrl: string;
};

type ShareRequest = {
  kind: ShareKind;
  id: string;
  slug: string;
};

const DEFAULT_SITE_BASE = "https://shelvesai.com";
const DEFAULT_API_BASE = "https://api.shelvesai.com";
const DEFAULT_OG_IMAGE = "/og-image.png";

function trimTrailingSlash(value: string | undefined): string {
  return (value || "").trim().replace(/\/+$/, "");
}

function getSiteBase(): string {
  return trimTrailingSlash(process.env.NEXT_PUBLIC_SITE_URL) || DEFAULT_SITE_BASE;
}

function getApiBase(): string {
  return trimTrailingSlash(process.env.API_BASE || process.env.NEXT_PUBLIC_API_BASE) || DEFAULT_API_BASE;
}

function isAbsoluteUrl(value: string | null | undefined): boolean {
  return /^https?:\/\//i.test(String(value || ""));
}

function toAbsoluteUrl(value: string | null, base: string): string | null {
  if (!value) return null;
  if (isAbsoluteUrl(value)) return value;
  if (!value.startsWith("/")) return `${base}/${value}`;
  return `${base}${value}`;
}

function fallbackPath(kind: ShareKind, id: string, slug: string): string {
  return `app/${kind}/${encodeURIComponent(id)}/${encodeURIComponent(slug || "shared")}`;
}

function defaultPayload({ kind, id, slug }: ShareRequest): SharePayload {
  const siteBase = getSiteBase();
  const path = fallbackPath(kind, id, slug);
  return {
    visibility: "restricted",
    entityType: kind.slice(0, -1),
    id,
    slug: slug || "shared",
    title: "Shared on ShelvesAI",
    description: "Open this link in the ShelvesAI app.",
    imageUrl: `${siteBase}${DEFAULT_OG_IMAGE}`,
    canonicalUrl: `${siteBase}/${path}`,
    appUrl: `shelvesai://${path}`,
  };
}

function normalizePayload(raw: unknown, fallback: SharePayload): SharePayload {
  if (!raw || typeof raw !== "object") return fallback;
  const value = raw as Partial<SharePayload>;
  const siteBase = getSiteBase();
  const apiBase = getApiBase();
  const canonicalUrl = toAbsoluteUrl(value.canonicalUrl || fallback.canonicalUrl, siteBase) || fallback.canonicalUrl;
  return {
    visibility: (value.visibility as ShareVisibility) || fallback.visibility,
    entityType: value.entityType || fallback.entityType,
    id: value.id == null ? fallback.id : String(value.id),
    slug: value.slug || fallback.slug,
    title: value.title || fallback.title,
    description: value.description || fallback.description,
    imageUrl: toAbsoluteUrl(value.imageUrl || fallback.imageUrl, value.imageUrl?.startsWith("/media/") ? apiBase : siteBase),
    canonicalUrl,
    appUrl: value.appUrl || fallback.appUrl,
  };
}

export async function fetchSharePayload(request: ShareRequest): Promise<SharePayload> {
  const fallback = defaultPayload(request);
  const apiBase = getApiBase();
  const url = `${apiBase}/api/share/${request.kind}/${encodeURIComponent(request.id)}`;

  try {
    const response = await fetch(url, { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    return normalizePayload(payload, fallback);
  } catch {
    return fallback;
  }
}

export function buildShareMetadata(payload: SharePayload): Metadata {
  const siteBase = getSiteBase();
  const ogImage = payload.imageUrl || `${siteBase}${DEFAULT_OG_IMAGE}`;
  return {
    title: payload.title,
    description: payload.description,
    alternates: {
      canonical: payload.canonicalUrl,
    },
    openGraph: {
      title: payload.title,
      description: payload.description,
      type: "website",
      images: [ogImage],
      url: payload.canonicalUrl,
      siteName: "ShelvesAI",
    },
    twitter: {
      card: "summary_large_image",
      title: payload.title,
      description: payload.description,
      images: [ogImage],
    },
  };
}
