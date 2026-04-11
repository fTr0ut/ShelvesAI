const { query } = require('../pg');
const { rowToCamelCase } = require('./utils');
const { resolveMediaUrl } = require('../../services/mediaUrl');

const CONTENT_TYPES = new Set([
  'profile_bio',
  'shelf',
  'shelf_item_note',
  'event_note',
  'event_comment',
  'user_list',
  'user_list_item',
  'wishlist',
  'wishlist_item',
  'profile_media',
  'owner_photo',
]);

const STATUS_VALUES = new Set(['active', 'flagged', 'hidden', 'cleared', 'deleted']);
const ACTOR_TYPES = new Set(['human', 'bot']);

function normalizeContentType(contentType) {
  const value = String(contentType || '').trim();
  if (!CONTENT_TYPES.has(value)) {
    throw new Error(`Unsupported moderation contentType: ${value}`);
  }
  return value;
}

function normalizeStatus(status) {
  const value = String(status || '').trim();
  if (!STATUS_VALUES.has(value)) {
    throw new Error(`Unsupported moderation status: ${value}`);
  }
  return value;
}

function normalizeActorType(actorType) {
  const value = String(actorType || 'human').trim();
  if (!ACTOR_TYPES.has(value)) {
    throw new Error(`Unsupported moderation actorType: ${value}`);
  }
  return value;
}

function normalizeContentId(contentId) {
  return String(contentId ?? '').trim();
}

function entityKey(contentType, contentId) {
  return `${contentType}:${normalizeContentId(contentId)}`;
}

function normalizedText(value) {
  const text = String(value ?? '').trim();
  return text.length > 0 ? text : null;
}

function toDateValue(value) {
  const date = value ? new Date(value) : null;
  return Number.isFinite(date?.getTime()) ? date : null;
}

function maxDateIso(...values) {
  const dates = values.map(toDateValue).filter(Boolean);
  if (dates.length === 0) return null;
  return new Date(Math.max(...dates.map((item) => item.getTime()))).toISOString();
}

function normalizeMediaRef(ref) {
  if (!ref || typeof ref !== 'object') return null;
  const path = normalizedText(ref.path);
  const url = normalizedText(ref.url) || (path ? resolveMediaUrl(path) : null);
  if (!path && !url) return null;
  return {
    kind: normalizedText(ref.kind) || 'media',
    label: normalizedText(ref.label) || null,
    path,
    url,
    visible: ref.visible !== false,
  };
}

function buildMediaRefs(...refs) {
  return refs.map(normalizeMediaRef).filter(Boolean);
}

function lowerIncludes(haystack, needle) {
  return String(haystack || '').toLowerCase().includes(String(needle || '').toLowerCase());
}

function buildSnapshotItem(base) {
  return {
    contentType: base.contentType,
    contentId: normalizeContentId(base.contentId),
    authorUserId: base.authorUserId || null,
    authorUsername: base.authorUsername || null,
    title: base.title || null,
    text: base.text || null,
    mediaRefs: Array.isArray(base.mediaRefs) ? base.mediaRefs : [],
    visibility: base.visibility || null,
    createdAt: base.createdAt || null,
    updatedAt: base.updatedAt || null,
    sourceEntityId: base.sourceEntityId != null ? String(base.sourceEntityId) : null,
    sourceRoute: base.sourceRoute || null,
    metadata: base.metadata && typeof base.metadata === 'object' ? base.metadata : {},
  };
}

function getAvailableActions(item) {
  const status = item?.status || 'active';
  switch (item?.contentType) {
    case 'profile_bio':
    case 'shelf_item_note':
    case 'event_note':
    case 'user_list_item':
      return status === 'cleared' ? ['restore', 'suspend_user'] : ['clear', 'suspend_user'];
    case 'wishlist_item':
      return status === 'cleared' ? ['restore', 'suspend_user'] : ['clear', 'suspend_user'];
    case 'shelf':
    case 'user_list':
    case 'wishlist':
    case 'profile_media':
    case 'owner_photo':
      return status === 'hidden' ? ['unhide', 'suspend_user'] : ['hide', 'suspend_user'];
    case 'event_comment':
      return status === 'deleted' ? ['suspend_user'] : ['delete', 'suspend_user'];
    default:
      return ['suspend_user'];
  }
}

function buildModerationItem(base, state = null) {
  const snapshot = state?.evidenceSnapshot && typeof state.evidenceSnapshot === 'object'
    ? state.evidenceSnapshot
    : null;

  const merged = {
    ...base,
    contentId: normalizeContentId(base.contentId),
    status: state?.status || 'active',
    moderationUpdatedAt: state?.updatedAt || null,
    currentText: base.text || null,
    text: base.text || snapshot?.text || null,
    mediaRefs: Array.isArray(base.mediaRefs) && base.mediaRefs.length > 0
      ? base.mediaRefs
      : (Array.isArray(snapshot?.mediaRefs) ? snapshot.mediaRefs : []),
    updatedAt: maxDateIso(base.updatedAt, state?.updatedAt) || base.updatedAt || state?.updatedAt || null,
    reportCount: 0,
    reportReasons: [],
    priorModerationActions: [],
  };

  merged.availableActions = getAvailableActions(merged);
  return merged;
}

