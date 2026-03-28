const express = require('express');
const { query } = require('../database/pg');
const { resolveMediaUrl } = require('../services/mediaUrl');
const logger = require('../logger');

const router = express.Router();

const OTHER_SHELF_TYPE = 'other';
const DEFAULT_WEB_BASE = 'https://shelvesai.com';
const DEFAULT_APP_SCHEME = 'shelvesai://';

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function toWebBase() {
  return trimTrailingSlash(process.env.SHARE_WEB_BASE_URL || DEFAULT_WEB_BASE);
}

function toAppScheme() {
  const raw = String(process.env.SHARE_APP_SCHEME || DEFAULT_APP_SCHEME).trim();
  if (!raw) return DEFAULT_APP_SCHEME;
  return raw.endsWith('://') ? raw : `${raw.replace(/:+$/, '')}://`;
}

function isAbsoluteUrl(value) {
  return /^https?:\/\//i.test(String(value || ''));
}

function toSlug(value, fallback = 'shared-item') {
  const normalized = String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return normalized || fallback;
}

function buildCanonicalUrl(pathname) {
  const webBase = toWebBase();
  const normalized = String(pathname || '').replace(/^\/+/, '');
  return `${webBase}/${normalized}`;
}

function buildAppUrl(pathname) {
  const scheme = toAppScheme();
  const normalized = String(pathname || '').replace(/^\/+/, '');
  return `${scheme}${normalized}`;
}

function resolveCoverImageUrl({ coverMediaPath = null, coverImageUrl = null, coverImageSource = null, coverUrl = null } = {}) {
  if (coverMediaPath) {
    return resolveMediaUrl(coverMediaPath);
  }
  if (coverImageUrl) {
    if (isAbsoluteUrl(coverImageUrl)) return coverImageUrl;
    if (String(coverImageSource || '').toLowerCase() === 'local') {
      return resolveMediaUrl(coverImageUrl);
    }
    return coverImageUrl;
  }
  if (coverUrl) return coverUrl;
  return null;
}

function shouldRedactOtherManualCover({
  shelfType = null,
  ownerPhotoSource = null,
  ownerPhotoVisible = false,
  showPersonalPhotos = false,
} = {}) {
  if (String(shelfType || '').toLowerCase() !== OTHER_SHELF_TYPE) return false;
  if (!ownerPhotoSource) return false;
  return !(ownerPhotoVisible && showPersonalPhotos);
}

function buildPayload({
  visibility,
  entityType,
  id,
  slug,
  title,
  description,
  imageUrl,
  path,
}) {
  return {
    visibility,
    entityType,
    id: id == null ? null : String(id),
    slug,
    title,
    description,
    imageUrl: imageUrl || null,
    canonicalUrl: buildCanonicalUrl(path),
    appUrl: buildAppUrl(path),
  };
}

function buildRestrictedPayload({ entityType, id, path }) {
  return buildPayload({
    visibility: 'restricted',
    entityType,
    id,
    slug: 'locked',
    title: 'Shared on ShelvesAI',
    description: 'This shared content is private. Open ShelvesAI to continue.',
    imageUrl: `${toWebBase()}/og-image.png`,
    path,
  });
}

function buildNotFoundPayload({ entityType, id, path }) {
  return buildPayload({
    visibility: 'not_found',
    entityType,
    id,
    slug: 'not-found',
    title: 'Shared item not found',
    description: 'This shared link is unavailable.',
    imageUrl: `${toWebBase()}/og-image.png`,
    path,
  });
}

function parsePositiveInt(value) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function parsePreviewPayloads(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_err) {
      return [];
    }
  }
  return [];
}

function extractCoverFromPayloadEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const collectable = entry.collectable && typeof entry.collectable === 'object' ? entry.collectable : null;
  const candidate = collectable || entry;
  const hasCollectableIdentity = Boolean(
    candidate.collectableId
      || candidate.collectable_id
      || candidate.id
      || collectable?.id
  );
  if (!hasCollectableIdentity) return null;
  return resolveCoverImageUrl({
    coverMediaPath: candidate.coverMediaPath || candidate.cover_media_path || null,
    coverImageUrl: candidate.coverImageUrl || candidate.cover_image_url || null,
    coverImageSource: candidate.coverImageSource || candidate.cover_image_source || null,
    coverUrl: candidate.coverUrl || candidate.cover_url || null,
  });
}

