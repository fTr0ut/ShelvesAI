const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const fetch = require('node-fetch');
const { query } = require('../pg');

const RAW_TIMEOUT_MS = parseInt(process.env.MEDIA_FETCH_TIMEOUT_MS || '15000', 10);
const RAW_MAX_BYTES = parseInt(process.env.MEDIA_MAX_BYTES || '5242880', 10);
const DEFAULT_TIMEOUT_MS =
  Number.isFinite(RAW_TIMEOUT_MS) && RAW_TIMEOUT_MS > 0 ? RAW_TIMEOUT_MS : 15000;
const DEFAULT_MAX_BYTES =
  Number.isFinite(RAW_MAX_BYTES) && RAW_MAX_BYTES > 0 ? RAW_MAX_BYTES : 5242880;
const DEFAULT_USER_AGENT =
  process.env.MEDIA_FETCH_USER_AGENT || 'ShelvesAI/1.0 (+https://shelves.ai)';
const API_ROOT = path.resolve(__dirname, '..', '..');
const RAW_CACHE_ROOT =
  process.env.MEDIA_CACHE_DIR ||
  process.env.COVER_CACHE_DIR ||
  path.join(API_ROOT, 'cache');
const CACHE_ROOT = path.isAbsolute(RAW_CACHE_ROOT)
  ? RAW_CACHE_ROOT
  : path.resolve(API_ROOT, RAW_CACHE_ROOT);
const MEDIA_SUBDIR = '';