function buildFallbackItemFromState(state) {
  const snapshot = state?.evidenceSnapshot;
  if (!snapshot || typeof snapshot !== 'object') return null;
  if (!snapshot.contentType || !snapshot.contentId) return null;

  const fallback = {
    contentType: snapshot.contentType,
    contentId: normalizeContentId(snapshot.contentId),
    authorUserId: snapshot.authorUserId || null,
    authorUsername: snapshot.authorUsername || null,
    title: snapshot.title || null,
    text: snapshot.text || null,
    mediaRefs: Array.isArray(snapshot.mediaRefs) ? snapshot.mediaRefs : [],
    visibility: snapshot.visibility || null,
    createdAt: snapshot.createdAt || state.createdAt || null,
    updatedAt: maxDateIso(snapshot.updatedAt, state.updatedAt) || snapshot.updatedAt || state.updatedAt || null,
    sourceEntityId: snapshot.sourceEntityId != null ? String(snapshot.sourceEntityId) : null,
    sourceRoute: snapshot.sourceRoute || null,
    metadata: {
      ...(snapshot.metadata && typeof snapshot.metadata === 'object' ? snapshot.metadata : {}),
      isEvidenceOnly: true,
    },
  };

  return buildModerationItem(fallback, state);
}

function compareItemsDesc(a, b) {
  const aStamp = toDateValue(a.updatedAt)?.getTime() || 0;
  const bStamp = toDateValue(b.updatedAt)?.getTime() || 0;
  if (aStamp !== bStamp) return bStamp - aStamp;
  if (a.contentType !== b.contentType) return a.contentType.localeCompare(b.contentType);
  return normalizeContentId(a.contentId).localeCompare(normalizeContentId(b.contentId));
}

function encodeCursor(item) {
  if (!item) return null;
  return Buffer.from(JSON.stringify({
    updatedAt: item.updatedAt,
    contentType: item.contentType,
    contentId: normalizeContentId(item.contentId),
  })).toString('base64url');
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    if (!parsed || !parsed.updatedAt || !parsed.contentType || parsed.contentId == null) return null;
    return parsed;
  } catch (_err) {
    return null;
  }
}

function isAfterCursor(item, cursor) {
  if (!cursor) return true;
  return compareItemsDesc(item, cursor) > 0;
}

async function listModerationEntities({ contentType = null } = {}) {
  const params = [];
  const clauses = [];
  if (contentType) {
    params.push(normalizeContentType(contentType));
    clauses.push(`content_type = $${params.length}`);
  }

  const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await query(
    `SELECT id, content_type, content_id, status, last_action, last_actor_type,
            last_admin_id, rule_code, action_reason, confidence, evidence_snapshot,
            alerts_sent_at, created_at, updated_at
     FROM moderation_entities
     ${whereClause}`,
    params
  );

  return result.rows.map(rowToCamelCase);
}

async function getModerationEntity(contentType, contentId) {
  const result = await query(
    `SELECT id, content_type, content_id, status, last_action, last_actor_type,
            last_admin_id, rule_code, action_reason, confidence, evidence_snapshot,
            alerts_sent_at, created_at, updated_at
     FROM moderation_entities
     WHERE content_type = $1 AND content_id = $2
     LIMIT 1`,
    [normalizeContentType(contentType), normalizeContentId(contentId)]
  );
  return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

async function upsertModerationEntity({
  contentType,
  contentId,
  status,
  lastAction,
  lastActorType = 'human',
  lastAdminId = null,
  ruleCode = null,
  actionReason = null,
  confidence = null,
  evidenceSnapshot = {},
  alertsSentAt = null,
}) {
  const result = await query(
    `INSERT INTO moderation_entities (
        content_type, content_id, status, last_action, last_actor_type,
        last_admin_id, rule_code, action_reason, confidence, evidence_snapshot,
        alerts_sent_at, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, NOW(), NOW())
     ON CONFLICT (content_type, content_id) DO UPDATE SET
        status = EXCLUDED.status,
        last_action = EXCLUDED.last_action,
        last_actor_type = EXCLUDED.last_actor_type,
        last_admin_id = EXCLUDED.last_admin_id,
        rule_code = EXCLUDED.rule_code,
        action_reason = EXCLUDED.action_reason,
        confidence = EXCLUDED.confidence,
        evidence_snapshot = CASE
          WHEN EXCLUDED.evidence_snapshot = '{}'::jsonb THEN moderation_entities.evidence_snapshot
          ELSE EXCLUDED.evidence_snapshot
        END,
        alerts_sent_at = COALESCE(EXCLUDED.alerts_sent_at, moderation_entities.alerts_sent_at),
        updated_at = NOW()
     RETURNING id, content_type, content_id, status, last_action, last_actor_type,
               last_admin_id, rule_code, action_reason, confidence, evidence_snapshot,
               alerts_sent_at, created_at, updated_at`,
    [
      normalizeContentType(contentType),
      normalizeContentId(contentId),
      normalizeStatus(status),
      lastAction || null,
      normalizeActorType(lastActorType),
      lastAdminId,
      ruleCode,
      actionReason,
      confidence,
      JSON.stringify(evidenceSnapshot && typeof evidenceSnapshot === 'object' ? evidenceSnapshot : {}),
      alertsSentAt,
    ]
  );
  return rowToCamelCase(result.rows[0]);
}

async function listRecentActionsForItems(items, { limitPerItem = 5 } = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    return new Map();
  }

  const unique = [];
  const seen = new Set();
  for (const item of items) {
    const key = entityKey(item.contentType, item.contentId);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  }

  const values = [];
  const clauses = unique.map((item) => {
    values.push(item.contentType, normalizeContentId(item.contentId));
    const typeIndex = values.length - 1;
    const idIndex = values.length;
    return `(a.metadata->>'contentType' = $${typeIndex} AND a.metadata->>'contentId' = $${idIndex})`;
  });

  const result = await query(
    `SELECT a.id, a.action, a.metadata, a.created_at, a.admin_id,
            u.username AS admin_username
     FROM admin_action_logs a
     LEFT JOIN users u ON u.id = a.admin_id
     WHERE (${clauses.join(' OR ')})
     ORDER BY a.created_at DESC`,
    values
  );

  const grouped = new Map();
  for (const row of result.rows.map(rowToCamelCase)) {
    const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
    const key = entityKey(metadata.contentType, metadata.contentId);
    const actions = grouped.get(key) || [];
    if (actions.length >= limitPerItem) continue;
    actions.push({
      id: row.id,
      action: row.action,
      actorType: metadata.actorType || null,
      executed: metadata.executed === true,
      ruleCode: metadata.ruleCode || null,
      reason: metadata.reason || null,
      createdAt: row.createdAt,
      adminId: row.adminId || null,
      adminUsername: row.adminUsername || null,
    });
    grouped.set(key, actions);
  }

  return grouped;
}

