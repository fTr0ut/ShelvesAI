import { Share, Platform } from 'react-native';

const DEFAULT_SITE_BASE = 'https://shelvesai.com';
const FALLBACK_SLUG = 'shared';

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function getSiteBase() {
  return trimTrailingSlash(process.env.EXPO_PUBLIC_SITE_URL || DEFAULT_SITE_BASE) || DEFAULT_SITE_BASE;
}

export function toShareSlug(value, fallback = FALLBACK_SLUG) {
  const normalized = String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return normalized || fallback;
}

function toEncodedSegment(value) {
  return encodeURIComponent(String(value || '').trim());
}

function toFallbackSlug(kind, id) {
  if (kind === 'profiles') return 'profile';
  const singular = String(kind || '').replace(/s$/, '') || 'shared-item';
  return `${singular}-${id || ''}`;
}

export function buildCanonicalSharePath({ kind, id, slug }) {
  const encodedId = toEncodedSegment(id);
  const encodedSlug = toEncodedSegment(slug || FALLBACK_SLUG);
  if (kind === 'profiles') {
    return `app/profiles/${encodedId}/${encodedSlug}`;
  }
  return `app/${kind}/${encodedId}/${encodedSlug}`;
}

export function buildCanonicalShareUrl({ kind, id, slug }) {
  const siteBase = getSiteBase();
  return `${siteBase}/${buildCanonicalSharePath({ kind, id, slug })}`;
}

export function getShareableEventId(entry) {
  const raw = entry?.aggregateId || entry?.id;
  const eventId = String(raw || '').trim();
  if (!eventId) return null;
  // Numeric ids map to legacy shelf-detail lookups, not shareable aggregate event ids.
  if (/^\d+$/.test(eventId)) return null;
  return eventId;
}

async function fetchSharePayload({ apiBase, kind, id }) {
  if (!apiBase || !kind || !id) return null;
  const url = `${trimTrailingSlash(apiBase)}/api/share/${kind}/${toEncodedSegment(id)}`;
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'ngrok-skip-browser-warning': 'true',
      },
    });
    const payload = await response.json().catch(() => null);
    if (!payload || typeof payload !== 'object') return null;
    return payload;
  } catch (_err) {
    return null;
  }
}

export async function shareEntityLink({
  apiBase,
  kind,
  id,
  title,
  slugSource,
  message,
}) {
  const normalizedKind = String(kind || '').trim();
  const normalizedId = String(id || '').trim();
  if (!normalizedKind || !normalizedId) {
    throw new Error('Missing share target');
  }

  const fallbackSlug = toShareSlug(
    slugSource || title || normalizedId,
    toFallbackSlug(normalizedKind, normalizedId),
  );
  const fallbackUrl = buildCanonicalShareUrl({
    kind: normalizedKind,
    id: normalizedId,
    slug: fallbackSlug,
  });
  const payload = await fetchSharePayload({
    apiBase,
    kind: normalizedKind,
    id: normalizedId,
  });

  const canonicalUrl = payload?.canonicalUrl || fallbackUrl;
  const shareTitle = payload?.title || title || 'Shared on ShelvesAI';
  const shareMessage = message || (Platform.OS === 'ios'
    ? shareTitle
    : `${shareTitle}\n${canonicalUrl}`);

  await Share.share({
    title: shareTitle,
    message: shareMessage,
    ...(Platform.OS === 'ios' && { url: canonicalUrl }),
  });

  return {
    canonicalUrl,
    shareTitle,
    visibility: payload?.visibility || 'restricted',
  };
}