const EXT_MAP = new Map([
  ['image/jpeg', '.jpg'],
  ['image/jpg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
]);

function normalizeString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function normalizePathSegment(value) {
  const raw = normalizeString(value);
  if (!raw) return 'unknown';
  return raw.replace(/[^a-zA-Z0-9_-]+/g, '_');
}

const MEDIA_TYPE_ALIASES = {
  book: 'books',
  books: 'books',
  movie: 'movies',
  movies: 'movies',
  film: 'movies',
  game: 'games',
  games: 'games',
  album: 'albums',
  albums: 'albums',
  music: 'music',
};

function normalizeMediaType(value) {
  const raw = normalizeString(value).toLowerCase();
  if (!raw) return 'items';
  if (MEDIA_TYPE_ALIASES[raw]) return MEDIA_TYPE_ALIASES[raw];
  if (raw.endsWith('s')) return raw;
  return `${raw}s`;
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (err) {
    return false;
  }
}

function extFromContentType(contentType, fallbackExt) {
  if (!contentType) return fallbackExt;
  const lower = contentType.toLowerCase().split(';')[0].trim();
  if (EXT_MAP.has(lower)) {
    return EXT_MAP.get(lower);
  }
  if (lower.includes('jpeg')) return '.jpg';
  if (lower.includes('png')) return '.png';
  if (lower.includes('webp')) return '.webp';
  if (lower.includes('gif')) return '.gif';
  return fallbackExt;
}

function urlExtension(url) {
  try {
    const parsed = new URL(url);
    const ext = path.posix.extname(parsed.pathname || '').toLowerCase();
    if (ext && ext.length <= 5) {
      return ext;
    }
  } catch (err) {
    // ignore
  }
  return '.jpg';
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Check if a file exists AND has content (size >= minBytes).
 * Used to validate that cached media files are not 0-byte placeholders.
 */
async function fileExistsWithContent(filePath, minBytes = 1) {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile() && stats.size >= minBytes;
  } catch (err) {
    return false;
  }
}

function buildLocalPath({ collectableId, kind, title, checksum, ext }) {
  const typeSegment = normalizeMediaType(kind);
  const titleSegment = normalizePathSegment(title || `collectable-${collectableId}`);
  const safeChecksum = normalizePathSegment(checksum || 'unknown');
  const safeExt = ext && ext.startsWith('.') ? ext : '.jpg';
  const fileName = `${safeChecksum}${safeExt}`;
  return path.posix.join(MEDIA_SUBDIR, typeSegment, titleSegment, fileName);
}

function toAbsolutePath(localPath) {
  const parts = String(localPath || '').split('/').filter(Boolean);
  return path.join(CACHE_ROOT, ...parts);
}

function pickCoverCandidate(images, coverUrl) {
  const list = Array.isArray(images) ? images : [];
  let fallback = null;

  for (const image of list) {
    if (!image || typeof image !== 'object') continue;
    const kind = normalizeString(image.kind) || 'cover';
    const provider = normalizeString(image.provider) || null;

    const urlLarge = normalizeString(image.urlLarge || image.url_large);
    if (urlLarge) {
      return { url: urlLarge, variant: 'large', kind, provider };
    }

    const urlMedium = normalizeString(image.urlMedium || image.url_medium);
    if (urlMedium && !fallback) {
      fallback = { url: urlMedium, variant: 'medium', kind, provider };
    }

    const urlSmall = normalizeString(image.urlSmall || image.url_small);
    if (urlSmall && !fallback) {
      fallback = { url: urlSmall, variant: 'small', kind, provider };
    }

    const url = normalizeString(image.url);
    if (url && !fallback) {
      fallback = { url, variant: 'original', kind, provider };
    }
  }

  if (fallback) return fallback;

  const fallbackUrl = normalizeString(coverUrl);
  if (fallbackUrl) {
    return { url: fallbackUrl, variant: 'original', kind: 'cover', provider: null };
  }

  return null;
}

function isMissingRelationError(err) {
  if (!err) return false;
  if (err.code === '42P01') return true;
  if (err.code === '42703') return true;
  const message = String(err.message || err);
  return message.includes('relation "media"') || message.includes('relation "collectables"');
}

async function downloadImage(url) {
  const response = await fetch(url, {
    timeout: DEFAULT_TIMEOUT_MS,
    redirect: 'follow',
    headers: {
      'User-Agent': DEFAULT_USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`http ${response.status}`);
  }

  const contentLength = parseInt(response.headers.get('content-length') || '', 10);
  if (Number.isFinite(contentLength) && contentLength > DEFAULT_MAX_BYTES) {
    throw new Error(`content-length exceeds ${DEFAULT_MAX_BYTES} bytes`);
  }

  const buffer = await response.buffer();
  if (buffer.length === 0) {
    throw new Error('downloaded image has 0 bytes');
  }
  if (buffer.length > DEFAULT_MAX_BYTES) {
    throw new Error(`download exceeds ${DEFAULT_MAX_BYTES} bytes`);
  }

  return {
    buffer,
    contentType: response.headers.get('content-type') || null,
    sizeBytes: buffer.length,
  };
}

async function ensureCoverMediaForCollectable({
  collectableId,
  coverMediaId,
  images,
  coverUrl,
  kind,
  title,
} = {}) {
  if (!collectableId) return null;
  const candidate = pickCoverCandidate(images, coverUrl);
  if (!candidate || !candidate.url || !isHttpUrl(candidate.url)) return null;

  try {
    if (coverMediaId) {
      const existing = await query(
        'SELECT id, source_url, local_path FROM media WHERE id = $1',
        [coverMediaId],
      );
      const row = existing.rows[0];
      if (row?.source_url === candidate.url) {
        if (row.local_path) {
          const absolutePath = toAbsolutePath(row.local_path);
          if (await fileExistsWithContent(absolutePath)) {
            return { id: coverMediaId, localPath: row.local_path };
          }
        }
      }
    }

    const existingByUrl = await query(
      'SELECT id, local_path FROM media WHERE collectable_id = $1 AND source_url = $2 LIMIT 1',
      [collectableId, candidate.url],
    );
    if (existingByUrl.rows.length) {
      const existingId = existingByUrl.rows[0].id;
      const existingPath = existingByUrl.rows[0].local_path || null;
      if (existingPath) {
        const absolutePath = toAbsolutePath(existingPath);
        if (await fileExistsWithContent(absolutePath)) {
          await query(
            'UPDATE collectables SET cover_media_id = $1 WHERE id = $2 AND (cover_media_id IS NULL OR cover_media_id <> $1)',
            [existingId, collectableId],
          );
          return { id: existingId, localPath: existingPath };
        }
      }
    }

    const { buffer, contentType, sizeBytes } = await downloadImage(candidate.url);
    const checksum = crypto.createHash('sha1').update(buffer).digest('hex');
    const ext = extFromContentType(contentType, urlExtension(candidate.url));
    const localPath = buildLocalPath({
      collectableId,
      kind,
      title,
      checksum,
      ext,
    });
    const absolutePath = toAbsolutePath(localPath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    if (!(await fileExistsWithContent(absolutePath))) {
      await fs.writeFile(absolutePath, buffer);
      // Verify the file was written with content
      if (!(await fileExistsWithContent(absolutePath))) {
        throw new Error('file write verification failed: 0 bytes on disk');
      }
    }

    const insertResult = await query(
      `INSERT INTO media (
        collectable_id, kind, variant, provider, source_url, local_path, content_type, size_bytes, checksum
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (collectable_id, source_url) DO UPDATE
      SET local_path = EXCLUDED.local_path,
          content_type = COALESCE(EXCLUDED.content_type, media.content_type),
          size_bytes = COALESCE(EXCLUDED.size_bytes, media.size_bytes),
          checksum = COALESCE(EXCLUDED.checksum, media.checksum)
      RETURNING id, local_path`,
      [
        collectableId,
        candidate.kind || 'cover',
        candidate.variant || null,
        candidate.provider || null,
        candidate.url,
        localPath,
        contentType,
        sizeBytes,
        checksum,
      ],
    );

    const mediaRow = insertResult.rows[0];
    const mediaId = mediaRow?.id || null;
    const mediaPath = mediaRow?.local_path || localPath;
    if (mediaId) {
      await query(
        'UPDATE collectables SET cover_media_id = $1 WHERE id = $2 AND (cover_media_id IS NULL OR cover_media_id <> $1)',
        [mediaId, collectableId],
      );
      return { id: mediaId, localPath: mediaPath };
    }

    return null;
  } catch (err) {
    if (isMissingRelationError(err)) {
      console.warn('[media] media table missing; skipping cover cache.');
      return null;
    }
    console.warn('[media] cover download failed:', err.message || err);
    return null;
  }
}

module.exports = {
  ensureCoverMediaForCollectable,
};