async function fetchProfileBioItems() {
  const result = await query(
    `SELECT u.id AS author_user_id,
            u.id AS content_id,
            u.id AS source_entity_id,
            u.username AS author_username,
            u.bio,
            u.picture,
            pm.local_path AS profile_media_path,
            CASE WHEN u.is_private THEN 'private' ELSE 'public' END AS visibility,
            u.created_at,
            u.updated_at
     FROM users u
     LEFT JOIN profile_media pm ON pm.id = u.profile_media_id
     WHERE NULLIF(BTRIM(u.bio), '') IS NOT NULL`
  );

  return result.rows.map((row) => {
    const item = rowToCamelCase(row);
    return buildSnapshotItem({
      contentType: 'profile_bio',
      contentId: item.contentId,
      authorUserId: item.authorUserId,
      authorUsername: item.authorUsername,
      title: `Profile bio for @${item.authorUsername || 'unknown'}`,
      text: normalizedText(item.bio),
      mediaRefs: buildMediaRefs(
        { kind: 'profile_media', path: item.profileMediaPath, label: 'Avatar' },
        { kind: 'picture', url: item.picture, label: 'Profile picture' }
      ),
      visibility: item.visibility,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      sourceEntityId: item.sourceEntityId,
      sourceRoute: `/users?selectedUserId=${encodeURIComponent(String(item.authorUserId))}`,
      metadata: {},
    });
  });
}

async function fetchShelfItems() {
  const result = await query(
    `SELECT s.id AS content_id,
            s.id AS source_entity_id,
            s.owner_id AS author_user_id,
            u.username AS author_username,
            s.name,
            s.description,
            s.visibility,
            s.photo_storage_key,
            s.created_at,
            s.updated_at
     FROM shelves s
     LEFT JOIN users u ON u.id = s.owner_id
     WHERE NULLIF(BTRIM(COALESCE(s.name, '') || ' ' || COALESCE(s.description, '')), '') IS NOT NULL`
  );

  return result.rows.map((row) => {
    const item = rowToCamelCase(row);
    return buildSnapshotItem({
      contentType: 'shelf',
      contentId: item.contentId,
      authorUserId: item.authorUserId,
      authorUsername: item.authorUsername,
      title: item.name || `Shelf ${item.contentId}`,
      text: normalizedText([item.name, item.description].filter(Boolean).join('\n\n')),
      mediaRefs: buildMediaRefs(
        { kind: 'shelf_photo', path: item.photoStorageKey, label: 'Shelf photo' }
      ),
      visibility: item.visibility,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      sourceEntityId: item.sourceEntityId,
      sourceRoute: `/content?selectedShelfId=${encodeURIComponent(String(item.contentId))}`,
      metadata: {
        shelfName: item.name || null,
      },
    });
  });
}