function extractCollectableImageFromPreviewPayloads(previewPayloads) {
  const queue = [...parsePreviewPayloads(previewPayloads)];
  while (queue.length) {
    const payload = queue.shift();
    if (!payload || typeof payload !== 'object') continue;
    const direct = extractCoverFromPayloadEntry(payload);
    if (direct) return direct;
    if (Array.isArray(payload.items)) {
      payload.items.forEach((item) => queue.push(item));
    }
    if (payload.item && typeof payload.item === 'object') {
      queue.push(payload.item);
    }
    if (payload.collectable && typeof payload.collectable === 'object') {
      queue.push(payload.collectable);
    }
  }
  return null;
}

async function getCollectableShare(req, res) {
  try {
    const collectableId = parsePositiveInt(req.params.id);
    if (!collectableId) {
      return res.status(400).json({ error: 'Invalid collectable id' });
    }

    const result = await query(
      `SELECT c.id,
              c.title,
              c.description,
              c.primary_creator,
              c.cover_url,
              c.cover_image_url,
              c.cover_image_source,
              m.local_path AS cover_media_path
       FROM collectables c
       LEFT JOIN media m ON m.id = c.cover_media_id
       WHERE c.id = $1
       LIMIT 1`,
      [collectableId],
    );
    const row = result.rows[0];
    const path = `app/collectables/${collectableId}`;
    if (!row) {
      return res.status(404).json(buildNotFoundPayload({ entityType: 'collectable', id: collectableId, path }));
    }

    const title = row.title || `Collectable ${collectableId}`;
    const slug = toSlug(title, `collectable-${collectableId}`);
    const finalPath = `app/collectables/${collectableId}/${slug}`;
    const imageUrl = resolveCoverImageUrl({
      coverMediaPath: row.cover_media_path,
      coverImageUrl: row.cover_image_url,
      coverImageSource: row.cover_image_source,
      coverUrl: row.cover_url,
    });
    const description = row.description || (row.primary_creator ? `By ${row.primary_creator}` : 'Shared from ShelvesAI');

    return res.json(buildPayload({
      visibility: 'public',
      entityType: 'collectable',
      id: collectableId,
      slug,
      title,
      description,
      imageUrl,
      path: finalPath,
    }));
  } catch (err) {
    logger.error('GET /api/share/collectables/:id error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

async function getManualShare(req, res) {
  try {
    const manualId = parsePositiveInt(req.params.id);
    if (!manualId) {
      return res.status(400).json({ error: 'Invalid manual id' });
    }

    const result = await query(
      `SELECT um.id,
              um.name,
              um.description,
              um.author,
              um.cover_media_path,
              s.id AS shelf_id,
              s.name AS shelf_name,
              s.type AS shelf_type,
              s.visibility AS shelf_visibility,
              owner.username AS owner_username,
              owner.is_suspended,
              owner.show_personal_photos,
              uc_ctx.owner_photo_source,
              uc_ctx.owner_photo_visible
       FROM user_manuals um
       JOIN shelves s ON s.id = um.shelf_id
       JOIN users owner ON owner.id = s.owner_id
       LEFT JOIN LATERAL (
         SELECT uc.owner_photo_source, uc.owner_photo_visible
         FROM user_collections uc
         WHERE uc.manual_id = um.id
         ORDER BY uc.created_at ASC, uc.id ASC
         LIMIT 1
       ) uc_ctx ON TRUE
       WHERE um.id = $1
       LIMIT 1`,
      [manualId],
    );
    const row = result.rows[0];
    const path = `app/manuals/${manualId}`;
    if (!row || row.is_suspended) {
      return res.status(404).json(buildNotFoundPayload({ entityType: 'manual', id: manualId, path }));
    }

    const title = row.name || `Manual ${manualId}`;
    const slug = toSlug(title, `manual-${manualId}`);
    const finalPath = `app/manuals/${manualId}/${slug}`;
    if (row.shelf_visibility !== 'public') {
      return res.json(buildRestrictedPayload({ entityType: 'manual', id: manualId, path: finalPath }));
    }

    const manualCoverBlocked = shouldRedactOtherManualCover({
      shelfType: row.shelf_type,
      ownerPhotoSource: row.owner_photo_source,
      ownerPhotoVisible: row.owner_photo_visible === true,
      showPersonalPhotos: row.show_personal_photos === true,
    });
    const imageUrl = manualCoverBlocked ? null : resolveMediaUrl(row.cover_media_path);
    const description = row.description
      || (row.author ? `${row.author} on ${row.shelf_name || 'a shelf'}` : `Shared from ${row.shelf_name || 'a shelf'}`);

    return res.json(buildPayload({
      visibility: 'public',
      entityType: 'manual',
      id: manualId,
      slug,
      title,
      description,
      imageUrl,
      path: finalPath,
    }));
  } catch (err) {
    logger.error('GET /api/share/manuals/:id error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

async function getShelfPreviewImage(shelfId) {
  const result = await query(
    `SELECT s.type AS shelf_type,
            uc.owner_photo_source,
            uc.owner_photo_visible,
            owner.show_personal_photos,
            c.cover_url,
            c.cover_image_url,
            c.cover_image_source,
            m.local_path AS collectable_cover_media_path,
            um.cover_media_path AS manual_cover_media_path
     FROM user_collections uc
     JOIN shelves s ON s.id = uc.shelf_id
     JOIN users owner ON owner.id = uc.user_id
     LEFT JOIN collectables c ON c.id = uc.collectable_id
     LEFT JOIN media m ON m.id = c.cover_media_id
     LEFT JOIN user_manuals um ON um.id = uc.manual_id
     WHERE uc.shelf_id = $1
     ORDER BY uc.position ASC NULLS LAST, uc.created_at DESC
     LIMIT 1`,
    [shelfId],
  );
  const row = result.rows[0];
  if (!row) return null;

  const collectableImage = resolveCoverImageUrl({
    coverMediaPath: row.collectable_cover_media_path,
    coverImageUrl: row.cover_image_url,
    coverImageSource: row.cover_image_source,
    coverUrl: row.cover_url,
  });
  if (collectableImage) return collectableImage;

  const manualCoverBlocked = shouldRedactOtherManualCover({
    shelfType: row.shelf_type,
    ownerPhotoSource: row.owner_photo_source,
    ownerPhotoVisible: row.owner_photo_visible === true,
    showPersonalPhotos: row.show_personal_photos === true,
  });
  return manualCoverBlocked ? null : resolveMediaUrl(row.manual_cover_media_path);
}

async function getShelfShare(req, res) {
  try {
    const shelfId = parsePositiveInt(req.params.id);
    if (!shelfId) {
      return res.status(400).json({ error: 'Invalid shelf id' });
    }

    const result = await query(
      `SELECT s.id,
              s.name,
              s.type,
              s.description,
              s.visibility,
              owner.username AS owner_username,
              owner.is_suspended
       FROM shelves s
       JOIN users owner ON owner.id = s.owner_id
       WHERE s.id = $1
       LIMIT 1`,
      [shelfId],
    );
    const row = result.rows[0];
    const path = `app/shelves/${shelfId}`;
    if (!row || row.is_suspended) {
      return res.status(404).json(buildNotFoundPayload({ entityType: 'shelf', id: shelfId, path }));
    }

    const title = row.name || `Shelf ${shelfId}`;
    const slug = toSlug(title, `shelf-${shelfId}`);
    const finalPath = `app/shelves/${shelfId}/${slug}`;
    if (row.visibility !== 'public') {
      return res.json(buildRestrictedPayload({ entityType: 'shelf', id: shelfId, path: finalPath }));
    }

    const imageUrl = await getShelfPreviewImage(shelfId);
    const description = row.description
      || `Public ${row.type || 'collection'} shelf from @${row.owner_username || 'collector'}.`;

    return res.json(buildPayload({
      visibility: 'public',
      entityType: 'shelf',
      id: shelfId,
      slug,
      title,
      description,
      imageUrl,
      path: finalPath,
    }));
  } catch (err) {
    logger.error('GET /api/share/shelves/:id error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

function describeEvent(row) {
  const owner = row.owner_username || 'Someone';
  const eventType = String(row.event_type || '').toLowerCase();
  if (eventType === 'checkin.activity') {
    return {
      title: `${owner} checked in`,
      description: 'Shared from ShelvesAI.',
    };
  }
  if (eventType === 'item.added' || eventType === 'item.collectable_added' || eventType === 'item.manual_added') {
    return {
      title: `${owner} added items`,
      description: row.shelf_name ? `To ${row.shelf_name}.` : 'Shared from ShelvesAI.',
    };
  }
  if (row.shelf_name) {
    return {
      title: `${owner} updated ${row.shelf_name}`,
      description: row.shelf_description || 'Shared from ShelvesAI.',
    };
  }
  return {
    title: `${owner} shared an update`,
    description: 'Shared from ShelvesAI.',
  };
}

function isPublicEvent(row) {
  if (!row) return false;
  if (row.shelf_id) {
    return row.shelf_visibility === 'public';
  }
  if (String(row.event_type || '').toLowerCase() === 'checkin.activity') {
    return row.event_visibility === 'public';
  }
  return false;
}

async function getEventShare(req, res) {
  try {
    const eventId = String(req.params.id || '').trim();
    if (!eventId) {
      return res.status(400).json({ error: 'Invalid event id' });
    }

    const result = await query(
      `SELECT a.id,
              a.event_type,
              a.visibility AS event_visibility,
              a.shelf_id,
              a.preview_payloads,
              owner.username AS owner_username,
              owner.is_suspended,
              s.name AS shelf_name,
              s.description AS shelf_description,
              s.visibility AS shelf_visibility,
              s.type AS shelf_type,
              c.cover_url,
              c.cover_image_url,
              c.cover_image_source,
              cm.local_path AS collectable_cover_media_path,
              um.cover_media_path AS manual_cover_media_path,
              uc_ctx.owner_photo_source,
              uc_ctx.owner_photo_visible,
              manual_owner.show_personal_photos
       FROM event_aggregates a
       LEFT JOIN users owner ON owner.id = a.user_id
       LEFT JOIN shelves s ON s.id = a.shelf_id
       LEFT JOIN collectables c ON c.id = a.collectable_id
       LEFT JOIN media cm ON cm.id = c.cover_media_id
       LEFT JOIN user_manuals um ON um.id = a.manual_id
       LEFT JOIN LATERAL (
         SELECT uc.owner_photo_source,
                uc.owner_photo_visible,
                uc.user_id AS owner_id
         FROM user_collections uc
         WHERE a.manual_id IS NOT NULL
           AND uc.manual_id = a.manual_id
         ORDER BY uc.created_at ASC, uc.id ASC
         LIMIT 1
       ) uc_ctx ON TRUE
       LEFT JOIN users manual_owner ON manual_owner.id = uc_ctx.owner_id
       WHERE a.id = $1
       LIMIT 1`,
      [eventId],
    );
    const row = result.rows[0];
    const path = `app/events/${eventId}`;
    if (!row || row.is_suspended) {
      return res.status(404).json(buildNotFoundPayload({ entityType: 'event', id: eventId, path }));
    }

    const { title, description } = describeEvent(row);
    const slug = toSlug(title, 'event');
    const finalPath = `app/events/${eventId}/${slug}`;
    if (!isPublicEvent(row)) {
      return res.json(buildRestrictedPayload({ entityType: 'event', id: eventId, path: finalPath }));
    }

    let imageUrl = resolveCoverImageUrl({
      coverMediaPath: row.collectable_cover_media_path,
      coverImageUrl: row.cover_image_url,
      coverImageSource: row.cover_image_source,
      coverUrl: row.cover_url,
    });
    if (!imageUrl) {
      const manualCoverBlocked = shouldRedactOtherManualCover({
        shelfType: row.shelf_type,
        ownerPhotoSource: row.owner_photo_source,
        ownerPhotoVisible: row.owner_photo_visible === true,
        showPersonalPhotos: row.show_personal_photos === true,
      });
      if (!manualCoverBlocked) {
        imageUrl = resolveMediaUrl(row.manual_cover_media_path);
      }
    }
    if (!imageUrl) {
      imageUrl = extractCollectableImageFromPreviewPayloads(row.preview_payloads);
    }

    return res.json(buildPayload({
      visibility: 'public',
      entityType: 'event',
      id: eventId,
      slug,
      title,
      description,
      imageUrl,
      path: finalPath,
    }));
  } catch (err) {
    logger.error('GET /api/share/events/:id error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

router.get('/collectables/:id', getCollectableShare);
router.get('/manuals/:id', getManualShare);
router.get('/shelves/:id', getShelfShare);
router.get('/events/:id', getEventShare);

module.exports = router;