async function fetchShelfItemNoteItems() {
  const result = await query(
    `SELECT uc.id AS content_id,
            uc.id AS source_entity_id,
            uc.user_id AS author_user_id,
            u.username AS author_username,
            uc.shelf_id,
            s.name AS shelf_name,
            uc.notes,
            uc.owner_photo_storage_key,
            uc.owner_photo_thumb_storage_key,
            uc.owner_photo_visible,
            uc.created_at,
            s.updated_at AS shelf_updated_at
     FROM user_collections uc
     LEFT JOIN users u ON u.id = uc.user_id
     LEFT JOIN shelves s ON s.id = uc.shelf_id
     WHERE NULLIF(BTRIM(uc.notes), '') IS NOT NULL`
  );

  return result.rows.map((row) => {
    const item = rowToCamelCase(row);
    const mediaPath = item.ownerPhotoThumbStorageKey || item.ownerPhotoStorageKey;
    return buildSnapshotItem({
      contentType: 'shelf_item_note',
      contentId: item.contentId,
      authorUserId: item.authorUserId,
      authorUsername: item.authorUsername,
      title: item.shelfName ? `Shelf item note on ${item.shelfName}` : `Shelf item note ${item.contentId}`,
      text: normalizedText(item.notes),
      mediaRefs: buildMediaRefs(
        mediaPath ? {
          kind: 'owner_photo',
          path: mediaPath,
          label: 'Owner photo',
          visible: item.ownerPhotoVisible !== false,
        } : null
      ),
      visibility: null,
      createdAt: item.createdAt,
      updatedAt: maxDateIso(item.createdAt, item.shelfUpdatedAt),
      sourceEntityId: item.shelfId,
      sourceRoute: `/content?selectedShelfId=${encodeURIComponent(String(item.shelfId))}`,
      metadata: {
        shelfId: item.shelfId,
        shelfName: item.shelfName || null,
      },
    });
  });
}

async function fetchEventNoteItems() {
  const result = await query(
    `SELECT a.id AS content_id,
            a.id AS source_entity_id,
            a.user_id AS author_user_id,
            u.username AS author_username,
            a.shelf_id,
            s.name AS shelf_name,
            a.event_type,
            a.note,
            a.visibility,
            a.created_at,
            a.last_activity_at
     FROM event_aggregates a
     LEFT JOIN users u ON u.id = a.user_id
     LEFT JOIN shelves s ON s.id = a.shelf_id
     WHERE NULLIF(BTRIM(a.note), '') IS NOT NULL`
  );

  return result.rows.map((row) => {
    const item = rowToCamelCase(row);
    return buildSnapshotItem({
      contentType: 'event_note',
      contentId: item.contentId,
      authorUserId: item.authorUserId,
      authorUsername: item.authorUsername,
      title: `${item.eventType || 'event'} note`,
      text: normalizedText(item.note),
      mediaRefs: [],
      visibility: item.visibility,
      createdAt: item.createdAt,
      updatedAt: item.lastActivityAt || item.createdAt,
      sourceEntityId: item.sourceEntityId,
      sourceRoute: `/social-feed?eventId=${encodeURIComponent(String(item.contentId))}`,
      metadata: {
        shelfId: item.shelfId || null,
        shelfName: item.shelfName || null,
        eventType: item.eventType || null,
      },
    });
  });
}

async function fetchEventCommentItems() {
  const result = await query(
    `SELECT ec.id AS content_id,
            ec.id AS source_entity_id,
            ec.user_id AS author_user_id,
            u.username AS author_username,
            ec.event_id,
            a.event_type,
            a.visibility,
            ec.content,
            ec.created_at
     FROM event_comments ec
     LEFT JOIN users u ON u.id = ec.user_id
     LEFT JOIN event_aggregates a ON a.id = ec.event_id
     WHERE NULLIF(BTRIM(ec.content), '') IS NOT NULL`
  );

  return result.rows.map((row) => {
    const item = rowToCamelCase(row);
    return buildSnapshotItem({
      contentType: 'event_comment',
      contentId: item.contentId,
      authorUserId: item.authorUserId,
      authorUsername: item.authorUsername,
      title: `Comment on ${item.eventType || 'event'}`,
      text: normalizedText(item.content),
      mediaRefs: [],
      visibility: item.visibility || null,
      createdAt: item.createdAt,
      updatedAt: item.createdAt,
      sourceEntityId: item.eventId,
      sourceRoute: `/social-feed?eventId=${encodeURIComponent(String(item.eventId))}`,
      metadata: {
        eventId: item.eventId,
        eventType: item.eventType || null,
      },
    });
  });
}

async function fetchUserListItems() {
  const result = await query(
    `SELECT ul.id AS content_id,
            ul.id AS source_entity_id,
            ul.user_id AS author_user_id,
            u.username AS author_username,
            ul.name,
            ul.description,
            ul.visibility,
            ul.created_at,
            ul.updated_at
     FROM user_lists ul
     LEFT JOIN users u ON u.id = ul.user_id
     WHERE NULLIF(BTRIM(COALESCE(ul.name, '') || ' ' || COALESCE(ul.description, '')), '') IS NOT NULL`
  );

  return result.rows.map((row) => {
    const item = rowToCamelCase(row);
    return buildSnapshotItem({
      contentType: 'user_list',
      contentId: item.contentId,
      authorUserId: item.authorUserId,
      authorUsername: item.authorUsername,
      title: item.name || `List ${item.contentId}`,
      text: normalizedText([item.name, item.description].filter(Boolean).join('\n\n')),
      mediaRefs: [],
      visibility: item.visibility,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      sourceEntityId: item.sourceEntityId,
      sourceRoute: `/moderation?contentType=user_list&contentId=${encodeURIComponent(String(item.contentId))}`,
      metadata: {
        listName: item.name || null,
      },
    });
  });
}

async function fetchUserListItemNoteItems() {
  const result = await query(
    `SELECT uli.id AS content_id,
            uli.id AS source_entity_id,
            ul.user_id AS author_user_id,
            u.username AS author_username,
            uli.list_id,
            ul.name AS list_name,
            uli.notes,
            uli.created_at
     FROM user_list_items uli
     JOIN user_lists ul ON ul.id = uli.list_id
     LEFT JOIN users u ON u.id = ul.user_id
     WHERE NULLIF(BTRIM(uli.notes), '') IS NOT NULL`
  );

  return result.rows.map((row) => {
    const item = rowToCamelCase(row);
    return buildSnapshotItem({
      contentType: 'user_list_item',
      contentId: item.contentId,
      authorUserId: item.authorUserId,
      authorUsername: item.authorUsername,
      title: item.listName ? `List item note on ${item.listName}` : `List item note ${item.contentId}`,
      text: normalizedText(item.notes),
      mediaRefs: [],
      visibility: null,
      createdAt: item.createdAt,
      updatedAt: item.createdAt,
      sourceEntityId: item.listId,
      sourceRoute: `/moderation?contentType=user_list_item&contentId=${encodeURIComponent(String(item.contentId))}`,
      metadata: {
        listId: item.listId,
        listName: item.listName || null,
      },
    });
  });
}

async function fetchWishlistItems() {
  const result = await query(
    `SELECT w.id AS content_id,
            w.id AS source_entity_id,
            w.user_id AS author_user_id,
            u.username AS author_username,
            w.name,
            w.description,
            w.visibility,
            w.created_at,
            w.updated_at
     FROM wishlists w
     LEFT JOIN users u ON u.id = w.user_id
     WHERE NULLIF(BTRIM(COALESCE(w.name, '') || ' ' || COALESCE(w.description, '')), '') IS NOT NULL`
  );

  return result.rows.map((row) => {
    const item = rowToCamelCase(row);
    return buildSnapshotItem({
      contentType: 'wishlist',
      contentId: item.contentId,
      authorUserId: item.authorUserId,
      authorUsername: item.authorUsername,
      title: item.name || `Wishlist ${item.contentId}`,
      text: normalizedText([item.name, item.description].filter(Boolean).join('\n\n')),
      mediaRefs: [],
      visibility: item.visibility,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      sourceEntityId: item.sourceEntityId,
      sourceRoute: `/moderation?contentType=wishlist&contentId=${encodeURIComponent(String(item.contentId))}`,
      metadata: {
        wishlistName: item.name || null,
      },
    });
  });
}

async function fetchWishlistItemItems() {
  const result = await query(
    `SELECT wi.id AS content_id,
            wi.id AS source_entity_id,
            w.user_id AS author_user_id,
            u.username AS author_username,
            wi.wishlist_id,
            w.name AS wishlist_name,
            wi.manual_text,
            wi.notes,
            wi.created_at
     FROM wishlist_items wi
     JOIN wishlists w ON w.id = wi.wishlist_id
     LEFT JOIN users u ON u.id = w.user_id
     WHERE NULLIF(BTRIM(COALESCE(wi.manual_text, '') || ' ' || COALESCE(wi.notes, '')), '') IS NOT NULL`
  );

  return result.rows.map((row) => {
    const item = rowToCamelCase(row);
    const textParts = [];
    if (normalizedText(item.manualText)) textParts.push(`Manual text: ${item.manualText.trim()}`);
    if (normalizedText(item.notes)) textParts.push(`Notes: ${item.notes.trim()}`);
    return buildSnapshotItem({
      contentType: 'wishlist_item',
      contentId: item.contentId,
      authorUserId: item.authorUserId,
      authorUsername: item.authorUsername,
      title: item.wishlistName ? `Wishlist item on ${item.wishlistName}` : `Wishlist item ${item.contentId}`,
      text: normalizedText(textParts.join('\n\n')),
      mediaRefs: [],
      visibility: null,
      createdAt: item.createdAt,
      updatedAt: item.createdAt,
      sourceEntityId: item.wishlistId,
      sourceRoute: `/moderation?contentType=wishlist_item&contentId=${encodeURIComponent(String(item.contentId))}`,
      metadata: {
        wishlistId: item.wishlistId,
        wishlistName: item.wishlistName || null,
        manualText: normalizedText(item.manualText),
        notes: normalizedText(item.notes),
      },
    });
  });
}

async function fetchProfileMediaItems() {
  const result = await query(
    `SELECT pm.id AS content_id,
            pm.id AS source_entity_id,
            pm.user_id AS author_user_id,
            u.username AS author_username,
            pm.local_path,
            u.picture,
            CASE WHEN u.is_private THEN 'private' ELSE 'public' END AS visibility,
            pm.created_at,
            pm.updated_at
     FROM profile_media pm
     JOIN users u ON u.profile_media_id = pm.id`
  );

  return result.rows.map((row) => {
    const item = rowToCamelCase(row);
    return buildSnapshotItem({
      contentType: 'profile_media',
      contentId: item.contentId,
      authorUserId: item.authorUserId,
      authorUsername: item.authorUsername,
      title: `Profile media for @${item.authorUsername || 'unknown'}`,
      text: null,
      mediaRefs: buildMediaRefs(
        { kind: 'profile_media', path: item.localPath, label: 'Avatar' },
        { kind: 'picture', url: item.picture, label: 'Profile picture' }
      ),
      visibility: item.visibility,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      sourceEntityId: item.authorUserId,
      sourceRoute: `/users?selectedUserId=${encodeURIComponent(String(item.authorUserId))}`,
      metadata: {
        profileMediaId: item.contentId,
        picture: item.picture || null,
      },
    });
  });
}

async function fetchOwnerPhotoItems() {
  const result = await query(
    `SELECT uc.id AS content_id,
            uc.id AS source_entity_id,
            uc.user_id AS author_user_id,
            u.username AS author_username,
            uc.shelf_id,
            s.name AS shelf_name,
            uc.owner_photo_storage_key,
            uc.owner_photo_thumb_storage_key,
            uc.owner_photo_visible,
            uc.owner_photo_updated_at,
            uc.created_at
     FROM user_collections uc
     LEFT JOIN users u ON u.id = uc.user_id
     LEFT JOIN shelves s ON s.id = uc.shelf_id
     WHERE uc.owner_photo_source IS NOT NULL`
  );

  return result.rows.map((row) => {
    const item = rowToCamelCase(row);
    const mediaPath = item.ownerPhotoThumbStorageKey || item.ownerPhotoStorageKey;
    return buildSnapshotItem({
      contentType: 'owner_photo',
      contentId: item.contentId,
      authorUserId: item.authorUserId,
      authorUsername: item.authorUsername,
      title: item.shelfName ? `Owner photo on ${item.shelfName}` : `Owner photo ${item.contentId}`,
      text: null,
      mediaRefs: buildMediaRefs(
        mediaPath ? {
          kind: 'owner_photo',
          path: mediaPath,
          label: 'Owner photo',
          visible: item.ownerPhotoVisible !== false,
        } : null
      ),
      visibility: item.ownerPhotoVisible === false ? 'hidden' : 'visible',
      createdAt: item.createdAt,
      updatedAt: item.ownerPhotoUpdatedAt || item.createdAt,
      sourceEntityId: item.shelfId,
      sourceRoute: `/content?selectedShelfId=${encodeURIComponent(String(item.shelfId))}`,
      metadata: {
        shelfId: item.shelfId,
        shelfName: item.shelfName || null,
      },
    });
  });
}

async function fetchLiveItemsByType(contentType = null) {
  const fetchers = {
    profile_bio: fetchProfileBioItems,
    shelf: fetchShelfItems,
    shelf_item_note: fetchShelfItemNoteItems,
    event_note: fetchEventNoteItems,
    event_comment: fetchEventCommentItems,
    user_list: fetchUserListItems,
    user_list_item: fetchUserListItemNoteItems,
    wishlist: fetchWishlistItems,
    wishlist_item: fetchWishlistItemItems,
    profile_media: fetchProfileMediaItems,
    owner_photo: fetchOwnerPhotoItems,
  };

  if (contentType) {
    return fetchers[normalizeContentType(contentType)]();
  }

  const entries = await Promise.all(Object.values(fetchers).map((fn) => fn()));
  return entries.flat();
}

function matchesSearch(item, search) {
  if (!search) return true;
  const needle = String(search).trim().toLowerCase();
  if (!needle) return true;
  return [
    item.contentType,
    item.authorUsername,
    item.title,
    item.text,
    item.visibility,
    item.sourceRoute,
    item.metadata?.shelfName,
    item.metadata?.listName,
    item.metadata?.wishlistName,
    item.metadata?.eventType,
  ].some((value) => lowerIncludes(value, needle));
}

async function listModerationItems({
  limit = 50,
  cursor = null,
  updatedSince = null,
  contentType = null,
  status = null,
  search = '',
} = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
  const parsedCursor = decodeCursor(cursor);
  const updatedSinceDate = updatedSince ? toDateValue(updatedSince) : null;

  const [states, liveItems] = await Promise.all([
    listModerationEntities({ contentType }),
    fetchLiveItemsByType(contentType),
  ]);

  const stateMap = new Map(states.map((item) => [entityKey(item.contentType, item.contentId), item]));
  const liveMap = new Map();
  const merged = [];

  for (const item of liveItems) {
    const key = entityKey(item.contentType, item.contentId);
    liveMap.set(key, item);
    merged.push(buildModerationItem(item, stateMap.get(key) || null));
  }

  for (const state of states) {
    const key = entityKey(state.contentType, state.contentId);
    if (liveMap.has(key)) continue;
    const fallback = buildFallbackItemFromState(state);
    if (fallback) {
      merged.push(fallback);
    }
  }

  const filtered = merged.filter((item) => {
    if (status && status !== 'all' && item.status !== status) return false;
    if (updatedSinceDate) {
      const itemDate = toDateValue(item.updatedAt);
      if (!itemDate || itemDate.getTime() < updatedSinceDate.getTime()) return false;
    }
    if (!matchesSearch(item, search)) return false;
    return isAfterCursor(item, parsedCursor);
  });

  filtered.sort(compareItemsDesc);

  const page = filtered.slice(0, safeLimit + 1);
  const hasMore = page.length > safeLimit;
  const items = page.slice(0, safeLimit);
  const actionsByKey = await listRecentActionsForItems(items);
  for (const item of items) {
    item.priorModerationActions = actionsByKey.get(entityKey(item.contentType, item.contentId)) || [];
  }

  return {
    items,
    nextCursor: hasMore ? encodeCursor(items[items.length - 1]) : null,
    hasMore,
  };
}

async function getModerationItem(contentType, contentId) {
  const normalizedType = normalizeContentType(contentType);
  const normalizedId = normalizeContentId(contentId);
  const result = await listModerationItems({
    limit: 5000,
    contentType: normalizedType,
  });
  return result.items.find((item) => normalizeContentId(item.contentId) === normalizedId) || null;
}

async function clearProfileBio(userId, text) {
  const result = await query(
    `UPDATE users
     SET bio = $2
     WHERE id = $1
     RETURNING id, bio`,
    [userId, text]
  );
  return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

async function setShelfVisibility(shelfId, visibility) {
  const result = await query(
    `UPDATE shelves
     SET visibility = $2
     WHERE id = $1
     RETURNING id, visibility`,
    [Number(shelfId), visibility]
  );
  return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

async function setShelfItemNotes(itemId, notes) {
  const result = await query(
    `UPDATE user_collections
     SET notes = $2
     WHERE id = $1
     RETURNING id, notes`,
    [Number(itemId), notes]
  );
  return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

async function setEventNote(eventId, note) {
  const result = await query(
    `UPDATE event_aggregates
     SET note = $2,
         last_activity_at = NOW()
     WHERE id = $1
     RETURNING id, note`,
    [eventId, note]
  );
  return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

async function deleteEventComment(commentId) {
  const existing = await query(
    `SELECT ec.id, ec.event_id, ec.user_id, ec.content, ec.created_at
     FROM event_comments ec
     WHERE ec.id = $1
     LIMIT 1`,
    [Number(commentId)]
  );
  if (!existing.rows[0]) return null;

  await query(
    `DELETE FROM event_comments
     WHERE id = $1`,
    [Number(commentId)]
  );

  return rowToCamelCase(existing.rows[0]);
}

async function setUserListVisibility(listId, visibility) {
  const result = await query(
    `UPDATE user_lists
     SET visibility = $2,
         updated_at = NOW()
     WHERE id = $1
     RETURNING id, visibility`,
    [Number(listId), visibility]
  );
  return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

async function setUserListItemNotes(itemId, notes) {
  const result = await query(
    `UPDATE user_list_items
     SET notes = $2
     WHERE id = $1
     RETURNING id, notes`,
    [Number(itemId), notes]
  );
  return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

async function setWishlistVisibility(wishlistId, visibility) {
  const result = await query(
    `UPDATE wishlists
     SET visibility = $2,
         updated_at = NOW()
     WHERE id = $1
     RETURNING id, visibility`,
    [Number(wishlistId), visibility]
  );
  return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

async function setWishlistItemFields(itemId, { manualText = undefined, notes = undefined } = {}) {
  const updates = [];
  const values = [];
  let idx = 1;
  if (manualText !== undefined) {
    updates.push(`manual_text = $${idx++}`);
    values.push(manualText);
  }
  if (notes !== undefined) {
    updates.push(`notes = $${idx++}`);
    values.push(notes);
  }
  if (updates.length === 0) return null;

  values.push(Number(itemId));
  const result = await query(
    `UPDATE wishlist_items
     SET ${updates.join(', ')}
     WHERE id = $${idx}
     RETURNING id, manual_text, notes`,
    values
  );
  return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

async function hideProfileMediaWithSnapshot(snapshot) {
  const existing = await query(
    `SELECT id, profile_media_id, picture
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [snapshot.authorUserId]
  );
  if (!existing.rows[0]) return null;

  const result = await query(
    `UPDATE users
     SET profile_media_id = NULL,
         picture = NULL,
         updated_at = NOW()
     WHERE id = $1
     RETURNING id`,
    [snapshot.authorUserId]
  );

  return {
    user: result.rows[0] ? rowToCamelCase(result.rows[0]) : null,
    previous: rowToCamelCase(existing.rows[0]),
  };
}

async function restoreProfileMediaFromSnapshot(snapshot) {
  const mediaId = snapshot?.metadata?.profileMediaId ?? snapshot?.contentId;
  const picture = snapshot?.metadata?.picture ?? null;
  const result = await query(
    `UPDATE users
     SET profile_media_id = $2,
         picture = $3,
         updated_at = NOW()
     WHERE id = $1
     RETURNING id, profile_media_id, picture`,
    [snapshot.authorUserId, mediaId ? Number(mediaId) : null, picture]
  );
  return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

async function setOwnerPhotoVisible(itemId, visible) {
  const result = await query(
    `UPDATE user_collections
     SET owner_photo_visible = $2,
         owner_photo_updated_at = NOW()
     WHERE id = $1
     RETURNING id, owner_photo_visible`,
    [Number(itemId), visible]
  );
  return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

async function applyMutationForAction({ action, snapshot, previousState }) {
  switch (snapshot.contentType) {
    case 'profile_bio':
      if (action === 'clear') return clearProfileBio(snapshot.authorUserId, null);
      if (action === 'restore') return clearProfileBio(snapshot.authorUserId, previousState?.evidenceSnapshot?.text || snapshot.text || null);
      break;
    case 'shelf':
      if (action === 'hide') return setShelfVisibility(snapshot.contentId, 'private');
      if (action === 'unhide') {
        return setShelfVisibility(
          snapshot.contentId,
          previousState?.evidenceSnapshot?.visibility || snapshot.visibility || 'public'
        );
      }
      break;
    case 'shelf_item_note':
      if (action === 'clear') return setShelfItemNotes(snapshot.contentId, null);
      if (action === 'restore') return setShelfItemNotes(snapshot.contentId, previousState?.evidenceSnapshot?.text || snapshot.text || null);
      break;
    case 'event_note':
      if (action === 'clear') return setEventNote(snapshot.contentId, null);
      if (action === 'restore') return setEventNote(snapshot.contentId, previousState?.evidenceSnapshot?.text || snapshot.text || null);
      break;
    case 'event_comment':
      if (action === 'delete') return deleteEventComment(snapshot.contentId);
      break;
    case 'user_list':
      if (action === 'hide') return setUserListVisibility(snapshot.contentId, 'private');
      if (action === 'unhide') {
        return setUserListVisibility(
          snapshot.contentId,
          previousState?.evidenceSnapshot?.visibility || snapshot.visibility || 'public'
        );
      }
      break;
    case 'user_list_item':
      if (action === 'clear') return setUserListItemNotes(snapshot.contentId, null);
      if (action === 'restore') return setUserListItemNotes(snapshot.contentId, previousState?.evidenceSnapshot?.text || snapshot.text || null);
      break;
    case 'wishlist':
      if (action === 'hide') return setWishlistVisibility(snapshot.contentId, 'private');
      if (action === 'unhide') {
        return setWishlistVisibility(
          snapshot.contentId,
          previousState?.evidenceSnapshot?.visibility || snapshot.visibility || 'public'
        );
      }
      break;
    case 'wishlist_item':
      if (action === 'clear') {
        return setWishlistItemFields(snapshot.contentId, { manualText: null, notes: null });
      }
      if (action === 'restore') {
        return setWishlistItemFields(snapshot.contentId, {
          manualText: previousState?.evidenceSnapshot?.metadata?.manualText || null,
          notes: previousState?.evidenceSnapshot?.metadata?.notes || null,
        });
      }
      break;
    case 'profile_media':
      if (action === 'hide') return hideProfileMediaWithSnapshot(snapshot);
      if (action === 'unhide') return restoreProfileMediaFromSnapshot(previousState?.evidenceSnapshot || snapshot);
      break;
    case 'owner_photo':
      if (action === 'hide') return setOwnerPhotoVisible(snapshot.contentId, false);
      if (action === 'unhide') return setOwnerPhotoVisible(snapshot.contentId, true);
      break;
    default:
      break;
  }

  throw new Error(`Unsupported moderation action ${action} for ${snapshot.contentType}`);
}

function resultingStatusForAction({ action, execute, currentStatus }) {
  if (!execute) return 'flagged';
  switch (action) {
    case 'hide':
      return 'hidden';
    case 'unhide':
      return 'active';
    case 'clear':
      return 'cleared';
    case 'restore':
      return 'active';
    case 'delete':
      return 'deleted';
    default:
      return currentStatus || 'active';
  }
}

async function getModerationMetrics() {
  const [stateCounts, botActionResult, alertsResult] = await Promise.all([
    query(
      `SELECT status, COUNT(*)::int AS count
       FROM moderation_entities
       GROUP BY status`
    ),
    query(
      `SELECT COUNT(*)::int AS count
       FROM admin_action_logs
       WHERE action LIKE 'MODERATION_%'
         AND metadata->>'actorType' = 'bot'
         AND created_at >= NOW() - INTERVAL '24 hours'`
    ),
    query(
      `SELECT MAX(alerts_sent_at) AS last_alert_sent_at
       FROM moderation_entities
       WHERE alerts_sent_at IS NOT NULL`
    ),
  ]);

  const counts = {
    active: 0,
    flagged: 0,
    hidden: 0,
    cleared: 0,
    deleted: 0,
  };
  for (const row of stateCounts.rows) {
    counts[row.status] = Number.parseInt(row.count, 10) || 0;
  }

  return {
    counts,
    recentBotActions24h: Number.parseInt(botActionResult.rows[0]?.count || 0, 10),
    lastAlertSentAt: alertsResult.rows[0]?.last_alert_sent_at || null,
  };
}

module.exports = {
  CONTENT_TYPES: Array.from(CONTENT_TYPES),
  STATUS_VALUES: Array.from(STATUS_VALUES),
  ACTOR_TYPES: Array.from(ACTOR_TYPES),
  getAvailableActions,
  listModerationItems,
  getModerationItem,
  getModerationEntity,
  upsertModerationEntity,
  getModerationMetrics,
  resultingStatusForAction,
  applyMutationForAction,
  buildSnapshotItem,
};
