const {
  makeLightweightFingerprint,
  makeVisionOcrFingerprint,
  normalizeFingerprintComponent,
  makeCollectableFingerprint,
  makeManualFingerprint,
} = require('../services/collectables/fingerprint');
const crypto = require('crypto');
const { BookCatalogService } = require("../services/catalog/BookCatalogService");
const { GameCatalogService } = require("../services/catalog/GameCatalogService");
const { MovieCatalogService } = require("../services/catalog/MovieCatalogService");
// const { GoogleCloudVisionService } = require('../services/googleCloudVision'); // Temporarily disabled; keep for easy re-enable.
const { VisionPipelineService } = require('../services/visionPipeline');
const { getVisionPipelineHooks } = require('../services/visionPipelineHooks');
const processingStatus = require('../services/processingStatus');

// PostgreSQL imports
const { query, transaction } = require('../database/pg');
const shelvesQueries = require('../database/queries/shelves');
const collectablesQueries = require('../database/queries/collectables');
const ratingsQueries = require('../database/queries/ratings');
const feedQueries = require('../database/queries/feed');
const { rowToCamelCase, parsePagination } = require('../database/queries/utils');
const { resolveMediaUrl } = require('../services/mediaUrl');
const needsReviewQueries = require('../database/queries/needsReview');
const visionQuotaQueries = require('../database/queries/visionQuota');
const manualMediaQueries = require('../database/queries/manualMedia');
const visionScanPhotosQueries = require('../database/queries/visionScanPhotos');
const visionItemRegionsQueries = require('../database/queries/visionItemRegions');
const visionItemCropsQueries = require('../database/queries/visionItemCrops');
const workflowQueueJobsQueries = require('../database/queries/workflowQueueJobs');
const userCollectionPhotosQueries = require('../database/queries/userCollectionPhotos');
const itemReplacementTracesQueries = require('../database/queries/itemReplacementTraces');
const { getCollectableMatchingService } = require('../services/collectableMatchingService');
const { getWorkflowQueueService } = require('../services/workflowQueueService');
const { getWorkflowQueueSettings } = require('../services/workflow/workflowSettings');
const { extractRegionCrop } = require('../services/visionCropper');
const { validateImageBuffer } = require('../utils/imageValidation');
const {
  normalizeOtherManualItem,
  buildOtherManualPayload,
  hasRequiredOtherFields,
  evaluateOtherManualFuzzyCandidate,
  OTHER_MANUAL_FUZZY_REVIEW_MIN_THRESHOLD,
} = require('../services/manuals/otherManual');
const { normalizeString, normalizeStringArray } = require('../utils/normalize');
const visionResultCacheQueries = require('../database/queries/visionResultCache');
const logger = require('../logger');
const {
  DEFAULT_OCR_CONFIDENCE_THRESHOLD,
  DEFAULT_AI_REVIEW_CONFIDENCE_THRESHOLD,
  OCR_CONFIDENCE_THRESHOLD,
  AI_REVIEW_CONFIDENCE_THRESHOLD,
} = require('../config/constants');



// let visionService;
// function getVisionService() {
//   if (!visionService) {
//     visionService = new GoogleCloudVisionService();
//   }
//   return visionService;
// }

const VISIBILITY_OPTIONS = ["private", "friends", "public"];
const OTHER_SHELF_TYPE = "other";
const OTHER_SHELF_DESCRIPTION_REQUIRED_ERROR = 'Description is required when shelf type is "other".';
const REPLACEMENT_TRIGGER_SOURCES = new Set(['collectable_detail', 'shelf_delete_modal']);
const REPLACEMENT_WINDOW_HOURS = {
  collectable_detail: 72,
  shelf_delete_modal: 24,
};
const OWNED_GAME_FORMATS = new Set(['physical', 'digital']);

const VISION_PROMPT_RULES = [
  {
    match: ["book", "books", "novel", "novels", "comic", "manga"],
    prompt: `You are assisting with cataloging physical collections. The user has indicated that this photo is a single book or a collection of books. Provide the canonical title, the primary author, and the physical format (e.g., hardcover, paperback, omnibus). Preserve accents, diacritics, and any mixed-language words exactly as printed; do not anglicize, translate, or substitute similarly sounding English phrases. If characters are ambiguous, match the visible glyphs rather than guessing a different word. Always populate the "genre" field when known. Include "coordinates" in the format of "x,y" describing the relative physical location in the photo. Zoom into the photo if needed. Do not include explanations.`,
  },
  {
    match: ["movie", "movies", "film", "films", "blu-ray", "dvd", "4k"],
    prompt: `You are assisting with cataloging physical collections. The user has indicated that this photo is a movie or a collection of movies. Report the primary director in the "author" field, use "format" for the medium (Blu-ray, DVD, 4K, digital, etc.), use "publisher" for the studio or distributor, and provide the original release year. Always populate the "genre" field when known. If any metadata is missing, research reliable film databases before responding. Include "coordinates" in the format of "x,y" describing the relative physical location in the photo. Do not include explanations.`,
  },
  {
    match: ["game", "games", "video game", "video games", "board game", "board games"],
    prompt: `You are assisting with cataloging physical collections. The user has indicated that this photo is a game or a collection of games. For video games, place the primary developer or studio in "primaryCreator" and also in "developer", set "format" to "physical", set "systemName" to the exact hardware/platform name, capture the publishing company in "publisher", note the release region in "region" when visible, include direct links in "urlCoverFront" and "urlCoverBack" when discernible, and provide the release year in "year". Always populate the "genre" field when known. For board games, use the lead designer in "author" and the publisher in "publisher". Search authoritative sources when information is missing. Include "coordinates" in the format of "x,y" describing the relative physical location in the photo. Do not include explanations.`,
  },
  {
    match: ["music", "album", "albums", "vinyl", "records", "cd", "cds"],
    prompt: `You are assisting with cataloging physical collections. The user has indicated that this photo is a music collection (vinyl, CDs, tapes, etc.) Use "author" for the primary artist, "format" for the medium or edition, "publisher" for the record label, and "year" for the original release or pressing year. Always populate the "genre" field when known. If any detail is missing, consult trusted music databases before responding. Include "coordinates" in the format of "x,y" describing the relative physical location in the photo. Do not include explanations.`,
  },
  {
    match: ["wine", "wines", "spirits", "liquor", "whisky", "whiskey", "bourbon", "tequila"],
    prompt: `You are assisting with cataloging physical collections. The user has indicated that this photo is a collection of wine or spirits. Use "author" for the producer, winery, or distillery, "format" for the varietal or bottle/edition details, "publisher" for the region or bottler, and "year" for the vintage or bottling year. Always populate the "genre" field when known. If any metadata is missing, research reputable wine or spirits sources before responding. Include "coordinates" in the format of "x,y" describing the relative physical location in the photo. Do not include explanations.`,
  },
];

function coerceNumber(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return [value];
}

function normalizeOwnedPlatforms(value) {
  if (value == null) return [];
  const source = Array.isArray(value) ? value : [value];
  const seen = new Set();
  const out = [];
  for (const entry of source) {
    const normalized = normalizeString(entry);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function normalizeOwnedGameFormat(value) {
  const normalizedValue = normalizeString(value);
  if (!normalizedValue) return null;
  const normalized = normalizedValue.toLowerCase();
  if (!normalized) return null;
  return OWNED_GAME_FORMATS.has(normalized) ? normalized : null;
}

function normalizePlatformData(value) {
  if (value == null) return [];
  const source = Array.isArray(value) ? value : [value];
  const seen = new Set();
  const out = [];
  for (const entry of source) {
    if (!entry || typeof entry !== 'object') continue;
    const igdbPlatformIdRaw = entry.igdbPlatformId ?? entry.igdb_platform_id ?? entry.id ?? null;
    const parsedIgdbPlatformId = parseInt(igdbPlatformIdRaw, 10);
    const igdbPlatformId = Number.isFinite(parsedIgdbPlatformId) ? parsedIgdbPlatformId : null;
    const name = normalizeString(entry.name) || null;
    const abbreviation = normalizeString(entry.abbreviation || entry.abbr) || null;
    if (!name && !abbreviation) continue;
    const normalized = {
      provider: normalizeString(entry.provider || entry.source || 'igdb') || 'igdb',
      igdbPlatformId,
      name,
      abbreviation,
      sourceType: normalizeString(entry.sourceType || entry.source_type) || null,
      releaseDate: normalizeString(entry.releaseDate || entry.release_date) || null,
      releaseDateHuman: normalizeString(entry.releaseDateHuman || entry.release_date_human) || null,
      releaseRegion: normalizeString(entry.releaseRegion || entry.release_region) || null,
      releaseRegionName: normalizeString(entry.releaseRegionName || entry.release_region_name) || null,
    };
    const dedupeKey = [
      normalized.igdbPlatformId != null ? String(normalized.igdbPlatformId) : '',
      String(normalized.name || '').toLowerCase(),
      String(normalized.abbreviation || '').toLowerCase(),
      String(normalized.sourceType || '').toLowerCase(),
      String(normalized.releaseRegion || '').toLowerCase(),
      String(normalized.releaseDate || '').toLowerCase(),
    ].join('::');
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(normalized);
  }
  return out;
}

function derivePlatformNames({ platformData = [], platforms = [], systemName = null }) {
  const seen = new Set();
  const out = [];
  const push = (value) => {
    const normalized = normalizeString(value);
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(normalized);
  };

  normalizeOwnedPlatforms(platforms).forEach(push);
  normalizePlatformData(platformData).forEach((entry) => {
    push(entry.name);
    push(entry.abbreviation);
  });
  push(systemName);
  return out;
}

function isGamesCollectable(collectable) {
  const kind = normalizeString(collectable?.kind || collectable?.type).toLowerCase();
  return kind === 'games' || kind === 'game';
}

async function seedDefaultOwnedPlatformForGameItem({ itemId, collectable, client = null }) {
  if (!itemId || !isGamesCollectable(collectable)) return [];
  const defaultPlatform = normalizeString(
    collectable?.systemName || collectable?.system_name,
  );
  if (!defaultPlatform) return [];
  if (typeof shelvesQueries.ensureOwnedPlatformsForCollectionItem !== 'function') return [];
  return shelvesQueries.ensureOwnedPlatformsForCollectionItem(
    { collectionItemId: itemId, platforms: [defaultPlatform] },
    client,
  );
}

function normalizeIdentifiers(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

function normalizeCastName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeCastMembers(value) {
  if (!value) return [];
  const source = Array.isArray(value) ? value : [value];
  const out = [];
  for (const entry of source) {
    let name = '';
    let personId = null;
    let character = null;
    let order = null;
    let profilePath = null;

    if (typeof entry === 'string') {
      name = normalizeString(entry);
    } else if (entry && typeof entry === 'object') {
      name = normalizeString(entry.name);
      const parsedPersonId = parseInt(entry.personId ?? entry.person_id ?? entry.id, 10);
      personId = Number.isFinite(parsedPersonId) ? parsedPersonId : null;
      character = normalizeString(entry.character || entry.role) || null;
      const parsedOrder = parseInt(entry.order ?? entry.castOrder ?? entry.cast_order, 10);
      order = Number.isFinite(parsedOrder) ? parsedOrder : null;
      profilePath = normalizeString(entry.profilePath || entry.profile_path) || null;
    } else {
      continue;
    }

    if (!name) continue;
    const nameNormalized = normalizeCastName(name);
    if (!nameNormalized) continue;

    out.push({
      personId,
      name,
      nameNormalized,
      character,
      order,
      profilePath,
    });
  }
  return out;
}

function isOtherShelfType(value) {
  return String(value || "").trim().toLowerCase() === OTHER_SHELF_TYPE;
}

function hasShelfDescription(value) {
  return !!normalizeString(value);
}

function normalizeSourceLinks(value) {
  if (value == null) return [];
  const source = Array.isArray(value) ? value : [value];
  return source
    .map((entry) => {
      if (!entry) return null;
      if (typeof entry === 'string') {
        const url = normalizeString(entry);
        return url ? { url } : null;
      }
      if (typeof entry === 'object') {
        const url = normalizeString(entry.url || entry.link || entry.href);
        if (!url) return null;
        const label = normalizeString(entry.label || entry.name || entry.title);
        return label ? { url, label } : { url };
      }
      return null;
    })
    .filter(Boolean);
}

function decodeImageBase64Payload(imageBase64) {
  const raw = String(imageBase64 || '');
  const match = /^data:image\/[a-zA-Z0-9.+-]+;base64,(.*)$/.exec(raw);
  return match ? match[1] : raw;
}

function computeImageSha256(imageBase64) {
  const payload = decodeImageBase64Payload(imageBase64);
  const bytes = Buffer.from(payload, 'base64');
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function isMissingRelationError(err, relationName) {
  if (!err) return false;
  if (err.code === '42P01') return true;
  if (!relationName) return false;
  return String(err.message || '').includes(relationName);
}

function getRegionBox2d(region) {
  if (!region || typeof region !== 'object') return null;
  if (Array.isArray(region.box2d)) return region.box2d;
  if (Array.isArray(region.box_2d)) return region.box_2d;
  return null;
}

function sanitizeBox2dForLog(box2d) {
  if (!Array.isArray(box2d)) return null;
  return box2d.slice(0, 4).map((value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return Math.round(numeric * 1000) / 1000;
  });
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  return fallback;
}

function parseBooleanFlag(value, defaultValue = false) {
  if (value == null || value === '') return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function buildHttpError(status, message, code = null) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

function isWithinHoursWindow(value, hours) {
  if (!value || !Number.isFinite(hours) || hours <= 0) return false;
  const timestamp = Date.parse(String(value));
  if (!Number.isFinite(timestamp)) return false;
  return (Date.now() - timestamp) <= (hours * 60 * 60 * 1000);
}

const VISION_CROP_WARMUP_ENABLED = parseBooleanFlag(process.env.VISION_CROP_WARMUP_ENABLED, true);
const VISION_CROP_WARMUP_MAX_REGIONS = parsePositiveInt(process.env.VISION_CROP_WARMUP_MAX_REGIONS, 50);
const VISION_CROP_WARMUP_PRESSURE_MAX_REGIONS = parsePositiveInt(
  process.env.VISION_CROP_WARMUP_PRESSURE_MAX_REGIONS,
  10,
);
const VISION_CROP_WARMUP_DEFER_QUEUE_DEPTH = parsePositiveInt(
  process.env.VISION_CROP_WARMUP_DEFER_QUEUE_DEPTH,
  12,
);
const OWNER_PHOTO_DEBUG_ENABLED = parseBooleanFlag(process.env.OWNER_PHOTO_DEBUG_ENABLED, false);
const OWNER_PHOTO_DEBUG_ITEM_ID = parsePositiveInt(process.env.OWNER_PHOTO_DEBUG_ITEM_ID, null);
const FEED_MICRO_DEBUG_ENABLED = parseBooleanFlag(process.env.FEED_MICRO_DEBUG_ENABLED, false);
const WORKFLOW_TYPE_VISION = 'vision';
const WORKFLOW_QUEUE_WAIT_SECONDS_PER_JOB = parsePositiveInt(
  process.env.WORKFLOW_QUEUE_WAIT_SECONDS_PER_JOB,
  15,
);
const WORKFLOW_QUEUE_NOTIFY_FORCE_LONG_POSITION = parsePositiveInt(
  process.env.WORKFLOW_QUEUE_NOTIFY_FORCE_LONG_POSITION,
  3,
);
const WORKFLOW_QUEUE_NOTIFY_FORCE_MIN_WAIT_MS = parsePositiveInt(
  process.env.WORKFLOW_QUEUE_NOTIFY_FORCE_MIN_WAIT_MS,
  20000,
);

function shouldLogOwnerPhotoDebug(itemId = null) {
  if (!OWNER_PHOTO_DEBUG_ENABLED) return false;
  if (!OWNER_PHOTO_DEBUG_ITEM_ID) return true;
  return Number(itemId) === Number(OWNER_PHOTO_DEBUG_ITEM_ID);
}

function sanitizeThumbnailBoxForLog(box) {
  if (!box || typeof box !== 'object') return null;
  const toRounded = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.round(n * 1000000) / 1000000;
  };
  return {
    x: toRounded(box.x),
    y: toRounded(box.y),
    width: toRounded(box.width),
    height: toRounded(box.height),
  };
}

function logOwnerPhotoDebug(stage, payload = {}) {
  if (!OWNER_PHOTO_DEBUG_ENABLED) return;
  logger.info(`[OwnerPhotoDebug] ${stage}`, payload);
}

function logFeedMicro(stage, payload = {}) {
  if (!FEED_MICRO_DEBUG_ENABLED) return;
  logger.info(`[FeedMicro] ${stage}`, payload);
}

function buildVisionCounts(result = {}, options = {}) {
  const { cached = false } = options;
  const addedCount = result.addedItems?.length || result.results?.added || 0;
  const needsReviewCount = result.needsReview?.length || result.results?.needsReview || 0;
  const existingCount = result.results?.existing || 0;
  const extractedCount = result.results?.extracted || result.analysis?.items?.length || 0;
  const summaryMessage = buildVisionCompletionMessage({
    addedCount,
    existingCount,
    needsReviewCount,
    extractedCount,
    cached,
  });
  return {
    addedCount,
    needsReviewCount,
    existingCount,
    extractedCount,
    summaryMessage,
  };
}

function buildVisionQueueDedupeKey({ userId, shelfId, imageSha256 }) {
  if (!userId || !shelfId || !imageSha256) return null;
  return `vision:${userId}:${shelfId}:${imageSha256}`;
}

function estimateQueueWaitSeconds(position) {
  if (!Number.isFinite(Number(position)) || Number(position) <= 1) return 0;
  return Math.max(0, (Number(position) - 1) * WORKFLOW_QUEUE_WAIT_SECONDS_PER_JOB);
}

function getQueuedMs(createdAt) {
  if (!createdAt) return 0;
  const ts = Date.parse(String(createdAt));
  if (!Number.isFinite(ts)) return 0;
  return Math.max(0, Date.now() - ts);
}

async function getQueueMetadata(jobId) {
  const queuePosition = await workflowQueueJobsQueries.getQueuePosition(jobId);
  const estimatedWaitSeconds = estimateQueueWaitSeconds(queuePosition);
  return {
    queuePosition,
    estimatedWaitSeconds,
  };
}

async function shouldEnableQueueNotification({ queuePosition, estimatedWaitSeconds }) {
  const settings = await getWorkflowQueueSettings();
  const positionThreshold = Math.max(
    WORKFLOW_QUEUE_NOTIFY_FORCE_LONG_POSITION,
    settings.workflowQueueLongThresholdPosition,
  );
  const waitThresholdMs = Math.max(
    WORKFLOW_QUEUE_NOTIFY_FORCE_MIN_WAIT_MS,
    settings.workflowQueueNotifyMinWaitMs,
  );
  const waitMs = Math.max(0, (Number(estimatedWaitSeconds) || 0) * 1000);
  return (Number(queuePosition) || 0) >= positionThreshold || waitMs >= waitThresholdMs;
}

function buildCollectableUpsertPayload(input, shelfType) {
  const title = normalizeString(input?.title || input?.name);
  if (!title) return null;

  const kind = normalizeString(input?.kind || input?.type || shelfType || 'item') || 'item';
  const primaryCreator = normalizeString(
    input?.primaryCreator || input?.author || input?.creator,
  );
  const creators = normalizeStringArray(input?.creators, primaryCreator);
  const publishers = normalizeStringArray(input?.publishers, input?.publisher);
  const genre = normalizeStringArray(input?.genre, input?.genres);
  const tags = normalizeStringArray(input?.tags, input?.genre, input?.genres);
  const identifiers = normalizeIdentifiers(input?.identifiers);
  const images = normalizeArray(input?.images);
  const sources = normalizeArray(input?.sources);
  const hasCastMembers = (
    Object.prototype.hasOwnProperty.call(input || {}, 'castMembers')
    || Object.prototype.hasOwnProperty.call(input || {}, 'cast_members')
  );
  const castMembers = hasCastMembers
    ? normalizeCastMembers(input?.castMembers ?? input?.cast_members)
    : undefined;
  const coverUrl = normalizeString(
    input?.coverUrl ||
    input?.coverImage ||
    input?.image ||
    input?.urlCoverFront ||
    input?.urlCoverBack,
  );
  const coverImageUrl = normalizeString(input?.coverImageUrl);
  const coverImageSource =
    typeof input?.coverImageSource === 'string' ? input.coverImageSource : null;
  const attribution =
    input?.attribution && typeof input.attribution === 'object'
      ? input.attribution
      : null;
  const externalId = normalizeString(input?.externalId || input?.catalogId);
  const fuzzyFingerprints = normalizeArray(input?.fuzzyFingerprints);
  const year = normalizeString(
    input?.year || input?.releaseYear || input?.publishYear,
  );
  const marketValue = normalizeString(
    input?.marketValue || input?.market_value || input?.estimatedMarketValue,
  );
  const marketValueSources = normalizeSourceLinks(
    input?.marketValueSources || input?.market_value_sources || input?.marketSources,
  );
  const subtitle = normalizeString(input?.subtitle);
  const description = normalizeString(input?.description);
  const platforms = normalizeStringArray(
    input?.platforms,
    input?.platform,
    input?.systemName,
  );
  const platformData = normalizePlatformData(
    input?.platformData
    ?? input?.platform_data
    ?? input?.platforms,
  );
  const format = normalizeString(input?.format || input?.physical?.format);
  const formats = normalizeStringArray(input?.formats, format);
  const systemName =
    normalizeString(input?.systemName) || (platforms.length ? platforms[0] : null);
  const runtime = coerceNumber(input?.runtime ?? input?.extras?.runtime, null);
  const normalizedGenre = genre.length ? genre : null;

  const fingerprint =
    input?.fingerprint ||
    makeCollectableFingerprint({
      title,
      primaryCreator: primaryCreator || null,
      releaseYear: year || null,
      mediaType: kind,
      platforms: platforms.length ? platforms : undefined,
    });

  const lightweightFingerprint =
    input?.lightweightFingerprint ||
    makeLightweightFingerprint({
      title,
      primaryCreator: primaryCreator || null,
      kind,
      platforms: platforms.length ? platforms : undefined,
    });

  return {
    fingerprint,
    lightweightFingerprint,
    kind,
    title,
    subtitle,
    description,
    primaryCreator,
    creators,
    publishers,
    year,
    marketValue,
    marketValueSources,
    formats,
    systemName,
    platformData,
    genre: normalizedGenre,
    runtime,
    tags,
    identifiers,
    images,
    coverUrl,
    sources,
    externalId,
    fuzzyFingerprints,
    coverImageUrl,
    coverImageSource,
    attribution,
    ...(hasCastMembers ? { castMembers } : {}),
  };
}

function parsePaginationParams(reqQuery, { defaultLimit = 20, maxLimit = 100 } = {}) {
  const rawLimit = reqQuery?.limit ?? defaultLimit;
  let limit = parseInt(rawLimit, 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = defaultLimit;
  limit = Math.min(Math.max(limit, 1), maxLimit);

  const rawSkip = reqQuery?.skip ?? 0;
  let skip = parseInt(rawSkip, 10);
  if (!Number.isFinite(skip) || skip < 0) skip = 0;

  return { limit, skip };
}

function formatItemCount(count) {
  return `${count} item${count === 1 ? '' : 's'}`;
}

function omitMarketValueSources(entity) {
  if (!entity || typeof entity !== 'object') return entity;
  const { marketValueSources, ...rest } = entity;
  return rest;
}

function omitMarketValueSourcesDeep(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => omitMarketValueSourcesDeep(entry));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const { marketValueSources, ...rest } = value;
  const output = {};
  for (const [key, nested] of Object.entries(rest)) {
    output[key] = omitMarketValueSourcesDeep(nested);
  }
  return output;
}

function buildStandardVisionCompletionMessage({
  addedCount = 0,
  existingCount = 0,
  needsReviewCount = 0,
  extractedCount = 0,
} = {}) {
  if (needsReviewCount > 0) {
    if (addedCount > 0 && existingCount > 0) {
      return `Scan complete: ${formatItemCount(addedCount)} added, ${formatItemCount(existingCount)} already on this shelf, ${formatItemCount(needsReviewCount)} need review.`;
    }
    if (addedCount > 0) {
      return `Scan complete: ${formatItemCount(addedCount)} added and ${formatItemCount(needsReviewCount)} need review.`;
    }
    if (existingCount > 0) {
      return `Scan complete: no new items added, ${formatItemCount(existingCount)} already on this shelf, ${formatItemCount(needsReviewCount)} need review.`;
    }
    return `Scan complete: ${formatItemCount(needsReviewCount)} need review.`;
  }

  if (addedCount > 0) {
    if (existingCount > 0) {
      return `Scan complete: ${formatItemCount(addedCount)} added, ${formatItemCount(existingCount)} already on this shelf.`;
    }
    return `Scan complete: ${formatItemCount(addedCount)} added to your shelf.`;
  }

  if (existingCount > 0) {
    return `Scan complete: no new items added; ${formatItemCount(existingCount)} already on this shelf.`;
  }

  if (extractedCount > 0) {
    return `Scan complete: ${formatItemCount(extractedCount)} detected, but no new items were added.`;
  }

  return 'Scan complete: no items were detected.';
}

function buildVisionCompletionMessage({
  addedCount = 0,
  existingCount = 0,
  needsReviewCount = 0,
  extractedCount = 0,
  cached = false,
} = {}) {
  const standard = buildStandardVisionCompletionMessage({
    addedCount,
    existingCount,
    needsReviewCount,
    extractedCount,
  });

  if (!cached) return standard;

  const previousSummary = standard.replace(/^Scan complete:\s*/i, '');
  return `Same photo detected: this image was already scanned in the last 24 hours. Previous result: ${previousSummary}`;
}

const VISION_FINGERPRINT_SOURCE = "vision-ocr";

// PostgreSQL helper functions
async function loadShelfForUser(userId, shelfId) {
  return shelvesQueries.getById(parseInt(shelfId, 10), userId);
}

function formatShelfItem(row) {
  if (!row) return null;
  const collectablePublishers = Array.isArray(row.collectablePublishers)
    ? row.collectablePublishers.filter(Boolean)
    : [];
  const collectablePlatformData = normalizePlatformData(row.collectablePlatformData);
  const collectableSystemName = normalizeString(row.collectableSystemName) || null;
  const collectablePlatforms = derivePlatformNames({
    platformData: collectablePlatformData,
    platforms: row.collectablePlatforms,
    systemName: collectableSystemName,
  });
  const collectable = row.collectableId ? {
    id: row.collectableId,
    title: row.collectableTitle || null,
    subtitle: row.collectableSubtitle || null,
    description: row.collectableDescription || null,
    primaryCreator: row.collectableCreator || null,
    publisher: collectablePublishers[0] || null,
    publishers: collectablePublishers,
    year: row.collectableYear || null,
    marketValue: row.collectableMarketValue || null,
    formats: Array.isArray(row.collectableFormats) ? row.collectableFormats : [],
    systemName: collectableSystemName,
    platformData: collectablePlatformData,
    platforms: collectablePlatforms,
    tags: Array.isArray(row.collectableTags) ? row.collectableTags : [],
    genre: Array.isArray(row.collectableGenre) ? row.collectableGenre : [],
    runtime: row.collectableRuntime ?? null,
    images: Array.isArray(row.collectableImages) ? row.collectableImages : [],
    identifiers: row.collectableIdentifiers && typeof row.collectableIdentifiers === 'object'
      ? row.collectableIdentifiers
      : {},
    sources: Array.isArray(row.collectableSources) ? row.collectableSources : [],
    coverUrl: row.collectableCover || null,
    coverImageUrl: row.collectableCoverImageUrl || null,
    coverImageSource: row.collectableCoverImageSource || null,
    attribution: row.collectableAttribution || null,
    coverMediaId: row.collectableCoverMediaId || null,
    coverMediaPath: row.collectableCoverMediaPath || null,
    coverMediaUrl: resolveMediaUrl(row.collectableCoverMediaPath),
    type: row.collectableKind || null,
    kind: row.collectableKind || null,
    fingerprint: row.collectableFingerprint || null,
    lightweightFingerprint: row.collectableLightweightFingerprint || null,
    externalId: row.collectableExternalId || null,
  } : null;

  const manual = row.manualId ? {
    id: row.manualId,
    name: row.manualName || null,
    title: row.manualName || null,
    type: row.manualType || null,
    description: row.manualDescription || null,
    author: row.manualAuthor || null,
    manufacturer: row.manualManufacturer || null,
    publisher: row.manualPublisher || null,
    format: row.manualFormat || null,
    year: row.manualYear || null,
    marketValue: row.manualMarketValue || null,
    ageStatement: row.manualAgeStatement || null,
    specialMarkings: row.manualSpecialMarkings || null,
    labelColor: row.manualLabelColor || null,
    regionalItem: row.manualRegionalItem || null,
    edition: row.manualEdition || null,
    barcode: row.manualBarcode || null,
    limitedEdition: row.manualLimitedEdition || null,
    itemSpecificText: row.manualItemSpecificText || null,
    manualFingerprint: row.manualFingerprint || null,
    tags: Array.isArray(row.manualTags) ? row.manualTags : [],
    genre: Array.isArray(row.manualGenre) ? row.manualGenre : [],
    coverMediaPath: row.manualCoverMediaPath || null,
    coverMediaUrl: resolveMediaUrl(row.manualCoverMediaPath),
  } : null;

  const formatted = {
    id: row.id,
    collectable,
    manual,
    isVisionLinked: !!row.isVisionLinked,
    position: row.position ?? null,
    format: row.format ?? null,
    notes: row.notes ?? null,
    rating: row.rating ?? null,
    reviewedEventId: row.reviewedEventLogId ?? null,
    reviewPublishedAt: row.reviewedEventPublishedAt || null,
    reviewUpdatedAt: row.reviewedEventUpdatedAt || null,
    ownedPlatforms: normalizeOwnedPlatforms(row.ownedPlatforms),
    ownerPhoto: row.ownerPhotoSource ? {
      source: row.ownerPhotoSource,
      visible: !!row.ownerPhotoVisible,
      contentType: row.ownerPhotoContentType || null,
      sizeBytes: row.ownerPhotoSizeBytes ?? null,
      width: row.ownerPhotoWidth ?? null,
      height: row.ownerPhotoHeight ?? null,
      thumbnailContentType: row.ownerPhotoThumbContentType || null,
      thumbnailSizeBytes: row.ownerPhotoThumbSizeBytes ?? null,
      thumbnailWidth: row.ownerPhotoThumbWidth ?? null,
      thumbnailHeight: row.ownerPhotoThumbHeight ?? null,
      thumbnailBox: row.ownerPhotoThumbBox || null,
      thumbnailUpdatedAt: row.ownerPhotoThumbUpdatedAt || null,
      updatedAt: row.ownerPhotoUpdatedAt || null,
      imageUrl: `/api/shelves/${row.shelfId}/items/${row.id}/owner-photo/image`,
      thumbnailImageUrl: `/api/shelves/${row.shelfId}/items/${row.id}/owner-photo/thumbnail`,
    } : null,
    createdAt: row.createdAt || null,
  };

  if (shouldLogOwnerPhotoDebug(row.id)) {
    logOwnerPhotoDebug('formatShelfItem', {
      shelfId: row.shelfId,
      itemId: row.id,
      manualType: row.manualType || null,
      hasOwnerPhoto: !!row.ownerPhotoSource,
      ownerPhotoSource: row.ownerPhotoSource || null,
      ownerPhotoVisible: !!row.ownerPhotoVisible,
      ownerPhotoUpdatedAt: row.ownerPhotoUpdatedAt || null,
      thumbProvider: row.ownerPhotoThumbStorageProvider || null,
      thumbHasKey: !!row.ownerPhotoThumbStorageKey,
      thumbUpdatedAt: row.ownerPhotoThumbUpdatedAt || null,
      thumbSize: row.ownerPhotoThumbSizeBytes ?? null,
      thumbDimensions: {
        width: row.ownerPhotoThumbWidth ?? null,
        height: row.ownerPhotoThumbHeight ?? null,
      },
      thumbnailBox: sanitizeThumbnailBoxForLog(row.ownerPhotoThumbBox),
    });
  }

  return formatted;
}

function canViewerAccessOwnerPhoto(itemRow, viewerUserId) {
  if (!itemRow?.ownerPhotoSource) return false;
  if (itemRow.userId && viewerUserId && itemRow.userId === viewerUserId) return true;
  return !!(itemRow.ownerPhotoVisible && itemRow.showPersonalPhotos);
}

function formatOwnerPhotoResponse(itemRow, shelfId) {
  const hasPhoto = !!itemRow?.ownerPhotoSource;
  return {
    hasPhoto,
    source: itemRow?.ownerPhotoSource || null,
    visible: !!itemRow?.ownerPhotoVisible,
    contentType: itemRow?.ownerPhotoContentType || null,
    sizeBytes: itemRow?.ownerPhotoSizeBytes ?? null,
    width: itemRow?.ownerPhotoWidth ?? null,
    height: itemRow?.ownerPhotoHeight ?? null,
    thumbnailContentType: itemRow?.ownerPhotoThumbContentType || null,
    thumbnailSizeBytes: itemRow?.ownerPhotoThumbSizeBytes ?? null,
    thumbnailWidth: itemRow?.ownerPhotoThumbWidth ?? null,
    thumbnailHeight: itemRow?.ownerPhotoThumbHeight ?? null,
    thumbnailBox: itemRow?.ownerPhotoThumbBox || null,
    thumbnailUpdatedAt: itemRow?.ownerPhotoThumbUpdatedAt || null,
    updatedAt: itemRow?.ownerPhotoUpdatedAt || null,
    showPersonalPhotosEnabled: !!itemRow?.showPersonalPhotos,
    imageUrl: hasPhoto ? `/api/shelves/${shelfId}/items/${itemRow.id}/owner-photo/image` : null,
    thumbnailImageUrl: hasPhoto ? `/api/shelves/${shelfId}/items/${itemRow.id}/owner-photo/thumbnail` : null,
  };
}

function shouldRedactOtherManualCover({ viewerUserId, ownerId, shelfType, ownerPhotoSource, ownerPhotoVisible, showPersonalPhotos }) {
  if (String(shelfType || '').toLowerCase() !== OTHER_SHELF_TYPE) return false;
  if (ownerId && viewerUserId && String(ownerId) === String(viewerUserId)) return false;
  if (!ownerPhotoSource) return false;
  return !(ownerPhotoVisible && showPersonalPhotos);
}

function redactManualCoverMedia(manual) {
  if (!manual || typeof manual !== 'object') return manual;
  if (Object.prototype.hasOwnProperty.call(manual, 'coverMediaPath')) {
    manual.coverMediaPath = null;
  }
  if (Object.prototype.hasOwnProperty.call(manual, 'coverMediaUrl')) {
    manual.coverMediaUrl = null;
  }
  if (Object.prototype.hasOwnProperty.call(manual, 'cover_media_path')) {
    manual.cover_media_path = null;
  }
  if (Object.prototype.hasOwnProperty.call(manual, 'cover_media_url')) {
    manual.cover_media_url = null;
  }
  return manual;
}

function buildCollectableAddedEventPayload({
  itemId = null,
  collectable = null,
  shelfType = null,
  source = 'user',
  reviewItemId = null,
}) {
  const creator = collectable?.primaryCreator || collectable?.author || null;
  const coverMediaPath = collectable?.coverMediaPath || collectable?.cover_media_path || null;
  return {
    itemId: itemId ?? null,
    collectableId: collectable?.id || null,
    title: collectable?.title || collectable?.name || null,
    name: collectable?.title || collectable?.name || null,
    primaryCreator: creator,
    creator,
    year: collectable?.year ?? null,
    coverUrl: collectable?.coverUrl || collectable?.cover_url || null,
    coverImageUrl: collectable?.coverImageUrl || collectable?.cover_image_url || null,
    coverImageSource: collectable?.coverImageSource || collectable?.cover_image_source || null,
    coverMediaPath,
    coverMediaUrl: resolveMediaUrl(coverMediaPath),
    type: collectable?.kind || collectable?.type || shelfType || null,
    source: source || 'user',
    ...(reviewItemId ? { reviewItemId } : {}),
  };
}

function buildManualAddedEventPayload({
  itemId = null,
  manual = null,
  shelfType = null,
  source = 'manual',
  reviewItemId = null,
}) {
  const title = manual?.name || manual?.title || null;
  const creator = manual?.author || manual?.primaryCreator || manual?.creator || null;
  const coverMediaPath = manual?.coverMediaPath || manual?.cover_media_path || null;
  return {
    itemId: itemId ?? null,
    manualId: manual?.id || null,
    title,
    name: title,
    author: creator,
    primaryCreator: creator,
    creator,
    year: manual?.year ?? null,
    coverUrl: null,
    coverMediaPath,
    coverMediaUrl: resolveMediaUrl(coverMediaPath),
    type: manual?.type || shelfType || null,
    description: manual?.description || null,
    ageStatement: manual?.ageStatement || null,
    specialMarkings: manual?.specialMarkings || null,
    labelColor: manual?.labelColor || null,
    regionalItem: manual?.regionalItem || null,
    edition: manual?.edition || null,
    barcode: manual?.barcode || null,
    limitedEdition: manual?.limitedEdition || null,
    itemSpecificText: manual?.itemSpecificText || null,
    source: source || 'manual',
    ...(reviewItemId ? { reviewItemId } : {}),
  };
}

async function hydrateShelfItems(userId, shelfId, { limit, skip = 0 } = {}) {
  const rows = await shelvesQueries.getItems(shelfId, userId, { limit: limit || 100, offset: skip });
  return rows.map(formatShelfItem).filter(Boolean);
}

async function logShelfEvent({ userId, shelfId, type, payload }) {
  // Allow null shelfId for global events (like ratings)
  if (!userId || !type) return;
  try {
    const normalizedShelfId = shelfId != null ? parseInt(shelfId, 10) : null;
    const result = await feedQueries.logEvent({
      userId,
      shelfId: normalizedShelfId,
      eventType: type,
      payload: payload || {},
    });
    logFeedMicro('logShelfEvent.success', {
      userId,
      shelfId: normalizedShelfId,
      eventType: type,
      logged: !!result,
      eventId: result?.id || null,
      payloadKeys: payload && typeof payload === 'object' ? Object.keys(payload) : [],
    });
    return result;
  } catch (err) {
    logFeedMicro('logShelfEvent.error', {
      userId,
      shelfId: shelfId != null ? parseInt(shelfId, 10) : null,
      eventType: type,
      message: err?.message || String(err),
    });
    logger.warn("Event log failed", err.message || err);
  }
}

async function upsertReviewedShelfEvent({
  userId,
  shelfId,
  itemId,
  payload,
  reviewedEventIdHint = null,
}) {
  if (!userId || !itemId || !payload || typeof payload !== 'object') return null;
  try {
    const upsertResult = await feedQueries.upsertReviewedEvent({
      userId,
      payload,
      reviewedEventLogId: reviewedEventIdHint,
    });
    if (!upsertResult?.id) return null;

    const linkUpdate = await shelvesQueries.updateReviewedEventLink(
      itemId,
      userId,
      shelfId,
      {
        reviewedEventLogId: upsertResult.id,
        reviewedEventPublishedAt: upsertResult.reviewPublishedAt,
        reviewedEventUpdatedAt: upsertResult.reviewUpdatedAt,
      },
    );
    return {
      ...upsertResult,
      reviewedEventId: upsertResult.id,
      reviewPublishedAt: upsertResult.reviewPublishedAt,
      reviewUpdatedAt: upsertResult.reviewUpdatedAt,
      linkPersisted: !!linkUpdate,
    };
  } catch (err) {
    logFeedMicro('upsertReviewedShelfEvent.error', {
      userId,
      shelfId,
      itemId,
      message: err?.message || String(err),
    });
    logger.warn("Reviewed upsert failed", err.message || err);
    return null;
  }
}


// Catalog services
const bookCatalogService = new BookCatalogService();
const gameCatalogService = new GameCatalogService();
const movieCatalogService = new MovieCatalogService();
const catalogServices = [gameCatalogService, movieCatalogService, bookCatalogService];

function resolveCatalogServiceForShelf(type) {
  for (const service of catalogServices) {
    try {
      if (service.supportsShelfType(type)) return service;
    } catch (err) {
      logger.error('[shelfVision.catalogService] supportsShelfType failed', { error: err?.message || err });
    }
  }
  return null;
}

function getVisionMaxOutputTokens() {
  const raw = parseInt(process.env.OPENAI_VISION_MAX_OUTPUT_TOKENS || "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 4096;
}

function buildVisionPrompt(shelfType) {
  const normalized = String(shelfType || "").toLowerCase();
  for (const rule of VISION_PROMPT_RULES) {
    if (rule.match.some((m) => normalized.includes(m))) {
      return rule.prompt;
    }
  }
  return `You are assisting with cataloging physical collections. Identify all items visible in the photo with title, author/creator, format, and any other relevant metadata. Include "coordinates" describing the relative physical location. Do not include explanations.`;
}


// Structured vision format (same as original)
const structuredVisionFormat = {
  name: "ShelfCatalog",
  type: "json_schema",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      shelfConfirmed: { type: "boolean" },
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            type: { type: "string" },
            primaryCreator: { type: ["string", "null"] },
            format: { type: ["string", "null"] },
            publisher: { type: ["string", "null"] },
            year: { type: ["string", "null"] },
            developer: { type: ["string", "null"] },
            region: { type: ["string", "null"] },
            systemName: { type: ["string", "null"] },
            urlCoverFront: { type: ["string", "null"] },
            urlCoverBack: { type: ["string", "null"] },
            genre: { anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }, { type: "null" }] },
            tags: { anyOf: [{ type: "array", items: { type: "string" } }, { type: "string" }, { type: "null" }] },
            description: { type: ["string", "null"] },
            position: { type: ["number", "null"] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["title", "type", "primaryCreator", "region", "format", "position", "confidence", "publisher", "year", "developer", "genre", "tags", "description", "urlCoverFront", "urlCoverBack", "systemName"],
        },
      },
    },
    required: ["shelfConfirmed", "items"],
  },
};

// Controller functions
async function listShelves(req, res) {
  try {
    const { limit, skip } = parsePaginationParams(req.query, { defaultLimit: 20, maxLimit: 100 });

    const result = await query(
      `SELECT s.*, COUNT(uc.id) as item_count
       FROM shelves s
       LEFT JOIN user_collections uc ON uc.shelf_id = s.id
       WHERE s.owner_id = $1
       GROUP BY s.id
       ORDER BY s.created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, limit, skip]
    );

    const countResult = await query(
      'SELECT COUNT(*) as total FROM shelves WHERE owner_id = $1',
      [req.user.id]
    );
    const total = parseInt(countResult.rows[0].total);

    res.json({
      shelves: result.rows.map(rowToCamelCase),
      pagination: { limit, skip, total, hasMore: skip + result.rows.length < total },
    });
  } catch (err) {
    logger.error('listShelves error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function createShelf(req, res) {
  try {
    const { name, type, description } = req.body ?? {};
    if (!name || !type) return res.status(400).json({ error: "name and type are required" });

    const normalizedType = String(type).trim();
    const normalizedDescription = String(description ?? "").trim();
    if (isOtherShelfType(normalizedType) && !hasShelfDescription(normalizedDescription)) {
      return res.status(400).json({ error: OTHER_SHELF_DESCRIPTION_REQUIRED_ERROR });
    }

    const visibilityRaw = String(req.body.visibility ?? "private").toLowerCase();
    const visibility = VISIBILITY_OPTIONS.includes(visibilityRaw) ? visibilityRaw : "private";

    const shelf = await shelvesQueries.create({
      userId: req.user.id,
      name: String(name).trim(),
      type: normalizedType,
      description: normalizedDescription,
      visibility,
    });

    await logShelfEvent({
      userId: req.user.id,
      shelfId: shelf.id,
      type: "shelf.created",
      payload: { name: shelf.name, type: shelf.type, visibility: shelf.visibility },
    });

    res.status(201).json({ shelf });
  } catch (err) {
    logger.error('createShelf error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function getShelf(req, res) {
  try {
    const shelfId = parseInt(req.params.shelfId, 10);
    if (isNaN(shelfId)) return res.status(400).json({ error: "Invalid shelf id" });

    const shelf = await shelvesQueries.getForViewing(shelfId, req.user.id);
    if (!shelf) return res.status(404).json({ error: "Shelf not found" });
    const readOnly = shelf.ownerId !== req.user.id;
    res.json({ shelf: { ...shelf, readOnly } });
  } catch (err) {
    logger.error('getShelf error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function updateShelf(req, res) {
  try {
    const shelfId = parseInt(req.params.shelfId, 10);
    if (isNaN(shelfId)) return res.status(400).json({ error: "Invalid shelf id" });

    const existingShelf = await loadShelfForUser(req.user.id, shelfId);
    if (!existingShelf) return res.status(404).json({ error: "Shelf not found" });

    const payload = req.body || {};
    const updates = { ...payload };
    if (Object.prototype.hasOwnProperty.call(payload, "name")) {
      updates.name = String(payload.name ?? "").trim();
    }
    if (Object.prototype.hasOwnProperty.call(payload, "description")) {
      updates.description = String(payload.description ?? "").trim();
    }

    const resolvedDescription = Object.prototype.hasOwnProperty.call(updates, "description")
      ? updates.description
      : existingShelf.description;
    if (isOtherShelfType(existingShelf.type) && !hasShelfDescription(resolvedDescription)) {
      return res.status(400).json({ error: OTHER_SHELF_DESCRIPTION_REQUIRED_ERROR });
    }

    const shelf = await shelvesQueries.update(shelfId, req.user.id, updates);
    if (!shelf) return res.status(404).json({ error: "Shelf not found" });
    res.json({ shelf });
  } catch (err) {
    logger.error('updateShelf error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function deleteShelf(req, res) {
  try {
    const shelfId = parseInt(req.params.shelfId, 10);
    if (isNaN(shelfId)) return res.status(400).json({ error: "Invalid shelf id" });

    const deleted = await shelvesQueries.remove(shelfId, req.user.id);
    if (!deleted) return res.status(404).json({ error: "Shelf not found" });

    res.json({ deleted: true, id: shelfId });
  } catch (err) {
    logger.error('deleteShelf error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function listShelfItems(req, res) {
  try {
    const shelfId = parseInt(req.params.shelfId, 10);
    if (isNaN(shelfId)) return res.status(400).json({ error: "Invalid shelf id" });

    const shelf = await shelvesQueries.getForViewing(shelfId, req.user.id);
    if (!shelf) return res.status(404).json({ error: "Shelf not found" });

    const { limit, skip } = parsePaginationParams(req.query, { defaultLimit: 25, maxLimit: 200 });
    const isOwner = shelf.ownerId === req.user.id;
    let items = isOwner
      ? await hydrateShelfItems(req.user.id, shelf.id, { limit, skip })
      : (await shelvesQueries.getItemsForViewing(shelf.id, { limit, offset: skip })).map(formatShelfItem).filter(Boolean);
    if (!isOwner) {
      items = items.map((item) => ({
        ...item,
        ownerPhoto: null,
        reviewedEventId: null,
        reviewPublishedAt: null,
        reviewUpdatedAt: null,
      }));
    }

    if (OWNER_PHOTO_DEBUG_ENABLED) {
      const target = OWNER_PHOTO_DEBUG_ITEM_ID
        ? items.find((entry) => Number(entry?.id) === Number(OWNER_PHOTO_DEBUG_ITEM_ID))
        : null;
      logOwnerPhotoDebug('listShelfItems.response', {
        shelfId: shelf.id,
        viewerUserId: req.user?.id || null,
        isOwner,
        limit,
        skip,
        itemCount: items.length,
        targetItemId: OWNER_PHOTO_DEBUG_ITEM_ID || null,
        targetItemOwnerPhoto: target?.ownerPhoto || null,
      });
    }

    const countResult = await query(
      `SELECT COUNT(*) as total FROM user_collections WHERE shelf_id = $1${isOwner ? ' AND user_id = $2' : ''}`,
      isOwner ? [shelf.id, req.user.id] : [shelf.id]
    );
    const total = parseInt(countResult.rows[0].total);

    res.json({
      items,
      pagination: { limit, skip, total, hasMore: skip + items.length < total },
    });
  } catch (err) {
    logger.error('listShelfItems error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

/**
 * Search for existing collectables before adding a manual entry
 * Returns suggestions for the user to choose from
 */
async function searchManualEntry(req, res) {
  try {
    const shelf = await loadShelfForUser(req.user.id, req.params.shelfId);
    if (!shelf) return res.status(404).json({ error: "Shelf not found" });

    const { name, title, author, primaryCreator, platform, systemName, format } = req.body ?? {};
    const searchTitle = title || name;
    const searchCreator = primaryCreator || author;
    const searchPlatform = normalizeString(platform || systemName) || null;
    const searchFormat = normalizeString(format) || null;

    if (!searchTitle) {
      return res.status(400).json({ error: "title or name is required" });
    }

    const matchingService = getCollectableMatchingService();
    const result = await matchingService.search(
      {
        title: searchTitle,
        primaryCreator: searchCreator,
        name: searchTitle,
        author: searchCreator,
        platform: searchPlatform || undefined,
        systemName: searchPlatform || undefined,
        format: searchFormat || undefined,
      },
      shelf.type,
      { includeApi: true }
    );

    res.json({
      suggestions: result.suggestions,
      searched: result.searched,
      query: {
        title: searchTitle,
        creator: searchCreator,
        platform: searchPlatform,
        format: searchFormat,
        shelfType: shelf.type,
      },
    });
  } catch (err) {
    logger.error('searchManualEntry error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function addManualEntry(req, res) {
  try {
    const shelf = await loadShelfForUser(req.user.id, req.params.shelfId);
    if (!shelf) return res.status(404).json({ error: "Shelf not found" });

    const {
      name,
      type,
      description,
      author,
      primaryCreator,
      publisher,
      format,
      year,
      ageStatement,
      specialMarkings,
      labelColor,
      regionalItem,
      edition,
      barcode,
      genre,
      genres,
      tags,
      limitedEdition,
      itemSpecificText,
      marketValue,
      marketValueSources,
    } = req.body ?? {};
    if (!name) return res.status(400).json({ error: "name is required" });

    const result = await shelvesQueries.addManual({
      userId: req.user.id,
      shelfId: shelf.id,
      name: String(name).trim(),
      type,
      description,
      author: author || primaryCreator || null,
      publisher,
      format,
      year,
      marketValue,
      marketValueSources: normalizeSourceLinks(marketValueSources),
      ageStatement,
      specialMarkings,
      labelColor,
      regionalItem,
      edition,
      barcode,
      genre: normalizeStringArray(genre, genres),
      tags,
      limitedEdition,
      itemSpecificText,
    });

    await logShelfEvent({
      userId: req.user.id,
      shelfId: shelf.id,
      type: "item.manual_added",
      payload: buildManualAddedEventPayload({
        itemId: result.collection.id,
        manual: result.manual,
        shelfType: shelf.type,
        source: 'manual',
      }),
    });

    res.status(201).json({
      item: { id: result.collection.id, manual: omitMarketValueSources(result.manual), position: null, format: null, notes: null, rating: null },
    });
  } catch (err) {
    logger.error('addManualEntry error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function addCollectable(req, res) {
  try {
    const shelf = await loadShelfForUser(req.user.id, req.params.shelfId);
    if (!shelf) return res.status(404).json({ error: "Shelf not found" });

    const { collectableId, manualId, format, notes, rating, position } = req.body ?? {};

    // Require exactly one of collectableId or manualId
    if (!collectableId && !manualId) {
      return res.status(400).json({ error: "collectableId or manualId is required" });
    }
    if (collectableId && manualId) {
      return res.status(400).json({ error: "Provide collectableId or manualId, not both" });
    }

    // --- manualId path ---
    if (manualId) {
      const manual = await shelvesQueries.getManualById(manualId);
      if (!manual) return res.status(404).json({ error: "Manual item not found" });
      if (manual.userId !== req.user.id) {
        return res.status(403).json({ error: "You do not own this manual item" });
      }

      const item = await shelvesQueries.addManualCollection({
        userId: req.user.id,
        shelfId: shelf.id,
        manualId: manual.id,
      });

      await logShelfEvent({
        userId: req.user.id,
        shelfId: shelf.id,
        type: "item.manual_added",
        payload: buildManualAddedEventPayload({
          itemId: item.id,
          manual,
          shelfType: shelf.type,
          source: 'user',
        }),
      });

      return res.status(201).json({
        item: {
          id: item.id,
          manual: { id: manual.id, name: manual.name, title: manual.title || manual.name },
          position: item.position,
        },
      });
    }

    // --- collectableId path (existing flow) ---
    const collectable = await collectablesQueries.findById(collectableId);
    if (!collectable) return res.status(404).json({ error: "Collectable not found" });

    const item = await shelvesQueries.addCollectable({
      userId: req.user.id,
      shelfId: shelf.id,
      collectableId: collectable.id,
      format,
      notes,
      rating,
      position,
    });
    const ownedPlatforms = await seedDefaultOwnedPlatformForGameItem({
      itemId: item?.id,
      collectable,
    });

    await logShelfEvent({
      userId: req.user.id,
      shelfId: shelf.id,
      type: "item.collectable_added",
      payload: buildCollectableAddedEventPayload({
        itemId: item.id,
        collectable,
        shelfType: shelf.type,
        source: 'user',
      }),
    });

    res.status(201).json({
      item: {
        id: item.id,
        collectable: omitMarketValueSources(collectable),
        position: item.position,
        format: item.format,
        notes: item.notes,
        rating: item.rating,
        ownedPlatforms,
      },
    });
  } catch (err) {
    logger.error('addCollectable error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function addCollectableFromApi(req, res) {
  try {
    const shelf = await loadShelfForUser(req.user.id, req.params.shelfId);
    if (!shelf) return res.status(404).json({ error: "Shelf not found" });

    const input = req.body?.collectable || req.body?.suggestion || null;
    if (!input) return res.status(400).json({ error: "collectable is required" });

    let resolvedInput = input;
    try {
      const matchingService = getCollectableMatchingService();
      const apiResult = await matchingService.searchCatalogAPI(input, shelf.type);
      if (apiResult) {
        resolvedInput = { ...input, ...apiResult };
      }
    } catch (err) {
      logger.warn('[addCollectableFromApi] API enrichment failed:', err?.message || err);
    }

    const payload = buildCollectableUpsertPayload(resolvedInput, shelf.type);
    if (!payload) return res.status(400).json({ error: "collectable title is required" });

    const collectable = await collectablesQueries.upsert(payload);
    const userFormat = normalizeString(resolvedInput?.format || resolvedInput?.physical?.format);
    const item = await shelvesQueries.addCollectable({
      userId: req.user.id,
      shelfId: shelf.id,
      collectableId: collectable.id,
      format: userFormat || null,
    });
    const ownedPlatforms = await seedDefaultOwnedPlatformForGameItem({
      itemId: item?.id,
      collectable,
    });

    await logShelfEvent({
      userId: req.user.id,
      shelfId: shelf.id,
      type: "item.collectable_added",
      payload: buildCollectableAddedEventPayload({
        itemId: item.id,
        collectable,
        shelfType: shelf.type,
        source: 'user',
      }),
    });

    res.status(201).json({
      item: {
        id: item.id,
        collectable: omitMarketValueSources(collectable),
        position: item.position,
        format: item.format,
        notes: item.notes,
        rating: item.rating,
        ownedPlatforms,
      },
    });
  } catch (err) {
    logger.error('addCollectableFromApi error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function removeShelfItem(req, res) {
  try {
    const shelf = await loadShelfForUser(req.user.id, req.params.shelfId);
    if (!shelf) return res.status(404).json({ error: "Shelf not found" });

    const removed = await shelvesQueries.removeItem(
      parseInt(req.params.itemId, 10),
      req.user.id,
      shelf.id
    );
    if (!removed) return res.status(404).json({ error: "Item not found" });

    // Event logging removed for item removal request per user request
    // await logShelfEvent({
    //   userId: req.user.id,
    //   shelfId: shelf.id,
    //   type: "item.removed",
    //   payload: { itemId: req.params.itemId },
    // });

    const items = await hydrateShelfItems(req.user.id, shelf.id);
    res.json({ removedId: req.params.itemId, items });
  } catch (err) {
    logger.error('removeShelfItem error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function createReplacementIntent(req, res) {
  try {
    const shelfId = parseInt(req.params.shelfId, 10);
    const itemId = parseInt(req.params.itemId, 10);
    if (isNaN(shelfId) || isNaN(itemId)) {
      return res.status(400).json({ error: 'Invalid shelf or item id' });
    }

    const triggerSource = normalizeString(req.body?.triggerSource);
    if (!REPLACEMENT_TRIGGER_SOURCES.has(triggerSource)) {
      return res.status(400).json({ error: 'Invalid triggerSource' });
    }

    const shelf = await loadShelfForUser(req.user.id, shelfId);
    if (!shelf) return res.status(404).json({ error: 'Shelf not found' });

    const sourceItem = await shelvesQueries.getItemById(itemId, req.user.id, shelf.id);
    if (!sourceItem) return res.status(404).json({ error: 'Item not found' });

    const maxAgeHours = REPLACEMENT_WINDOW_HOURS[triggerSource];
    if (!isWithinHoursWindow(sourceItem.createdAt, maxAgeHours)) {
      return res.status(400).json({
        error: `Replacement is only available within ${maxAgeHours} hours for this action.`,
      });
    }

    if (triggerSource === 'collectable_detail' && !sourceItem.isVisionLinked) {
      return res.status(400).json({
        error: 'Replacement from detail is only available for vision-linked items.',
      });
    }

    if (!sourceItem.collectableId && !sourceItem.manualId) {
      return res.status(400).json({ error: 'Item reference is missing' });
    }

    const trace = await itemReplacementTracesQueries.createIntent({
      userId: req.user.id,
      shelfId: shelf.id,
      sourceItemId: sourceItem.id,
      sourceCollectableId: sourceItem.collectableId || null,
      sourceManualId: sourceItem.manualId || null,
      triggerSource,
      metadata: {
        sourceCreatedAt: sourceItem.createdAt || null,
        sourceIsVisionLinked: !!sourceItem.isVisionLinked,
      },
    });

    return res.status(201).json({
      traceId: trace?.id || null,
      trace,
    });
  } catch (err) {
    logger.error('createReplacementIntent error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

async function replaceShelfItem(req, res) {
  try {
    const shelfId = parseInt(req.params.shelfId, 10);
    const itemId = parseInt(req.params.itemId, 10);
    if (isNaN(shelfId) || isNaN(itemId)) {
      return res.status(400).json({ error: 'Invalid shelf or item id' });
    }

    const shelf = await loadShelfForUser(req.user.id, shelfId);
    if (!shelf) return res.status(404).json({ error: 'Shelf not found' });

    const sourceItem = await shelvesQueries.getItemById(itemId, req.user.id, shelf.id);
    if (!sourceItem) return res.status(404).json({ error: 'Item not found' });

    const body = req.body ?? {};
    const traceId = parseInt(body.traceId, 10);
    if (isNaN(traceId)) {
      return res.status(400).json({ error: 'traceId is required' });
    }

    const hasCollectableId = body.collectableId !== undefined && body.collectableId !== null && body.collectableId !== '';
    const hasCollectablePayload = !!(body.collectable && typeof body.collectable === 'object' && !Array.isArray(body.collectable));
    const hasManualPayload = !!(body.manual && typeof body.manual === 'object' && !Array.isArray(body.manual));
    const replacementModeCount = [hasCollectableId, hasCollectablePayload, hasManualPayload].filter(Boolean).length;

    if (replacementModeCount !== 1) {
      return res.status(400).json({
        error: 'Provide exactly one replacement payload: collectableId, collectable, or manual.',
      });
    }

    const existingCollectableId = hasCollectableId ? parseInt(body.collectableId, 10) : null;
    if (hasCollectableId && isNaN(existingCollectableId)) {
      return res.status(400).json({ error: 'collectableId must be an integer' });
    }

    if (existingCollectableId) {
      const existingCollectable = await collectablesQueries.findById(existingCollectableId);
      if (!existingCollectable) {
        throw buildHttpError(404, 'Collectable not found', 'replacement_collectable_not_found');
      }
    }

    const replacementResult = await transaction(async (client) => {
      const trace = await itemReplacementTracesQueries.getByIdForUser({
        traceId,
        userId: req.user.id,
        shelfId: shelf.id,
        sourceItemId: sourceItem.id,
        status: 'initiated',
        forUpdate: true,
      }, client);

      if (!trace) {
        throw buildHttpError(404, 'Replacement intent not found or already used', 'replacement_trace_missing');
      }

      let targetItemId = null;
      let targetCollectableId = null;
      let targetManualId = null;
      let replacementKind = null;

      if (existingCollectableId) {
        replacementKind = 'collectable_id';
        const replacedItem = await shelvesQueries.addCollectable({
          userId: req.user.id,
          shelfId: shelf.id,
          collectableId: existingCollectableId,
          format: null,
        }, client);
        targetItemId = replacedItem?.id || null;
        targetCollectableId = existingCollectableId;
      } else if (hasCollectablePayload) {
        replacementKind = 'collectable_payload';
        const payload = buildCollectableUpsertPayload(body.collectable, shelf.type);
        if (!payload) {
          throw buildHttpError(400, 'Replacement collectable payload is missing title', 'replacement_collectable_title_missing');
        }

        const collectable = await collectablesQueries.upsert(payload, client);
        const userFormat = normalizeString(body.collectable?.format || body.collectable?.physical?.format);
        const replacedItem = await shelvesQueries.addCollectable({
          userId: req.user.id,
          shelfId: shelf.id,
          collectableId: collectable.id,
          format: userFormat || null,
        }, client);

        targetItemId = replacedItem?.id || null;
        targetCollectableId = collectable.id;
      } else if (hasManualPayload) {
        replacementKind = 'manual_payload';
        const manualInput = body.manual ?? {};
        const manualName = normalizeString(manualInput.name || manualInput.title);
        if (!manualName) {
          throw buildHttpError(400, 'Replacement manual payload is missing name/title', 'replacement_manual_name_missing');
        }

        const rawYear = normalizeString(manualInput.year);
        if (rawYear && !/^\d{1,4}$/.test(rawYear)) {
          throw buildHttpError(400, 'Replacement manual year must be a 1-4 digit number', 'replacement_manual_year_invalid');
        }

        const manualResult = await shelvesQueries.addManual({
          userId: req.user.id,
          shelfId: shelf.id,
          name: manualName,
          type: normalizeString(manualInput.type) || shelf.type,
          description: normalizeString(manualInput.description),
          author: normalizeString(manualInput.author || manualInput.primaryCreator),
          publisher: normalizeString(manualInput.publisher),
          format: normalizeString(manualInput.format || manualInput.platform),
          year: rawYear ? parseInt(rawYear, 10) : null,
          marketValue: normalizeString(manualInput.marketValue),
          marketValueSources: normalizeSourceLinks(manualInput.marketValueSources),
          ageStatement: normalizeString(manualInput.ageStatement),
          specialMarkings: normalizeString(manualInput.specialMarkings),
          labelColor: normalizeString(manualInput.labelColor),
          regionalItem: normalizeString(manualInput.regionalItem),
          edition: normalizeString(manualInput.edition),
          barcode: normalizeString(manualInput.barcode),
          genre: normalizeStringArray(manualInput.genre, manualInput.genres),
          tags: normalizeStringArray(manualInput.tags),
          limitedEdition: normalizeString(manualInput.limitedEdition),
          itemSpecificText: normalizeString(manualInput.itemSpecificText),
        }, client);

        targetItemId = manualResult?.collection?.id || null;
        targetManualId = manualResult?.manual?.id || null;
      }

      if (!targetItemId) {
        throw buildHttpError(500, 'Replacement target could not be persisted', 'replacement_target_missing');
      }

      const replaced = targetItemId !== sourceItem.id;
      if (replaced) {
        const removed = await shelvesQueries.removeItem(sourceItem.id, req.user.id, shelf.id, client);
        if (!removed) {
          throw buildHttpError(409, 'Source item could not be removed', 'replacement_source_remove_failed');
        }
      }

      const completedTrace = await itemReplacementTracesQueries.markCompleted({
        traceId,
        userId: req.user.id,
        targetItemId,
        targetCollectableId,
        targetManualId,
        metadata: {
          replacementKind,
          sourceItemId: sourceItem.id,
          replaced,
        },
      }, client);

      if (!completedTrace) {
        throw buildHttpError(409, 'Replacement intent is no longer active', 'replacement_trace_not_initiated');
      }

      return {
        replaced,
        targetItemId,
      };
    });

    const replacedItem = await shelvesQueries.getItemById(replacementResult.targetItemId, req.user.id, shelf.id);

    return res.json({
      success: true,
      replaced: replacementResult.replaced,
      sourceItemId: sourceItem.id,
      targetItemId: replacementResult.targetItemId,
      item: replacedItem,
    });
  } catch (err) {
    const traceId = parseInt(req.body?.traceId, 10);
    const status = err?.status || 500;
    if (!isNaN(traceId) && status < 500) {
      try {
        await itemReplacementTracesQueries.markFailed({
          traceId,
          userId: req.user.id,
          reason: err.code || 'replacement_failed',
          metadata: { message: err.message || null },
        });
      } catch (markErr) {
        logger.warn('replaceShelfItem markFailed warning:', markErr?.message || markErr);
      }
    }

    if (status >= 500) {
      logger.error('replaceShelfItem error:', err);
      return res.status(500).json({ error: 'Server error' });
    }

    if (!err?.code || !String(err.code).startsWith('replacement_')) {
      logger.warn('replaceShelfItem validation error:', {
        code: err?.code || null,
        message: err?.message || String(err),
      });
    }

    return res.status(status).json({ error: err.message || 'Replace failed' });
  }
}

async function searchCollectablesForShelf(req, res) {
  try {
    const shelf = await loadShelfForUser(req.user.id, req.params.shelfId);
    if (!shelf) return res.status(404).json({ error: "Shelf not found" });

    const q = String(req.query.q || "").trim();
    const limit = Math.min(parseInt(req.query.limit || "10", 10), 50);

    const results = await collectablesQueries.searchByTitle(q, shelf.type, limit);
    res.json({ results: results.map(omitMarketValueSources) });
  } catch (err) {
    logger.error('searchCollectablesForShelf error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function updateManualEntry(req, res) {
  try {
    const { shelfId, itemId } = req.params;
    const shelf = await loadShelfForUser(req.user.id, shelfId);
    if (!shelf) return res.status(404).json({ error: "Shelf not found" });

    const body = req.body ?? {};
    const updates = {};
    const fieldMap = {
      ageStatement: 'age_statement',
      specialMarkings: 'special_markings',
      labelColor: 'label_color',
      regionalItem: 'regional_item',
      limitedEdition: 'limited_edition',
      itemSpecificText: 'item_specific_text',
      marketValue: 'market_value',
    };

    const allowedFields = [
      'name',
      'type',
      'description',
      'author',
      'publisher',
      'format',
      'year',
      'marketValue',
      'ageStatement',
      'specialMarkings',
      'labelColor',
      'regionalItem',
      'edition',
      'barcode',
      'genre',
      'limitedEdition',
      'itemSpecificText',
    ];

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        const dbField = fieldMap[field] || field;
        if (field === 'genre') {
          updates[dbField] = normalizeStringArray(body[field]);
        } else if (field === 'year') {
          const normalizedYear = normalizeString(body[field]);
          if (!normalizedYear) {
            updates[dbField] = null;
          } else if (!/^\d{1,4}$/.test(normalizedYear)) {
            return res.status(400).json({ error: 'year must be a 1-4 digit number' });
          } else {
            updates[dbField] = parseInt(normalizedYear, 10);
          }
        } else {
          updates[dbField] = normalizeString(body[field]);
        }
      }
    }

    if (body.primaryCreator !== undefined && updates.author === undefined) {
      updates.author = normalizeString(body.primaryCreator);
    }

    // Handle notes separately (stored on user_collections, not user_manuals)
    const notesValue = body.notes !== undefined ? normalizeString(body.notes) : undefined;
    const reviewedEventIdHint = body.reviewedEventId ?? null;
    const shareToFeedRequested = (
      body.shareToFeed === true
      || body.shareToFeed === 1
      || String(body.shareToFeed || '').toLowerCase() === 'true'
    );
    logFeedMicro('updateManualEntry.notes.request', {
      userId: req.user.id,
      shelfId: shelf.id,
      itemId: req.params.itemId,
      notesProvided: body.notes !== undefined,
      notesLength: notesValue ? String(notesValue).length : 0,
      reviewedEventIdHint: reviewedEventIdHint ?? null,
      shareToFeedRaw: body.shareToFeed,
      shareToFeedRequested,
    });

    if (Object.keys(updates).length === 0 && notesValue === undefined) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    // Get the collection entry with manual
    const entryResult = await query(
      `SELECT uc.id, uc.manual_id, uc.notes,
              uc.reviewed_event_log_id, uc.reviewed_event_published_at, uc.reviewed_event_updated_at,
              um.*
       FROM user_collections uc
       JOIN user_manuals um ON um.id = uc.manual_id
       WHERE uc.id = $1 AND uc.user_id = $2 AND uc.shelf_id = $3`,
      [itemId, req.user.id, shelf.id]
    );

    if (!entryResult.rows.length) {
      return res.status(404).json({ error: "Manual item not found" });
    }

    const entry = entryResult.rows[0];

    let manualData = rowToCamelCase(entry);

    // Update user_manuals if there are manual field updates
    if (Object.keys(updates).length > 0) {
      const setClause = Object.keys(updates).map((k, i) => `${k} = $${i + 1}`).join(', ');
      const values = [...Object.values(updates), entry.manual_id];

      const updateResult = await query(
        `UPDATE user_manuals SET ${setClause} WHERE id = $${values.length} RETURNING *`,
        values
      );
      manualData = rowToCamelCase(updateResult.rows[0]);
    }

    // Update notes on user_collections if provided
    let updatedNotes = entry.notes;
    if (notesValue !== undefined) {
      await query(
        `UPDATE user_collections SET notes = $1 WHERE id = $2`,
        [notesValue, entry.id]
      );
      updatedNotes = notesValue;
    }

    let reviewLinkState = {
      reviewedEventId: entry.reviewed_event_log_id ?? null,
      reviewPublishedAt: entry.reviewed_event_published_at || null,
      reviewUpdatedAt: entry.reviewed_event_updated_at || null,
    };
    const shouldShareReviewedEvent = shareToFeedRequested && notesValue !== undefined && !!notesValue;
    logFeedMicro('updateManualEntry.notes.shareDecision', {
      userId: req.user.id,
      shelfId: shelf.id,
      shouldShareReviewedEvent,
      notesProvided: notesValue !== undefined,
      hasNotesValue: !!notesValue,
      reviewedEventIdHint: reviewedEventIdHint ?? null,
      storedReviewedEventId: reviewLinkState.reviewedEventId ?? null,
      shareToFeedRequested,
    });
    if (shouldShareReviewedEvent) {
      const ratingRecord = await ratingsQueries.getRating(req.user.id, { manualId: entry.manual_id });
      const currentUserRating = ratingRecord?.rating ?? null;
      const manualTitle = manualData?.name || manualData?.title || 'Unknown';
      const upsertedReview = await upsertReviewedShelfEvent({
        userId: req.user.id,
        shelfId: shelf.id,
        itemId: entry.id,
        reviewedEventIdHint: reviewedEventIdHint || reviewLinkState.reviewedEventId || null,
        payload: {
          itemId: entry.id,
          sourceShelfId: shelf.id,
          sourceShelfType: shelf.type || null,
          manualId: entry.manual_id || manualData?.id || null,
          title: manualTitle,
          primaryCreator: manualData?.author || null,
          coverUrl: null,
          coverMediaPath: manualData?.coverMediaPath || null,
          coverMediaUrl: resolveMediaUrl(manualData?.coverMediaPath),
          rating: currentUserRating,
          notes: notesValue,
          type: manualData?.type || shelf.type || 'item',
          metadata: {
            format: manualData?.format || null,
            publisher: manualData?.publisher || null,
            year: manualData?.year || null,
            genre: Array.isArray(manualData?.genre) ? manualData.genre : null,
            edition: manualData?.edition || null,
            regionalItem: manualData?.regionalItem || null,
            barcode: manualData?.barcode || null,
            itemSpecificText: manualData?.itemSpecificText || null,
          },
        },
      });
      if (upsertedReview) {
        reviewLinkState = {
          reviewedEventId: upsertedReview.reviewedEventId ?? null,
          reviewPublishedAt: upsertedReview.reviewPublishedAt || null,
          reviewUpdatedAt: upsertedReview.reviewUpdatedAt || null,
        };
      }
      logFeedMicro('updateManualEntry.notes.reviewedLogged', {
        userId: req.user.id,
        shelfId: shelf.id,
        eventLogged: !!upsertedReview,
        eventId: upsertedReview?.reviewedEventId || null,
        changed: upsertedReview?.changed ?? null,
        createdNew: upsertedReview?.createdNew ?? null,
      });
    }

    res.json({
      item: {
        id: entry.id,
        notes: updatedNotes,
        reviewedEventId: reviewLinkState.reviewedEventId,
        reviewPublishedAt: reviewLinkState.reviewPublishedAt,
        reviewUpdatedAt: reviewLinkState.reviewUpdatedAt,
        manual: omitMarketValueSources(manualData),
      },
    });
  } catch (err) {
    logger.error('updateManualEntry error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

/**
 * Upload a cover image for a manual item
 */
async function uploadManualCover(req, res) {
  try {
    const { shelfId, itemId } = req.params;
    const shelf = await loadShelfForUser(req.user.id, shelfId);
    if (!shelf) return res.status(404).json({ error: "Shelf not found" });

    // Validate file was uploaded
    if (!req.file) {
      return res.status(400).json({ error: "No image file provided" });
    }

    // Get the collection entry to verify ownership and get manual_id
    const entryResult = await query(
      `SELECT uc.id, uc.manual_id, um.id as manual_exists
       FROM user_collections uc
       JOIN user_manuals um ON um.id = uc.manual_id
       WHERE uc.id = $1 AND uc.user_id = $2 AND uc.shelf_id = $3`,
      [itemId, req.user.id, shelf.id]
    );

    if (!entryResult.rows.length) {
      return res.status(404).json({ error: "Manual item not found" });
    }

    const entry = entryResult.rows[0];

    // Upload the cover image
    const validated = await validateImageBuffer(req.file.buffer);
    const updatedManual = await manualMediaQueries.uploadFromBuffer({
      userId: req.user.id,
      manualId: entry.manual_id,
      buffer: req.file.buffer,
      contentType: validated.mime,
    });

    // Build response with resolved URL
    const coverMediaUrl = resolveMediaUrl(updatedManual.coverMediaPath);

    res.json({
      success: true,
      manual: {
        ...omitMarketValueSources(updatedManual),
        coverMediaUrl,
      },
    });
  } catch (err) {
    logger.error('uploadManualCover error:', err);
    const statusCode = /image/i.test(String(err?.message || '')) ? 400 : 500;
    res.status(statusCode).json({ error: err?.message || 'Server error' });
  }
}

async function getShelfItemOwnerPhoto(req, res) {
  try {
    const shelfId = parseInt(req.params.shelfId, 10);
    const itemId = parseInt(req.params.itemId, 10);
    if (isNaN(shelfId) || isNaN(itemId)) {
      return res.status(400).json({ error: 'Invalid shelf or item id' });
    }

    const shelf = await shelvesQueries.getForViewing(shelfId, req.user.id);
    if (!shelf) return res.status(404).json({ error: 'Shelf not found' });

    const item = await userCollectionPhotosQueries.getByCollectionItem({
      itemId,
      shelfId: shelf.id,
    });
    if (!item) {
      return res.status(404).json({ error: 'Shelf item not found' });
    }

    const isOwner = item.userId === req.user.id;
    if (!isOwner && !canViewerAccessOwnerPhoto(item, req.user.id)) {
      return res.status(404).json({ error: 'Owner photo not found' });
    }

    if (shouldLogOwnerPhotoDebug(item.id)) {
      logOwnerPhotoDebug('ownerPhoto.meta', {
        shelfId: shelf.id,
        itemId: item.id,
        viewerUserId: req.user?.id || null,
        isOwner,
        ownerPhotoSource: item.ownerPhotoSource || null,
        ownerPhotoVisible: !!item.ownerPhotoVisible,
        ownerPhotoUpdatedAt: item.ownerPhotoUpdatedAt || null,
        thumbProvider: item.ownerPhotoThumbStorageProvider || null,
        thumbHasKey: !!item.ownerPhotoThumbStorageKey,
        thumbUpdatedAt: item.ownerPhotoThumbUpdatedAt || null,
        thumbnailBox: sanitizeThumbnailBoxForLog(item.ownerPhotoThumbBox),
      });
    }

    return res.json({
      ownerPhoto: formatOwnerPhotoResponse(item, shelf.id),
    });
  } catch (err) {
    logger.error('getShelfItemOwnerPhoto error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

async function getShelfItemOwnerPhotoImage(req, res) {
  try {
    const shelfId = parseInt(req.params.shelfId, 10);
    const itemId = parseInt(req.params.itemId, 10);
    if (isNaN(shelfId) || isNaN(itemId)) {
      return res.status(400).json({ error: 'Invalid shelf or item id' });
    }

    const shelf = await shelvesQueries.getForViewing(shelfId, req.user.id);
    if (!shelf) return res.status(404).json({ error: 'Shelf not found' });

    const item = await userCollectionPhotosQueries.getByCollectionItem({
      itemId,
      shelfId: shelf.id,
    });
    if (!item?.ownerPhotoSource) {
      return res.status(404).json({ error: 'Owner photo not found' });
    }

    const isOwner = item.userId === req.user.id;
    if (!isOwner && !canViewerAccessOwnerPhoto(item, req.user.id)) {
      return res.status(404).json({ error: 'Owner photo not found' });
    }

    if (shouldLogOwnerPhotoDebug(item.id)) {
      logOwnerPhotoDebug('ownerPhoto.image.request', {
        shelfId: shelf.id,
        itemId: item.id,
        viewerUserId: req.user?.id || null,
        isOwner,
        source: item.ownerPhotoSource || null,
        storageProvider: item.ownerPhotoStorageProvider || null,
        hasStorageKey: !!item.ownerPhotoStorageKey,
      });
    }

    const payload = await userCollectionPhotosQueries.loadOwnerPhotoBuffer(item);
    if (shouldLogOwnerPhotoDebug(item.id)) {
      logOwnerPhotoDebug('ownerPhoto.image.response', {
        shelfId: shelf.id,
        itemId: item.id,
        contentType: payload?.contentType || null,
        contentLength: Number.isFinite(payload?.contentLength) ? payload.contentLength : (payload?.buffer?.length ?? null),
      });
    }
    res.setHeader('Content-Type', payload.contentType || item.ownerPhotoContentType || 'image/jpeg');
    if (Number.isFinite(payload.contentLength)) {
      res.setHeader('Content-Length', String(payload.contentLength));
    }
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.send(payload.buffer);
  } catch (err) {
    logger.error('getShelfItemOwnerPhotoImage error:', err);
    return res.status(500).json({ error: 'Failed to load owner photo image' });
  }
}

async function getShelfItemOwnerPhotoThumbnail(req, res) {
  try {
    const shelfId = parseInt(req.params.shelfId, 10);
    const itemId = parseInt(req.params.itemId, 10);
    if (isNaN(shelfId) || isNaN(itemId)) {
      return res.status(400).json({ error: 'Invalid shelf or item id' });
    }

    const shelf = await shelvesQueries.getForViewing(shelfId, req.user.id);
    if (!shelf) return res.status(404).json({ error: 'Shelf not found' });

    const item = await userCollectionPhotosQueries.getByCollectionItem({
      itemId,
      shelfId: shelf.id,
    });
    if (!item?.ownerPhotoSource) {
      return res.status(404).json({ error: 'Owner photo not found' });
    }

    const isOwner = item.userId === req.user.id;
    if (!isOwner && !canViewerAccessOwnerPhoto(item, req.user.id)) {
      return res.status(404).json({ error: 'Owner photo not found' });
    }

    if (shouldLogOwnerPhotoDebug(item.id)) {
      logOwnerPhotoDebug('ownerPhoto.thumbnail.request', {
        shelfId: shelf.id,
        itemId: item.id,
        viewerUserId: req.user?.id || null,
        isOwner,
        source: item.ownerPhotoSource || null,
        thumbProvider: item.ownerPhotoThumbStorageProvider || null,
        thumbHasKey: !!item.ownerPhotoThumbStorageKey,
        thumbUpdatedAt: item.ownerPhotoThumbUpdatedAt || null,
        thumbnailBox: sanitizeThumbnailBoxForLog(item.ownerPhotoThumbBox),
      });
    }

    const payload = await userCollectionPhotosQueries.loadOwnerPhotoThumbnailBuffer(item);
    if (shouldLogOwnerPhotoDebug(item.id)) {
      logOwnerPhotoDebug('ownerPhoto.thumbnail.response', {
        shelfId: shelf.id,
        itemId: item.id,
        contentType: payload?.contentType || null,
        contentLength: Number.isFinite(payload?.contentLength) ? payload.contentLength : (payload?.buffer?.length ?? null),
      });
    }
    res.setHeader('Content-Type', payload.contentType || item.ownerPhotoThumbContentType || 'image/jpeg');
    if (Number.isFinite(payload.contentLength)) {
      res.setHeader('Content-Length', String(payload.contentLength));
    }
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.send(payload.buffer);
  } catch (err) {
    logger.error('getShelfItemOwnerPhotoThumbnail error:', err);
    return res.status(500).json({ error: 'Failed to load owner photo thumbnail' });
  }
}

async function updateShelfItemOwnerPhotoVisibility(req, res) {
  try {
    const shelfId = parseInt(req.params.shelfId, 10);
    const itemId = parseInt(req.params.itemId, 10);
    if (isNaN(shelfId) || isNaN(itemId)) {
      return res.status(400).json({ error: 'Invalid shelf or item id' });
    }

    const shelf = await loadShelfForUser(req.user.id, shelfId);
    if (!shelf) return res.status(404).json({ error: 'Shelf not found' });

    const item = await shelvesQueries.getItemById(itemId, req.user.id, shelf.id);
    if (!item) {
      return res.status(404).json({ error: 'Shelf item not found' });
    }

    const visible = !!req.body?.visible;
    const updated = await userCollectionPhotosQueries.setOwnerPhotoVisibility({
      itemId: item.id,
      userId: req.user.id,
      shelfId: shelf.id,
      visible,
    });
    if (!updated) {
      return res.status(404).json({ error: 'Shelf item not found' });
    }

    const hydrated = await userCollectionPhotosQueries.getByCollectionItem({
      itemId: item.id,
      shelfId: shelf.id,
    });

    return res.json({
      ownerPhoto: formatOwnerPhotoResponse(hydrated || updated, shelf.id),
    });
  } catch (err) {
    logger.error('updateShelfItemOwnerPhotoVisibility error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

async function uploadShelfItemOwnerPhoto(req, res) {
  try {
    const shelfId = parseInt(req.params.shelfId, 10);
    const itemId = parseInt(req.params.itemId, 10);
    if (isNaN(shelfId) || isNaN(itemId)) {
      return res.status(400).json({ error: 'Invalid shelf or item id' });
    }

    const shelf = await loadShelfForUser(req.user.id, shelfId);
    if (!shelf) return res.status(404).json({ error: 'Shelf not found' });

    const item = await shelvesQueries.getItemById(itemId, req.user.id, shelf.id);
    if (!item) {
      return res.status(404).json({ error: 'Shelf item not found' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const updated = await userCollectionPhotosQueries.uploadOwnerPhotoForItem({
      itemId: item.id,
      userId: req.user.id,
      shelfId: shelf.id,
      buffer: req.file.buffer,
      contentType: req.file.mimetype || 'image/jpeg',
    });

    const hydrated = await userCollectionPhotosQueries.getByCollectionItem({
      itemId: item.id,
      shelfId: shelf.id,
    });

    return res.json({
      ownerPhoto: formatOwnerPhotoResponse(hydrated || updated, shelf.id),
    });
  } catch (err) {
    logger.error('uploadShelfItemOwnerPhoto error:', err);
    const statusCode = /image/i.test(String(err?.message || '')) ? 400 : 500;
    return res.status(statusCode).json({ error: err?.message || 'Failed to upload owner photo' });
  }
}

async function updateShelfItemOwnerPhotoThumbnail(req, res) {
  try {
    const shelfId = parseInt(req.params.shelfId, 10);
    const itemId = parseInt(req.params.itemId, 10);
    if (isNaN(shelfId) || isNaN(itemId)) {
      return res.status(400).json({ error: 'Invalid shelf or item id' });
    }
    if (!req.body || typeof req.body !== 'object' || !Object.prototype.hasOwnProperty.call(req.body, 'box')) {
      return res.status(400).json({ error: 'box is required' });
    }

    const shelf = await loadShelfForUser(req.user.id, shelfId);
    if (!shelf) return res.status(404).json({ error: 'Shelf not found' });

    const item = await shelvesQueries.getItemById(itemId, req.user.id, shelf.id);
    if (!item) {
      return res.status(404).json({ error: 'Shelf item not found' });
    }

    await userCollectionPhotosQueries.upsertOwnerPhotoThumbnailForItem({
      itemId: item.id,
      userId: req.user.id,
      shelfId: shelf.id,
      box: req.body.box,
    });

    const hydrated = await userCollectionPhotosQueries.getByCollectionItem({
      itemId: item.id,
      shelfId: shelf.id,
    });

    if (shouldLogOwnerPhotoDebug(item.id)) {
      logOwnerPhotoDebug('ownerPhoto.thumbnail.update', {
        shelfId: shelf.id,
        itemId: item.id,
        inputBox: sanitizeThumbnailBoxForLog(req.body?.box),
        persistedBox: sanitizeThumbnailBoxForLog(hydrated?.ownerPhotoThumbBox || null),
        thumbProvider: hydrated?.ownerPhotoThumbStorageProvider || null,
        thumbHasKey: !!hydrated?.ownerPhotoThumbStorageKey,
        thumbUpdatedAt: hydrated?.ownerPhotoThumbUpdatedAt || null,
      });
    }

    return res.json({
      ownerPhoto: formatOwnerPhotoResponse(hydrated || item, shelf.id),
    });
  } catch (err) {
    logger.error('updateShelfItemOwnerPhotoThumbnail error:', err);
    const message = String(err?.message || '');
    if (/thumbnail box|box|owner photo is not set/i.test(message)) {
      return res.status(400).json({ error: err?.message || 'Invalid thumbnail request' });
    }
    return res.status(500).json({ error: 'Failed to update owner photo thumbnail' });
  }
}

async function deleteShelfItemOwnerPhoto(req, res) {
  try {
    const shelfId = parseInt(req.params.shelfId, 10);
    const itemId = parseInt(req.params.itemId, 10);
    if (isNaN(shelfId) || isNaN(itemId)) {
      return res.status(400).json({ error: 'Invalid shelf or item id' });
    }

    const shelf = await loadShelfForUser(req.user.id, shelfId);
    if (!shelf) return res.status(404).json({ error: 'Shelf not found' });

    const item = await shelvesQueries.getItemById(itemId, req.user.id, shelf.id);
    if (!item) {
      return res.status(404).json({ error: 'Shelf item not found' });
    }

    const updated = await userCollectionPhotosQueries.clearOwnerPhotoForItem({
      itemId: item.id,
      userId: req.user.id,
      shelfId: shelf.id,
    });
    if (!updated) {
      return res.status(404).json({ error: 'Shelf item not found' });
    }

    const hydrated = await userCollectionPhotosQueries.getByCollectionItem({
      itemId: item.id,
      shelfId: shelf.id,
    });

    return res.json({
      ownerPhoto: formatOwnerPhotoResponse(hydrated || updated, shelf.id),
    });
  } catch (err) {
    logger.error('deleteShelfItemOwnerPhoto error:', err);
    return res.status(500).json({ error: 'Failed to delete owner photo' });
  }
}

async function extractVisionRegionCropPayload({ userId, shelfId, scanPhoto, region, scanImage = null }) {
  const sourceImage = scanImage || await visionScanPhotosQueries.loadImageBuffer(scanPhoto);
  const extracted = await extractRegionCrop({
    imageBuffer: sourceImage.buffer,
    box2d: getRegionBox2d(region),
    imageWidth: scanPhoto.width,
    imageHeight: scanPhoto.height,
  });

  const crop = await visionItemCropsQueries.upsertFromBuffer({
    userId,
    shelfId,
    scanPhotoId: scanPhoto.id,
    regionId: region.id,
    buffer: extracted.buffer,
    contentType: extracted.contentType,
  });

  return {
    crop,
    scanImage: sourceImage,
    payload: {
      buffer: extracted.buffer,
      contentType: crop?.contentType || extracted.contentType || 'image/jpeg',
      contentLength: extracted.buffer.length,
    },
  };
}

async function attachCropToCollectionItem({ userId, shelfId, shelfType = null, region, crop }) {
  if (!crop || !region) return null;
  const normalizedShelfType = String(shelfType || '').toLowerCase();
  const collectionItemId = region.collectionItemId || region.collection_item_id || null;
  const collectableId = region.collectableId || region.collectable_id || null;
  const manualId = region.manualId || region.manual_id || null;
  let collectionItem = null;

  if (collectionItemId) {
    const byId = await shelvesQueries.getCollectionItemByIdForShelf(collectionItemId, shelfId);
    if (byId?.id && String(byId.userId) === String(userId)) {
      collectionItem = byId;
    } else {
      logger.warn('[Vision] Region collection item link did not resolve for user/shelf', {
        shelfId,
        regionId: region.id,
        collectionItemId,
      });
    }
  }

  if (!collectionItem?.id) {
    if (!collectableId && !manualId) return null;

    // First-region-wins policy: if any region for the same scan/reference already has a
    // collection_item_id link, this region is a non-winning duplicate and should not
    // auto-attach/overwrite the owner photo via collectable/manual fallback.
    const scanPhotoId = region.scanPhotoId || region.scan_photo_id || null;
    if (scanPhotoId) {
      try {
        const hasLinkedWinner = await visionItemRegionsQueries.hasCollectionItemLinkForReference({
          scanPhotoId,
          collectableId,
          manualId,
        });
        if (hasLinkedWinner) {
          logger.info('[Vision] Skipping fallback crop attach for non-winning duplicate region', {
            shelfId,
            scanPhotoId,
            regionId: region.id,
            collectableId,
            manualId,
          });
          return null;
        }
      } catch (err) {
        // Keep fallback behavior on older schemas where region link columns/tables are unavailable.
        if (err?.code !== '42P01' && err?.code !== '42703') {
          throw err;
        }
      }
    }

    collectionItem = await shelvesQueries.findCollectionByReference({
      userId,
      shelfId,
      collectableId,
      manualId,
    });
  }

  if (!collectionItem?.id) return null;

  let attached = null;
  try {
    attached = await userCollectionPhotosQueries.attachVisionCropToItem({
      itemId: collectionItem.id,
      userId,
      shelfId,
      cropId: crop.id,
      contentType: crop.contentType || null,
      sizeBytes: crop.sizeBytes ?? null,
      width: crop.width ?? null,
      height: crop.height ?? null,
    });
  } catch (err) {
    logger.warn('[Vision] Failed to attach crop to collection item', {
      shelfId,
      regionId: region.id,
      cropId: crop.id,
      message: err?.message || String(err),
    });
    attached = null;
  }

  const shouldPromoteManualCoverFromCrop = (
    manualId
    && normalizedShelfType === 'other'
    && attached
    && attached.ownerPhotoSource === 'vision_crop'
    && attached.ownerPhotoVisible === true
  );

  if (shouldPromoteManualCoverFromCrop) {
    try {
      const manualCoverResult = await query(
        `SELECT cover_media_path
         FROM user_manuals
         WHERE id = $1 AND user_id = $2
         LIMIT 1`,
        [manualId, userId],
      );
      const hasPrimaryCover = !!manualCoverResult.rows[0]?.cover_media_path;
      if (hasPrimaryCover) {
        return attached;
      }

      const cropPayload = await visionItemCropsQueries.loadImageBuffer(crop);
      await manualMediaQueries.uploadFromBuffer({
        userId,
        manualId,
        buffer: cropPayload.buffer,
        contentType: cropPayload.contentType || crop.contentType || 'image/jpeg',
      });
    } catch (err) {
      logger.warn('[Vision] Failed to promote manual cover from crop', {
        shelfId,
        manualId,
        regionId: region.id,
        cropId: crop.id,
        message: err?.message || String(err),
      });
    }
  }

  return attached;
}

async function getOrCreateVisionRegionCrop({ userId, shelfId, shelfType = null, scanPhoto, region }) {
  let crop = null;
  let cropTableAvailable = true;
  try {
    crop = await visionItemCropsQueries.getByRegionIdForUser({
      userId,
      shelfId,
      scanPhotoId: scanPhoto.id,
      regionId: region.id,
    });
  } catch (err) {
    if (!isMissingRelationError(err, 'vision_item_crops')) {
      throw err;
    }
    cropTableAvailable = false;
    logger.warn('[Vision] vision_item_crops table missing; generating crop without persistence.');
  }

  if (crop) {
    await attachCropToCollectionItem({ userId, shelfId, shelfType, region, crop });
    const payload = await visionItemCropsQueries.loadImageBuffer(crop);
    return { crop, payload };
  }

  const scanImage = await visionScanPhotosQueries.loadImageBuffer(scanPhoto);
  const extracted = await extractRegionCrop({
    imageBuffer: scanImage.buffer,
    box2d: getRegionBox2d(region),
    imageWidth: scanPhoto.width,
    imageHeight: scanPhoto.height,
  });

  if (cropTableAvailable) {
    try {
      crop = await visionItemCropsQueries.upsertFromBuffer({
        userId,
        shelfId,
        scanPhotoId: scanPhoto.id,
        regionId: region.id,
        buffer: extracted.buffer,
        contentType: extracted.contentType,
      });
    } catch (persistErr) {
      if (!isMissingRelationError(persistErr, 'vision_item_crops')) {
        throw persistErr;
      }
      cropTableAvailable = false;
      logger.warn('[Vision] vision_item_crops table missing while persisting crop; continuing without persistence.');
    }
  }

  if (crop) {
    await attachCropToCollectionItem({ userId, shelfId, shelfType, region, crop });
  }

  return {
    crop,
    payload: {
      buffer: extracted.buffer,
      contentType: crop?.contentType || extracted.contentType || 'image/jpeg',
      contentLength: extracted.buffer.length,
    },
  };
}

async function warmVisionScanCrops({ userId, shelfId, shelfType = null, scanPhotoId, jobId = null }) {
  if (!VISION_CROP_WARMUP_ENABLED || !scanPhotoId) return;

  try {
    let resolvedShelfType = shelfType ? String(shelfType).toLowerCase() : null;
    if (!resolvedShelfType) {
      const shelf = await loadShelfForUser(userId, shelfId);
      resolvedShelfType = String(shelf?.type || '').toLowerCase();
    }

    const scanPhoto = await visionScanPhotosQueries.getByIdForUser({
      id: scanPhotoId,
      userId,
      shelfId,
    });
    if (!scanPhoto) return;

    const regions = await visionItemRegionsQueries.listForScan({
      userId,
      shelfId,
      scanPhotoId: scanPhoto.id,
    });
    if (!regions.length) return;

    let existingCrops = [];
    try {
      existingCrops = await visionItemCropsQueries.listForScan({
        userId,
        shelfId,
        scanPhotoId: scanPhoto.id,
      });
    } catch (err) {
      if (!isMissingRelationError(err, 'vision_item_crops')) {
        throw err;
      }
      logger.warn('[Vision] vision_item_crops table missing; skipping crop warmup.');
      return;
    }

    const existingByRegion = new Set(existingCrops.map((crop) => crop.regionId));
    const uncroppedTargets = regions.filter((region) => !existingByRegion.has(region.id));
    if (!uncroppedTargets.length) return;

    let warmupLimit = VISION_CROP_WARMUP_MAX_REGIONS;
    try {
      const [queueDepth, queueSettings] = await Promise.all([
        workflowQueueJobsQueries.countQueued({ workflowType: WORKFLOW_TYPE_VISION }),
        getWorkflowQueueSettings(),
      ]);
      const pressureThreshold = Math.max(
        queueSettings.workflowQueueLongThresholdPosition,
        WORKFLOW_QUEUE_NOTIFY_FORCE_LONG_POSITION,
      );
      if (queueDepth >= pressureThreshold) {
        warmupLimit = Math.min(warmupLimit, VISION_CROP_WARMUP_PRESSURE_MAX_REGIONS);
      }
      if (queueDepth >= VISION_CROP_WARMUP_DEFER_QUEUE_DEPTH) {
        logger.info('[Vision] Skipping crop warmup under queue pressure', {
          shelfId,
          scanPhotoId: scanPhoto.id,
          queueDepth,
          threshold: VISION_CROP_WARMUP_DEFER_QUEUE_DEPTH,
          jobId,
        });
        return;
      }
    } catch (pressureErr) {
      logger.warn('[Vision] Failed to evaluate queue pressure for crop warmup', {
        message: pressureErr?.message || String(pressureErr),
      });
    }

    const warmupTargets = uncroppedTargets.slice(0, warmupLimit);
    if (!warmupTargets.length) return;

    let generated = 0;
    let failed = 0;
    let scanImage = null;

    for (const region of warmupTargets) {
      try {
        const result = await extractVisionRegionCropPayload({
          userId,
          shelfId,
          scanPhoto,
          region,
          scanImage,
        });
        scanImage = result.scanImage || scanImage;
        await attachCropToCollectionItem({
          userId,
          shelfId,
          shelfType: resolvedShelfType,
          region,
          crop: result.crop,
        });
        generated += 1;
      } catch (err) {
        failed += 1;
        logger.warn('[Vision] Failed to warm crop for region', {
          scanPhotoId: scanPhoto.id,
          regionId: region.id,
          box2d: sanitizeBox2dForLog(getRegionBox2d(region)),
          message: err?.message || String(err),
        });
      }
    }

    logger.info('[Vision] Crop warmup complete', {
      shelfId,
      scanPhotoId: scanPhoto.id,
      requested: warmupTargets.length,
      generated,
      failed,
      jobId,
    });
  } catch (err) {
    logger.warn('[Vision] Crop warmup failed', {
      shelfId,
      scanPhotoId,
      jobId,
      message: err?.message || String(err),
    });
  }
}

function queueVisionCropWarmup({ userId, shelfId, shelfType = null, scanPhotoId, jobId = null }) {
  if (!VISION_CROP_WARMUP_ENABLED || !scanPhotoId) return;
  setImmediate(() => {
    warmVisionScanCrops({ userId, shelfId, shelfType, scanPhotoId, jobId }).catch((err) => {
      logger.warn('[Vision] Unexpected crop warmup queue error', {
        shelfId,
        scanPhotoId,
        jobId,
        message: err?.message || String(err),
      });
    });
  });
}

function buildPipelineOptions({ rawItems, scanPhotoId, scanPhotoDimensions, abortCheck = null }) {
  const options = {};
  if (Array.isArray(rawItems) && rawItems.length > 0) {
    options.rawItems = rawItems;
    options.ocrProvider = 'mlkit';
  }
  if (scanPhotoId) {
    options.scanPhotoId = scanPhotoId;
    if (scanPhotoDimensions) {
      options.scanPhotoDimensions = scanPhotoDimensions;
    }
  }
  if (typeof abortCheck === 'function') {
    options.abortCheck = abortCheck;
  }
  return Object.keys(options).length > 0 ? options : null;
}

async function runVisionPipelineJob({
  jobId,
  userId,
  shelf,
  imageBase64,
  rawItems,
  isCloudVision,
  imageSha256 = null,
  scanPhotoId = null,
  scanPhotoDimensions = null,
  abortCheck = null,
}) {
  const hooks = getVisionPipelineHooks();
  const pipeline = new VisionPipelineService({ hooks });
  const resolvedPipelineOptions = buildPipelineOptions({
    rawItems,
    scanPhotoId,
    scanPhotoDimensions,
    abortCheck,
  });

  const result = await pipeline.processImage(
    imageBase64,
    shelf,
    userId,
    jobId,
    resolvedPipelineOptions,
  );
  const counts = buildVisionCounts(result);

  if (isCloudVision) {
    try {
      await visionQuotaQueries.incrementUsage(userId);
    } catch (quotaErr) {
      logger.warn('[Vision] Failed to increment quota:', quotaErr.message);
    }
  }

  if (isCloudVision && imageSha256) {
    try {
      await visionResultCacheQueries.set({
        userId,
        shelfId: shelf.id,
        imageSha256,
        resultJson: {
          analysis: result.analysis,
          results: result.results,
          addedItems: result.addedItems,
          needsReview: result.needsReview,
          warnings: result.warnings,
        },
      });
    } catch (cacheWriteErr) {
      if (cacheWriteErr?.code !== '42P01') {
        logger.warn('[Vision] Cache write failed:', cacheWriteErr?.message || cacheWriteErr);
      }
    }
  }

  if (VISION_CROP_WARMUP_ENABLED && scanPhotoId) {
    processingStatus.updateJob(jobId, {
      step: 'generating-photos',
      progress: 95,
      message: 'Generating item photos...',
      status: 'processing',
    });
    await warmVisionScanCrops({
      userId,
      shelfId: shelf.id,
      shelfType: shelf.type,
      scanPhotoId,
      jobId,
    });
  }

  const output = {
    analysis: result.analysis,
    results: result.results,
    addedItems: result.addedItems,
    needsReview: result.needsReview,
    ...counts,
    warnings: result.warnings,
    scanPhotoId,
  };
  processingStatus.completeJob(jobId, output);
  return output;
}

async function processQueuedVisionWorkflowJob(job, { shouldAbort }) {
  const payload = job?.payload && typeof job.payload === 'object' ? job.payload : {};
  const shelfId = Number(payload.shelfId || job.shelfId);
  const userId = payload.userId || job.userId;
  const shelf = await loadShelfForUser(userId, shelfId);
  if (!shelf) {
    const err = new Error('Shelf not found');
    err.status = 404;
    throw err;
  }
  if (isOtherShelfType(shelf.type) && !hasShelfDescription(shelf.description)) {
    throw new Error(OTHER_SHELF_DESCRIPTION_REQUIRED_ERROR);
  }

  processingStatus.setJob(job.jobId, {
    jobId: job.jobId,
    userId,
    shelfId: shelf.id,
    status: 'processing',
    step: 'initializing',
    progress: 1,
    message: 'Processing queued vision job...',
    aborted: false,
    result: null,
  });

  return runVisionPipelineJob({
    jobId: job.jobId,
    userId,
    shelf,
    imageBase64: payload.imageBase64 || null,
    rawItems: Array.isArray(payload.rawItems) ? payload.rawItems : null,
    isCloudVision: payload.isCloudVision !== false,
    imageSha256: payload.imageSha256 || null,
    scanPhotoId: Number(payload.scanPhotoId) || null,
    scanPhotoDimensions: payload.scanPhotoDimensions || null,
    abortCheck: async () => {
      if (typeof shouldAbort === 'function') {
        return (await shouldAbort()) === true;
      }
      return false;
    },
  });
}

let queueHandlerRegistered = false;
function ensureQueueHandlerRegistered() {
  if (queueHandlerRegistered) return;
  getWorkflowQueueService().registerHandler(WORKFLOW_TYPE_VISION, processQueuedVisionWorkflowJob);
  queueHandlerRegistered = true;
}
ensureQueueHandlerRegistered();

// Vision processing (using durable queue + async job tracking)
async function processShelfVision(req, res) {
  try {
    const shelf = await loadShelfForUser(req.user.id, req.params.shelfId);
    if (!shelf) return res.status(404).json({ error: "Shelf not found" });
    if (isOtherShelfType(shelf.type) && !hasShelfDescription(shelf.description)) {
      return res.status(400).json({ error: OTHER_SHELF_DESCRIPTION_REQUIRED_ERROR });
    }

    const { imageBase64, rawItems, metadata: requestMetadata = {}, async: asyncMode = true } = req.body ?? {};
    if (!imageBase64 && (!Array.isArray(rawItems) || rawItems.length === 0)) {
      return res.status(400).json({ error: "imageBase64 or rawItems are required" });
    }

    if (!req.user.isPremium) {
      return res.status(403).json({
        error: "Vision features are premium only.",
        requiresPremium: true
      });
    }

    const isCloudVision = !rawItems || rawItems.length === 0;
    let imageSha256 = null;
    let cachedVision = null;
    let scanPhotoId = null;
    let scanPhotoDimensions = null;

    if (isCloudVision && imageBase64) {
      imageSha256 = computeImageSha256(imageBase64);
      try {
        const payload = decodeImageBase64Payload(imageBase64);
        const buffer = Buffer.from(payload, 'base64');
        const scanPhoto = await visionScanPhotosQueries.upsertFromBuffer({
          userId: req.user.id,
          shelfId: shelf.id,
          imageSha256,
          buffer,
        });
        scanPhotoId = scanPhoto?.id || null;
        if (Number.isFinite(Number(scanPhoto?.width)) && Number.isFinite(Number(scanPhoto?.height))) {
          scanPhotoDimensions = {
            width: Number(scanPhoto.width),
            height: Number(scanPhoto.height),
          };
        }
      } catch (scanPhotoErr) {
        logger.error('[Vision] Failed to persist scan photo:', scanPhotoErr?.message || scanPhotoErr);
        const message = String(scanPhotoErr?.message || '');
        const statusCode = /image|base64|unsupported|dimensions|payload/i.test(message) ? 400 : 500;
        return res.status(statusCode).json({ error: scanPhotoErr?.message || 'Failed to persist scan photo' });
      }

      try {
        cachedVision = await visionResultCacheQueries.getValid({
          userId: req.user.id,
          shelfId: shelf.id,
          imageSha256,
        });
      } catch (cacheReadErr) {
        if (cacheReadErr?.code !== '42P01') {
          logger.warn('[Vision] Cache read failed:', cacheReadErr?.message || cacheReadErr);
        }
      }
      logger.info('[Vision] Image cache lookup', {
        shelfId: shelf.id,
        hashPrefix: imageSha256.slice(0, 12),
        cacheHit: !!cachedVision,
      });
    }

    const jobId = processingStatus.generateJobId(req.user.id, shelf.id);
    processingStatus.createJob(jobId, req.user.id, shelf.id);

    if (cachedVision?.resultJson) {
      const cachedResult = cachedVision.resultJson;
      const counts = buildVisionCounts(cachedResult, { cached: true });
      processingStatus.completeJob(jobId, {
        analysis: cachedResult.analysis,
        results: cachedResult.results,
        ...counts,
        warnings: cachedResult.warnings,
        cached: true,
        scanPhotoId,
      });

      if (asyncMode) {
        return res.status(202).json({
          jobId,
          status: 'completed',
          queuePosition: 0,
          estimatedWaitSeconds: 0,
          notifyOnComplete: false,
          message: 'Same photo detected. Using previous scan result.',
          metadata: requestMetadata,
          cached: true,
          scanPhotoId,
        });
      }

      const items = await hydrateShelfItems(req.user.id, shelf.id);
      return res.json({
        jobId,
        analysis: omitMarketValueSourcesDeep(cachedResult.analysis),
        results: cachedResult.results,
        addedItems: omitMarketValueSourcesDeep(cachedResult.addedItems),
        needsReview: omitMarketValueSourcesDeep(cachedResult.needsReview),
        ...counts,
        items,
        visionStatus: { status: 'completed', provider: 'google-vision-gemini-pipeline' },
        metadata: requestMetadata,
        warnings: cachedResult.warnings,
        cached: true,
        scanPhotoId,
      });
    }

    if (isCloudVision) {
      const quota = await visionQuotaQueries.getQuota(req.user.id);
      if (quota.scansRemaining <= 0) {
        return res.status(429).json({
          error: 'Monthly vision scan quota exceeded',
          quotaExceeded: true,
          quota: {
            scansUsed: quota.scansUsed,
            scansRemaining: 0,
            daysRemaining: quota.daysRemaining,
            monthlyLimit: quota.monthlyLimit,
          },
        });
      }
    }

    if (asyncMode) {
      const queueSettings = await getWorkflowQueueSettings();
      const queuedCountForUser = await workflowQueueJobsQueries.countQueuedForUser({
        workflowType: WORKFLOW_TYPE_VISION,
        userId: req.user.id,
      });
      if (queuedCountForUser >= queueSettings.workflowQueueMaxQueuedPerUser) {
        return res.status(429).json({
          error: 'Too many queued workflows for this user',
          code: 'workflow_queue_user_cap_exceeded',
          maxQueuedPerUser: queueSettings.workflowQueueMaxQueuedPerUser,
        });
      }

      const dedupeKey = (isCloudVision && imageSha256)
        ? buildVisionQueueDedupeKey({
          userId: req.user.id,
          shelfId: shelf.id,
          imageSha256,
        })
        : null;

      if (dedupeKey) {
        const activeDuplicate = await workflowQueueJobsQueries.findActiveByDedupeKey({
          workflowType: WORKFLOW_TYPE_VISION,
          dedupeKey,
        });
        if (activeDuplicate) {
          const queueMeta = await getQueueMetadata(activeDuplicate.jobId);
          return res.status(202).json({
            jobId: activeDuplicate.jobId,
            status: activeDuplicate.status === 'processing' ? 'processing' : 'queued',
            queuePosition: queueMeta.queuePosition,
            estimatedWaitSeconds: queueMeta.estimatedWaitSeconds,
            notifyOnComplete: activeDuplicate.notifyOnComplete === true,
            notifyInAppOnComplete: activeDuplicate.notifyInAppOnComplete === true,
            message: 'Duplicate scan already in progress. Returning existing job.',
            metadata: requestMetadata,
            cached: false,
            scanPhotoId: Number(activeDuplicate?.payload?.scanPhotoId || scanPhotoId || 0) || null,
          });
        }
      }

      const payload = {
        userId: req.user.id,
        shelfId: shelf.id,
        imageBase64: imageBase64 || null,
        rawItems: Array.isArray(rawItems) ? rawItems : null,
        isCloudVision,
        imageSha256,
        scanPhotoId,
        scanPhotoDimensions,
        metadata: requestMetadata,
      };

      let queuedJob = null;
      try {
        queuedJob = await workflowQueueJobsQueries.enqueueJob({
          jobId,
          workflowType: WORKFLOW_TYPE_VISION,
          userId: req.user.id,
          shelfId: shelf.id,
          status: 'queued',
          priority: 100,
          maxAttempts: queueSettings.workflowQueueRetryMaxAttempts,
          payload,
          dedupeKey,
          notifyOnComplete: false,
          notifyInAppOnComplete: false,
        });
      } catch (enqueueErr) {
        if (enqueueErr?.code === '23505' && dedupeKey) {
          const activeDuplicate = await workflowQueueJobsQueries.findActiveByDedupeKey({
            workflowType: WORKFLOW_TYPE_VISION,
            dedupeKey,
          });
          if (activeDuplicate) {
            const queueMeta = await getQueueMetadata(activeDuplicate.jobId);
            return res.status(202).json({
              jobId: activeDuplicate.jobId,
              status: activeDuplicate.status === 'processing' ? 'processing' : 'queued',
              queuePosition: queueMeta.queuePosition,
              estimatedWaitSeconds: queueMeta.estimatedWaitSeconds,
              notifyOnComplete: activeDuplicate.notifyOnComplete === true,
              notifyInAppOnComplete: activeDuplicate.notifyInAppOnComplete === true,
              message: 'Duplicate scan already in progress. Returning existing job.',
              metadata: requestMetadata,
              cached: false,
              scanPhotoId: Number(activeDuplicate?.payload?.scanPhotoId || scanPhotoId || 0) || null,
            });
          }
        }
        throw enqueueErr;
      }

      processingStatus.setJob(jobId, {
        jobId,
        userId: req.user.id,
        shelfId: shelf.id,
        status: 'queued',
        step: 'queued',
        progress: 0,
        message: 'Queued for processing',
        aborted: false,
        result: null,
      });

      const queueMeta = await getQueueMetadata(queuedJob.jobId);
      let notifyOnComplete = queuedJob.notifyOnComplete === true;
      let notifyInAppOnComplete = queuedJob.notifyInAppOnComplete === true;

      // In-between option: position #2 gets in-app-only completion notification (no push).
      if (!notifyInAppOnComplete && Number(queueMeta.queuePosition) === 2) {
        const updated = await workflowQueueJobsQueries.setInAppOnlyCompletionNotice({
          jobId: queuedJob.jobId,
        });
        if (updated) {
          queuedJob = updated;
          notifyOnComplete = updated.notifyOnComplete === true;
          notifyInAppOnComplete = updated.notifyInAppOnComplete === true;
        } else {
          notifyOnComplete = false;
          notifyInAppOnComplete = true;
        }
      }

      if (!notifyOnComplete && !notifyInAppOnComplete) {
        notifyOnComplete = await shouldEnableQueueNotification(queueMeta);
        if (notifyOnComplete) {
          const updated = await workflowQueueJobsQueries.updateNotifyOnComplete({
            jobId: queuedJob.jobId,
            notifyOnComplete: true,
          });
          if (updated) queuedJob = updated;
        }
      }

      getWorkflowQueueService().tick().catch((err) => {
        logger.warn('[Vision] failed to trigger queue tick after enqueue', {
          message: err?.message || String(err),
        });
      });

      return res.status(202).json({
        jobId: queuedJob.jobId,
        status: 'queued',
        queuePosition: queueMeta.queuePosition,
        estimatedWaitSeconds: queueMeta.estimatedWaitSeconds,
        notifyOnComplete,
        notifyInAppOnComplete,
        message: 'Vision processing queued. Poll /vision/:jobId/status for updates.',
        metadata: requestMetadata,
        cached: false,
        scanPhotoId,
      });
    }

    const output = await runVisionPipelineJob({
      jobId,
      userId: req.user.id,
      shelf,
      imageBase64,
      rawItems,
      isCloudVision,
      imageSha256,
      scanPhotoId,
      scanPhotoDimensions,
    });

    const items = await hydrateShelfItems(req.user.id, shelf.id);
    return res.json({
      jobId,
      analysis: omitMarketValueSourcesDeep(output.analysis),
      results: output.results,
      addedItems: omitMarketValueSourcesDeep(output.addedItems),
      needsReview: omitMarketValueSourcesDeep(output.needsReview),
      addedCount: output.addedCount,
      needsReviewCount: output.needsReviewCount,
      existingCount: output.existingCount,
      extractedCount: output.extractedCount,
      summaryMessage: output.summaryMessage,
      items,
      visionStatus: { status: 'completed', provider: 'google-vision-gemini-pipeline' },
      metadata: requestMetadata,
      warnings: output.warnings,
      cached: false,
      scanPhotoId,
    });
  } catch (err) {
    logger.error("Vision analysis failed", err);
    return res.status(502).json({ error: "Vision analysis failed" });
  }
}

async function getVisionScanPhoto(req, res) {
  try {
    const shelf = await loadShelfForUser(req.user.id, req.params.shelfId);
    if (!shelf) return res.status(404).json({ error: "Shelf not found" });

    const scanPhotoId = parseInt(req.params.scanPhotoId, 10);
    if (isNaN(scanPhotoId)) {
      return res.status(400).json({ error: 'Invalid scan photo id' });
    }

    const scanPhoto = await visionScanPhotosQueries.getByIdForUser({
      id: scanPhotoId,
      userId: req.user.id,
      shelfId: shelf.id,
    });
    if (!scanPhoto) {
      return res.status(404).json({ error: 'Scan photo not found' });
    }

    const regionCount = await visionItemRegionsQueries.countForScan({
      userId: req.user.id,
      shelfId: shelf.id,
      scanPhotoId: scanPhoto.id,
    });

    res.json({
      scanPhoto: {
        id: scanPhoto.id,
        shelfId: scanPhoto.shelfId,
        contentType: scanPhoto.contentType,
        sizeBytes: scanPhoto.sizeBytes,
        width: scanPhoto.width,
        height: scanPhoto.height,
        createdAt: scanPhoto.createdAt,
        regionCount,
        imageUrl: `/api/shelves/${shelf.id}/vision/scans/${scanPhoto.id}/image`,
      },
    });
  } catch (err) {
    logger.error('getVisionScanPhoto error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function getVisionScanPhotoImage(req, res) {
  try {
    const shelf = await loadShelfForUser(req.user.id, req.params.shelfId);
    if (!shelf) return res.status(404).json({ error: "Shelf not found" });

    const scanPhotoId = parseInt(req.params.scanPhotoId, 10);
    if (isNaN(scanPhotoId)) {
      return res.status(400).json({ error: 'Invalid scan photo id' });
    }

    const scanPhoto = await visionScanPhotosQueries.getByIdForUser({
      id: scanPhotoId,
      userId: req.user.id,
      shelfId: shelf.id,
    });
    if (!scanPhoto) {
      return res.status(404).json({ error: 'Scan photo not found' });
    }

    const image = await visionScanPhotosQueries.loadImageBuffer(scanPhoto);
    res.setHeader('Content-Type', image.contentType || 'image/jpeg');
    if (Number.isFinite(image.contentLength)) {
      res.setHeader('Content-Length', String(image.contentLength));
    }
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(image.buffer);
  } catch (err) {
    logger.error('getVisionScanPhotoImage error:', err);
    res.status(500).json({ error: 'Failed to load scan photo image' });
  }
}

async function listVisionScanRegions(req, res) {
  try {
    const shelf = await loadShelfForUser(req.user.id, req.params.shelfId);
    if (!shelf) return res.status(404).json({ error: "Shelf not found" });

    const scanPhotoId = parseInt(req.params.scanPhotoId, 10);
    if (isNaN(scanPhotoId)) {
      return res.status(400).json({ error: 'Invalid scan photo id' });
    }

    const scanPhoto = await visionScanPhotosQueries.getByIdForUser({
      id: scanPhotoId,
      userId: req.user.id,
      shelfId: shelf.id,
    });
    if (!scanPhoto) {
      return res.status(404).json({ error: 'Scan photo not found' });
    }

    const regions = await visionItemRegionsQueries.listForScan({
      userId: req.user.id,
      shelfId: shelf.id,
      scanPhotoId: scanPhoto.id,
    });
    let crops = [];
    try {
      crops = await visionItemCropsQueries.listForScan({
        userId: req.user.id,
        shelfId: shelf.id,
        scanPhotoId: scanPhoto.id,
      });
    } catch (err) {
      if (!isMissingRelationError(err, 'vision_item_crops')) {
        throw err;
      }
      logger.warn('[Vision] vision_item_crops table missing; returning regions without crop metadata.');
    }
    const cropByRegionId = new Map(crops.map((crop) => [crop.regionId, crop]));
    const regionsWithCropStatus = regions.map((region) => {
      const crop = cropByRegionId.get(region.id);
      return {
        ...region,
        hasCrop: !!crop,
        cropImageUrl: `/api/shelves/${shelf.id}/vision/scans/${scanPhoto.id}/regions/${region.id}/crop`,
        cropContentType: crop?.contentType || null,
        cropWidth: crop?.width ?? null,
        cropHeight: crop?.height ?? null,
        cropCreatedAt: crop?.createdAt ?? null,
      };
    });

    res.json({
      scanPhotoId: scanPhoto.id,
      regions: regionsWithCropStatus,
    });
  } catch (err) {
    logger.error('listVisionScanRegions error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function getVisionScanRegionCrop(req, res) {
  try {
    const shelf = await loadShelfForUser(req.user.id, req.params.shelfId);
    if (!shelf) return res.status(404).json({ error: 'Shelf not found' });

    const scanPhotoId = parseInt(req.params.scanPhotoId, 10);
    if (isNaN(scanPhotoId)) {
      return res.status(400).json({ error: 'Invalid scan photo id' });
    }
    const regionId = parseInt(req.params.regionId, 10);
    if (isNaN(regionId)) {
      return res.status(400).json({ error: 'Invalid region id' });
    }

    const scanPhoto = await visionScanPhotosQueries.getByIdForUser({
      id: scanPhotoId,
      userId: req.user.id,
      shelfId: shelf.id,
    });
    if (!scanPhoto) {
      return res.status(404).json({ error: 'Scan photo not found' });
    }

    const region = await visionItemRegionsQueries.getByIdForScan({
      userId: req.user.id,
      shelfId: shelf.id,
      scanPhotoId: scanPhoto.id,
      regionId,
    });
    if (!region) {
      return res.status(404).json({ error: 'Region not found' });
    }

    const { payload } = await getOrCreateVisionRegionCrop({
      userId: req.user.id,
      shelfId: shelf.id,
      shelfType: shelf.type,
      scanPhoto,
      region,
    });

    res.setHeader('Content-Type', payload.contentType || 'image/jpeg');
    if (Number.isFinite(payload.contentLength)) {
      res.setHeader('Content-Length', String(payload.contentLength));
    }
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(payload.buffer);
  } catch (err) {
    logger.error('getVisionScanRegionCrop error:', err);
    const message = String(err?.message || '');
    if (/crop|box_2d|dimensions/i.test(message)) {
      return res.status(422).json({ error: 'Unable to generate crop for this region' });
    }
    return res.status(500).json({ error: 'Failed to load region crop' });
  }
}

/**
 * Get vision processing job status (for polling)
 */
async function getVisionStatus(req, res) {
  try {
    const { jobId } = req.params;
    const inMemory = processingStatus.getJob(jobId);
    const queueJob = await workflowQueueJobsQueries.getByJobIdForUser({
      jobId,
      userId: req.user.id,
    });

    if (!inMemory && !queueJob) {
      return res.status(404).json({ error: 'Job not found or expired' });
    }
    if (inMemory && inMemory.userId !== req.user.id && !queueJob) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const status = queueJob?.status || inMemory?.status || 'queued';
    const shelfId = Number(inMemory?.shelfId || queueJob?.shelfId || req.params.shelfId || 0) || null;
    const canUseMemoryFields = inMemory && inMemory.status === status;
    const step = (canUseMemoryFields ? inMemory?.step : null)
      || (status === 'queued' ? 'queued' : status === 'processing' ? 'processing' : 'completed');
    const progress = canUseMemoryFields && Number.isFinite(Number(inMemory?.progress))
      ? Number(inMemory.progress)
      : (status === 'queued' ? 0 : status === 'processing' ? 5 : status === 'completed' ? 100 : 0);
    const message = (canUseMemoryFields ? inMemory?.message : null)
      || (status === 'queued'
        ? 'Queued for processing'
        : status === 'processing'
          ? 'Processing in progress'
          : status === 'completed'
            ? 'Processing complete'
            : status === 'aborted'
              ? 'Processing cancelled by user'
              : queueJob?.error?.message
                || 'Processing failed');
    const result = inMemory?.result || queueJob?.result || null;

    let queuePosition = null;
    let queuedMs = 0;
    let estimatedWaitSeconds = 0;
    if (queueJob?.status === 'queued') {
      queuePosition = await workflowQueueJobsQueries.getQueuePosition(jobId);
      queuedMs = getQueuedMs(queueJob.createdAt);
      estimatedWaitSeconds = estimateQueueWaitSeconds(queuePosition);
    }

    let items = null;
    if (status === 'completed' && shelfId) {
      items = await hydrateShelfItems(req.user.id, shelfId);
    }

    if (!inMemory && queueJob) {
      processingStatus.setJob(jobId, {
        jobId,
        userId: req.user.id,
        shelfId,
        status,
        step,
        progress,
        message,
        result,
        aborted: status === 'aborted',
      });
    }

    res.json({
      jobId,
      status,
      step,
      progress,
      message,
      queuePosition,
      queuedMs,
      estimatedWaitSeconds,
      notifyOnComplete: queueJob?.notifyOnComplete === true,
      notifyInAppOnComplete: queueJob?.notifyInAppOnComplete === true,
      result: omitMarketValueSourcesDeep(result),
      items,
    });
  } catch (err) {
    logger.error('getVisionStatus error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function setVisionBackground(req, res) {
  try {
    const { jobId } = req.params;
    const queueJob = await workflowQueueJobsQueries.getByJobIdForUser({
      jobId,
      userId: req.user.id,
    });
    if (!queueJob) {
      return res.status(404).json({ error: 'Job not found or expired' });
    }

    if (['completed', 'failed', 'aborted'].includes(queueJob.status)) {
      return res.json({
        jobId,
        status: queueJob.status,
        notifyOnComplete: queueJob.notifyOnComplete === true,
        notifyInAppOnComplete: queueJob.notifyInAppOnComplete === true,
      });
    }

    const updated = await workflowQueueJobsQueries.setInAppOnlyCompletionNotice({ jobId });
    if (!updated) {
      return res.status(404).json({ error: 'Job not found or expired' });
    }

    return res.json({
      jobId,
      status: updated.status,
      notifyOnComplete: updated.notifyOnComplete === true,
      notifyInAppOnComplete: updated.notifyInAppOnComplete === true,
      message: 'Completion notice set to in-app notifications only.',
    });
  } catch (err) {
    logger.error('setVisionBackground error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

/**
 * Abort vision processing job
 */
async function abortVision(req, res) {
  try {
    const { jobId } = req.params;
    const inMemory = processingStatus.getJob(jobId);
    const queueJob = await workflowQueueJobsQueries.getByJobIdForUser({
      jobId,
      userId: req.user.id,
    });

    if (!inMemory && !queueJob) {
      return res.status(404).json({ error: 'Job not found or expired' });
    }
    if (inMemory && inMemory.userId !== req.user.id && !queueJob) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!queueJob) {
      const aborted = processingStatus.abortJob(jobId);
      return res.json({
        jobId,
        aborted,
        status: aborted ? 'aborted' : null,
        message: aborted ? 'Job abort requested' : 'Job could not be aborted',
      });
    }

    const updated = await workflowQueueJobsQueries.requestAbort({
      jobId,
      userId: req.user.id,
    });
    if (!updated) {
      return res.status(404).json({ error: 'Job not found or expired' });
    }

    const preserveStatus = updated.status === 'processing';
    if (inMemory && inMemory.userId === req.user.id) {
      processingStatus.abortJob(jobId, { preserveStatus });
    } else if (updated.status === 'aborted') {
      processingStatus.setJob(jobId, {
        jobId,
        userId: req.user.id,
        shelfId: updated.shelfId || null,
        status: 'aborted',
        step: 'aborted',
        progress: 0,
        message: 'Processing cancelled by user',
        aborted: true,
        result: null,
      });
    }

    res.json({
      jobId,
      aborted: true,
      status: updated.status,
      message: updated.status === 'aborted'
        ? 'Queued job removed'
        : 'Abort requested for running job',
    });
  } catch (err) {
    logger.error('abortVision error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function processCatalogLookup(req, res) {
  try {
    const shelf = await loadShelfForUser(req.user.id, req.params.shelfId);
    if (!shelf) return res.status(404).json({ error: "Shelf not found" });
    if (isOtherShelfType(shelf.type) && !hasShelfDescription(shelf.description)) {
      return res.status(400).json({ error: OTHER_SHELF_DESCRIPTION_REQUIRED_ERROR });
    }

    const { items: rawItems } = req.body ?? {};
    if (!Array.isArray(rawItems) || !rawItems.length) {
      return res.status(400).json({ error: "items array is required" });
    }

    // Normalize mobile OCR items ({ name, author, type }) into pipeline shape ({ title, author, kind, confidence })
    const normalizedItems = rawItems.map(item => ({
      title: item.name || item.title,
      author: item.author || item.primaryCreator || null,
      kind: shelf.type,
      confidence: 1.0,
    }));

    const userId = req.user.id;
    const hooks = getVisionPipelineHooks();
    const pipeline = new VisionPipelineService({ hooks });

    const result = await pipeline.processImage(null, shelf, userId, null, {
      rawItems: normalizedItems,
      ocrProvider: 'mlkit',
    });

    const items = await hydrateShelfItems(userId, shelf.id);
    const addedCount = result.addedItems?.length || result.results?.added || 0;
    const needsReviewCount = result.needsReview?.length || result.results?.needsReview || 0;
    const existingCount = result.results?.existing || 0;
    const extractedCount = result.results?.extracted || result.analysis?.items?.length || 0;
    const summaryMessage = buildVisionCompletionMessage({
      addedCount,
      existingCount,
      needsReviewCount,
      extractedCount,
    });

    res.json({
      addedCount,
      needsReviewCount,
      existingCount,
      extractedCount,
      summaryMessage,
      analysis: omitMarketValueSourcesDeep(result.analysis),
      items,
    });

  } catch (err) {
    logger.error("Catalog lookup failed", err);
    res.status(500).json({ error: "Catalog lookup failed" });
  }
}

async function listReviewItems(req, res) {
  try {
    const shelf = await loadShelfForUser(req.user.id, req.params.shelfId);
    if (!shelf) return res.status(404).json({ error: "Shelf not found" });

    const items = await needsReviewQueries.listPending(req.user.id, shelf.id);
    res.json({ items: omitMarketValueSourcesDeep(items) });
  } catch (err) {
    logger.error('listReviewItems error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function completeReviewItem(req, res) {
  try {
    const shelf = await loadShelfForUser(req.user.id, req.params.shelfId);
    if (!shelf) return res.status(404).json({ error: "Shelf not found" });

    const reviewItem = await needsReviewQueries.getById(req.params.id, req.user.id);
    if (!reviewItem) return res.status(404).json({ error: "Review item not found" });

    // Merge user edits with raw data
    // Prioritize user body over rawData
    const completedData = { ...reviewItem.rawData, ...req.body };
    const userFormat = normalizeString(completedData?.format || completedData?.physical?.format);
    const isOtherShelf = String(shelf.type || '').toLowerCase() === 'other';

    if (isOtherShelf) {
      const normalized = normalizeOtherManualItem(completedData, shelf.type);
      if (!hasRequiredOtherFields(normalized)) {
        return res.status(400).json({ error: 'title and primaryCreator are required' });
      }

      const fingerprintData = { ...normalized, kind: shelf.type };
      const lwf = makeLightweightFingerprint(fingerprintData);
      let collectable = await collectablesQueries.findByLightweightFingerprint(lwf);

      if (collectable) {
        const item = await shelvesQueries.addCollectable({
          userId: req.user.id,
          shelfId: shelf.id,
          collectableId: collectable.id,
          format: userFormat || null,
        });
        const ownedPlatforms = await seedDefaultOwnedPlatformForGameItem({
          itemId: item?.id,
          collectable,
        });

        await needsReviewQueries.markCompleted(reviewItem.id, req.user.id);

        await logShelfEvent({
          userId: req.user.id,
          shelfId: shelf.id,
          type: "item.collectable_added",
          payload: buildCollectableAddedEventPayload({
            itemId: item.id,
            collectable,
            shelfType: shelf.type,
            source: 'review',
            reviewItemId: reviewItem.id,
          }),
        });

        return res.json({
          item: {
            id: item.id,
            collectable: omitMarketValueSources(collectable),
            position: item.position,
            notes: item.notes,
            rating: item.rating,
            ownedPlatforms,
          },
        });
      }

      const manualFingerprint = makeManualFingerprint({
        title: normalized.title,
        primaryCreator: normalized.primaryCreator,
        kind: shelf.type,
      }, 'manual-other');

      let manualResult = null;
      let alreadyOnShelf = false;
      let matchedManual = null;
      let manualMatchSource = null;
      let fuzzySimilarity = null;

      if (manualFingerprint) {
        matchedManual = await shelvesQueries.findManualByFingerprint({
          userId: req.user.id,
          shelfId: shelf.id,
          manualFingerprint,
        });
        if (matchedManual) {
          manualMatchSource = 'fingerprint';
        }
      }

      if (!matchedManual) {
        matchedManual = await shelvesQueries.findManualByBarcode({
          userId: req.user.id,
          shelfId: shelf.id,
          barcode: normalized.normalizedBarcode || normalized.barcode,
        });
        if (matchedManual) {
          manualMatchSource = 'barcode';
        }
      }

      if (!matchedManual) {
        const fuzzyCandidate = await shelvesQueries.fuzzyFindManualForOther({
          userId: req.user.id,
          shelfId: shelf.id,
          canonicalTitle: normalized.canonicalTitle || normalized.title,
          canonicalCreator: normalized.canonicalCreator || normalized.primaryCreator,
          minCombinedSim: OTHER_MANUAL_FUZZY_REVIEW_MIN_THRESHOLD,
        });
        const fuzzyDecision = evaluateOtherManualFuzzyCandidate(fuzzyCandidate);
        if (fuzzyDecision.decision === 'fuzzy_auto' || fuzzyDecision.decision === 'fuzzy_review') {
          matchedManual = fuzzyCandidate;
          manualMatchSource = fuzzyDecision.decision;
          fuzzySimilarity = fuzzyDecision;
        }
      }

      if (matchedManual) {
        const existingCollection = await shelvesQueries.findManualCollection({
          userId: req.user.id,
          shelfId: shelf.id,
          manualId: matchedManual.id,
        });

        if (existingCollection) {
          manualResult = { collection: existingCollection, manual: matchedManual };
          alreadyOnShelf = true;
        } else {
          const collection = await shelvesQueries.addManualCollection({
            userId: req.user.id,
            shelfId: shelf.id,
            manualId: matchedManual.id,
          });
          manualResult = { collection, manual: matchedManual };
        }

        logger.info('[shelves.completeReviewItem] Matched other-review item to existing manual', {
          shelfId: shelf.id,
          reviewItemId: reviewItem.id,
          sourceTable: 'user_manuals',
          sourceId: matchedManual.id,
          matchSource: manualMatchSource,
          combinedSim: fuzzySimilarity?.combinedSim ?? null,
          titleSim: fuzzySimilarity?.titleSim ?? null,
          creatorSim: fuzzySimilarity?.creatorSim ?? null,
          alreadyOnShelf,
        });
      }

      if (!manualResult) {
        const payload = buildOtherManualPayload(normalized, shelf.type, manualFingerprint);
        manualResult = await shelvesQueries.addManual({
          userId: req.user.id,
          shelfId: shelf.id,
          ...payload,
          tags: completedData.tags,
        });
        logger.info('[shelves.completeReviewItem] Created new manual from review completion', {
          shelfId: shelf.id,
          reviewItemId: reviewItem.id,
          matchSource: 'new_insert',
          title: normalized.title,
          primaryCreator: normalized.primaryCreator,
        });
      }

      await needsReviewQueries.markCompleted(reviewItem.id, req.user.id);

      if (!alreadyOnShelf) {
        await logShelfEvent({
          userId: req.user.id,
          shelfId: shelf.id,
          type: "item.manual_added",
          payload: buildManualAddedEventPayload({
            itemId: manualResult.collection.id,
            manual: manualResult.manual,
            shelfType: shelf.type,
            source: 'review',
            reviewItemId: reviewItem.id,
          }),
        });
      }

      return res.json({
        item: {
          id: manualResult.collection.id,
          manual: omitMarketValueSources(manualResult.manual),
          position: manualResult.collection.position ?? null,
          format: manualResult.collection.format ?? null,
          notes: manualResult.collection.notes ?? null,
          rating: manualResult.collection.rating ?? null,
        },
      });
    }

    // RE-MATCH: Run fingerprint + fuzzy match to prevent duplicates
    const { format: _format, formats: _formats, ...fingerprintData } = completedData || {};
    fingerprintData.kind = shelf.type;
    const lwf = makeLightweightFingerprint(fingerprintData);
    let collectable = await collectablesQueries.findByLightweightFingerprint(lwf);

    if (!collectable) {
      collectable = await collectablesQueries.fuzzyMatch(
        completedData.title,
        completedData.primaryCreator,
        shelf.type
      );
    }

    if (!collectable) {
      // No match found - create new collectable
      collectable = await collectablesQueries.upsert({
        ...completedData,
        kind: shelf.type,
        fingerprint: makeCollectableFingerprint(fingerprintData),
        lightweightFingerprint: lwf,
      });
    }

    // Add to user's shelf
    const item = await shelvesQueries.addCollectable({
      userId: req.user.id,
      shelfId: shelf.id,
      collectableId: collectable.id,
      format: userFormat || null,
    });
    const ownedPlatforms = await seedDefaultOwnedPlatformForGameItem({
      itemId: item?.id,
      collectable,
    });

    // Mark review item as completed
    await needsReviewQueries.markCompleted(reviewItem.id, req.user.id);

    // Log event
    await logShelfEvent({
      userId: req.user.id,
      shelfId: shelf.id,
      type: "item.collectable_added",
      payload: buildCollectableAddedEventPayload({
        itemId: item.id,
        collectable,
        shelfType: shelf.type,
        source: 'review',
        reviewItemId: reviewItem.id,
      }),
    });

    res.json({
      item: {
        id: item.id,
        collectable: omitMarketValueSources(collectable),
        position: item.position,
        notes: item.notes,
        rating: item.rating,
        ownedPlatforms,
      },
    });
  } catch (err) {
    logger.error('completeReviewItem error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function dismissReviewItem(req, res) {
  try {
    const result = await needsReviewQueries.dismiss(req.params.id, req.user.id);
    if (!result) return res.status(404).json({ error: "Review item not found" });
    res.json({ dismissed: true, id: req.params.id });
  } catch (err) {
    logger.error('dismissReviewItem error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

/**
 * Rate a shelf item (supports half-point ratings 0-5)
 */
async function rateShelfItem(req, res) {
  try {
    const shelfId = parseInt(req.params.shelfId, 10);
    const itemId = parseInt(req.params.itemId, 10);

    if (isNaN(shelfId) || isNaN(itemId)) {
      return res.status(400).json({ error: "Invalid shelf or item id" });
    }

    const shelf = await loadShelfForUser(req.user.id, shelfId);
    if (!shelf) return res.status(404).json({ error: "Shelf not found" });

    const { rating, notes, collectableId, shareToFeed, reviewedEventId } = req.body ?? {};
    const notesValue = notes !== undefined ? normalizeString(notes) : undefined;
    const shareToFeedRequested = (
      shareToFeed === true
      || shareToFeed === 1
      || String(shareToFeed || '').toLowerCase() === 'true'
    );
    logFeedMicro('rateShelfItem.request', {
      userId: req.user.id,
      shelfId,
      itemId,
      ratingProvided: rating !== undefined,
      notesProvided: notes !== undefined,
      notesLength: notesValue ? String(notesValue).length : 0,
      collectableId: collectableId ?? null,
      reviewedEventIdHint: reviewedEventId ?? null,
      shareToFeedRaw: shareToFeed,
      shareToFeedRequested,
    });

    if (rating === undefined && notes === undefined) {
      return res.status(400).json({ error: "rating or notes is required" });
    }

    // Validate rating: must be null or number between 0-5 in 0.5 increments
    if (rating !== null && rating !== undefined) {
      const numRating = parseFloat(rating);
      if (isNaN(numRating) || numRating < 0 || numRating > 5) {
        return res.status(400).json({ error: "Rating must be between 0 and 5" });
      }
      // Check for half-point increments (0, 0.5, 1, 1.5, etc.)
      if ((numRating * 2) % 1 !== 0) {
        return res.status(400).json({ error: "Rating must be in half-point increments (e.g., 3.5, 4.0)" });
      }
    }

    const validRating = rating === undefined
      ? undefined
      : (rating === null ? null : parseFloat(rating));

    const updatePayload = {
      ...(validRating !== undefined ? { rating: validRating } : {}),
      ...(notes !== undefined ? { notes: notesValue } : {}),
    };

    let updated = await shelvesQueries.updateItemRating(itemId, req.user.id, shelfId, updatePayload);
    const fallbackCollectableCandidates = [];
    if (collectableId !== undefined && collectableId !== null && collectableId !== '') {
      const parsedCollectableId = parseInt(collectableId, 10);
      if (!Number.isNaN(parsedCollectableId)) {
        fallbackCollectableCandidates.push(parsedCollectableId);
      }
    }
    if (notes !== undefined && rating === undefined) {
      // Legacy/mobile mismatch path: some clients pass collectable id in :itemId.
      fallbackCollectableCandidates.push(itemId);
    }
    const uniqueFallbackCollectableCandidates = [...new Set(
      fallbackCollectableCandidates.filter((candidate) => Number.isFinite(candidate) && candidate > 0),
    )];

    if (!updated && uniqueFallbackCollectableCandidates.length) {
      for (const fallbackCollectableId of uniqueFallbackCollectableCandidates) {
        const collectionEntry = await shelvesQueries.findCollectionByReference({
          userId: req.user.id,
          shelfId: shelf.id,
          collectableId: fallbackCollectableId,
        });
        logFeedMicro('rateShelfItem.fallback.lookup', {
          userId: req.user.id,
          shelfId,
          itemId,
          fallbackCollectableId,
          foundCollectionItemId: collectionEntry?.id || null,
        });
        if (collectionEntry?.id) {
          updated = await shelvesQueries.updateItemRating(collectionEntry.id, req.user.id, shelfId, updatePayload);
          if (updated) break;
        }
      }
    }
    if (!updated) {
      let collectionItem = null;
      if (typeof shelvesQueries.getCollectionItemByIdForShelf === 'function') {
        try {
          collectionItem = await shelvesQueries.getCollectionItemByIdForShelf(itemId, shelf.id);
        } catch (_diagErr) {
          collectionItem = null;
        }
      }
      logFeedMicro('rateShelfItem.update.failed', {
        userId: req.user.id,
        shelfId,
        itemId,
        fallbackCollectableCandidates: uniqueFallbackCollectableCandidates,
        itemExistsOnShelf: !!collectionItem,
        itemOwnerUserId: collectionItem?.userId || null,
      });
      return res.status(404).json({ error: "Item not found" });
    }
    const previousRating = updated.previousRating === null || updated.previousRating === undefined
      ? null
      : parseFloat(updated.previousRating);
    const currentRating = updated.rating === null || updated.rating === undefined
      ? null
      : parseFloat(updated.rating);
    const ratingChanged = validRating !== undefined && previousRating !== currentRating;
    const effectiveItemId = updated.id || itemId;

    // Get full item details for response and feed event
    const fullItem = await shelvesQueries.getItemById(effectiveItemId, req.user.id, shelfId);
    if (fullItem) {
      fullItem.reviewedEventId = fullItem.reviewedEventLogId ?? null;
      fullItem.reviewPublishedAt = fullItem.reviewedEventPublishedAt || null;
      fullItem.reviewUpdatedAt = fullItem.reviewedEventUpdatedAt || null;
    }

    // Log feed event only when rating actually changed and is set (not cleared)
    // Use null shelfId for global rating aggregation
    if (ratingChanged && currentRating !== null) {
      const ratedLog = await logShelfEvent({
        userId: req.user.id,
        shelfId: null, // Global aggregation for ratings
        type: "item.rated",
        payload: {
          itemId: effectiveItemId,
          collectableId: fullItem?.collectableId || null,
          manualId: fullItem?.manualId || null,
          title: fullItem?.manualName || fullItem?.collectableTitle || 'Unknown',
          primaryCreator: fullItem?.manualAuthor || fullItem?.collectableCreator || null,
          coverUrl: fullItem?.collectableCover || null,
          coverImageUrl: fullItem?.collectableCoverImageUrl || null,
          coverImageSource: fullItem?.collectableCoverImageSource || null,
          coverMediaPath: fullItem?.manualCoverMediaPath || fullItem?.collectableCoverMediaPath || null,
          coverMediaUrl: resolveMediaUrl(fullItem?.manualCoverMediaPath || fullItem?.collectableCoverMediaPath),
          rating: currentRating,
          type: fullItem?.collectableKind || fullItem?.manualType || shelf.type,
        },
      });
      logFeedMicro('rateShelfItem.ratedLogged', {
        userId: req.user.id,
        shelfId,
        eventLogged: !!ratedLog,
        eventId: ratedLog?.id || null,
        effectiveItemId,
      });
    }

    const shouldShareReviewedEvent = shareToFeedRequested && notesValue !== undefined && !!notesValue;
    logFeedMicro('rateShelfItem.reviewedDecision', {
      userId: req.user.id,
      shelfId,
      effectiveItemId,
      shouldShareReviewedEvent,
      shareToFeedRequested,
      notesProvided: notesValue !== undefined,
      hasNotesValue: !!notesValue,
      reviewedEventIdHint: reviewedEventId ?? null,
      storedReviewedEventId: fullItem?.reviewedEventLogId ?? null,
    });
    if (shouldShareReviewedEvent) {
      const resolvedCollectableId = fullItem?.collectableId || uniqueFallbackCollectableCandidates[0] || null;
      const ratingRecord = resolvedCollectableId
        ? await ratingsQueries.getRating(req.user.id, { collectableId: resolvedCollectableId })
        : null;
      const currentUserRating = ratingRecord?.rating ?? null;
      const reviewedLog = await upsertReviewedShelfEvent({
        userId: req.user.id,
        shelfId: shelf.id,
        itemId: effectiveItemId,
        reviewedEventIdHint: reviewedEventId || fullItem?.reviewedEventLogId || null,
        payload: {
          itemId: effectiveItemId,
          sourceShelfId: shelf.id,
          sourceShelfType: shelf.type || null,
          collectableId: resolvedCollectableId,
          title: fullItem?.collectableTitle || 'Unknown',
          primaryCreator: fullItem?.collectableCreator || null,
          coverUrl: fullItem?.collectableCover || null,
          coverImageUrl: fullItem?.collectableCoverImageUrl || null,
          coverImageSource: fullItem?.collectableCoverImageSource || null,
          coverMediaPath: fullItem?.collectableCoverMediaPath || null,
          coverMediaUrl: resolveMediaUrl(fullItem?.collectableCoverMediaPath),
          rating: currentUserRating,
          notes: notesValue,
          type: fullItem?.collectableKind || shelf.type || 'item',
          metadata: {
            formats: Array.isArray(fullItem?.collectableFormats) ? fullItem.collectableFormats : null,
            systemName: fullItem?.collectableSystemName || null,
          },
        },
      });
      if (reviewedLog) {
        fullItem.reviewedEventLogId = reviewedLog.reviewedEventId ?? null;
        fullItem.reviewedEventPublishedAt = reviewedLog.reviewPublishedAt || null;
        fullItem.reviewedEventUpdatedAt = reviewedLog.reviewUpdatedAt || null;
        fullItem.reviewedEventId = reviewedLog.reviewedEventId ?? null;
        fullItem.reviewPublishedAt = reviewedLog.reviewPublishedAt || null;
        fullItem.reviewUpdatedAt = reviewedLog.reviewUpdatedAt || null;
      }
      logFeedMicro('rateShelfItem.reviewedLogged', {
        userId: req.user.id,
        shelfId,
        effectiveItemId,
        eventLogged: !!reviewedLog,
        eventId: reviewedLog?.reviewedEventId || null,
        changed: reviewedLog?.changed ?? null,
        createdNew: reviewedLog?.createdNew ?? null,
        resolvedCollectableId,
      });
    }

    res.json({
      success: true,
      rating: currentRating,
      item: fullItem
    });
  } catch (err) {
    logger.error('rateShelfItem error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}



/**
 * GET /api/manuals/:manualId
 * Get manual item details by ID (public endpoint for viewing from feed)
 */
async function getManualItem(req, res) {
  try {
    const manualId = parseInt(req.params.manualId, 10);
    if (isNaN(manualId)) {
      return res.status(400).json({ error: 'Invalid manual id' });
    }

    const manual = await shelvesQueries.getManualById(manualId);
    if (!manual) {
      return res.status(404).json({ error: 'Manual item not found' });
    }

    const viewerUserId = req.user?.id || null;
    const visibleShelf = await shelvesQueries.getForViewing(manual.shelfId, viewerUserId);
    if (!visibleShelf) {
      return res.status(403).json({ error: 'Viewer does not have access' });
    }

    // Resolve cover media URL
    if (manual.coverMediaPath) {
      manual.coverMediaUrl = resolveMediaUrl(manual.coverMediaPath);
    }

    const privacyContextResult = await query(
      `SELECT uc.user_id::text AS owner_id,
              s.type AS shelf_type,
              uc.owner_photo_source,
              uc.owner_photo_visible,
              u.show_personal_photos
       FROM user_collections uc
       JOIN shelves s ON s.id = uc.shelf_id
       JOIN users u ON u.id = uc.user_id
       WHERE uc.manual_id = $1
       ORDER BY uc.created_at ASC, uc.id ASC
       LIMIT 1`,
      [manualId],
    );
    const privacyContext = privacyContextResult.rows[0] ? rowToCamelCase(privacyContextResult.rows[0]) : null;
    if (privacyContext && shouldRedactOtherManualCover({
      viewerUserId,
      ownerId: privacyContext.ownerId,
      shelfType: privacyContext.shelfType,
      ownerPhotoSource: privacyContext.ownerPhotoSource,
      ownerPhotoVisible: privacyContext.ownerPhotoVisible === true,
      showPersonalPhotos: privacyContext.showPersonalPhotos === true,
    })) {
      redactManualCoverMedia(manual);
    }

    res.json({ manual: omitMarketValueSources(manual) });
  } catch (err) {
    logger.error('getManualItem error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function searchUserCollection(req, res) {
  try {
    const userId = req.user.id;
    const q = req.query.q || '';
    
    // We already use validateStringLengths for `q`, but enforce minimum length here to save DB cost
    if (q.trim().length < 2) {
      return res.json({ results: [] });
    }

    const { limit, skip } = parsePaginationParams(req.query, { defaultLimit: 50, maxLimit: 100 });
    const results = await shelvesQueries.searchUserCollection(userId, q, { limit, offset: skip });

    res.json({ results });
  } catch (err) {
    logger.error('searchUserCollection error:', err);
    res.status(500).json({ error: 'Server error while searching collection' });
  }
}

async function updateOwnedPlatforms(req, res) {
  try {
    const shelfId = parseInt(req.params.shelfId, 10);
    const itemId = parseInt(req.params.itemId, 10);
    if (!Number.isInteger(shelfId) || !Number.isInteger(itemId)) {
      return res.status(400).json({ error: 'Invalid shelf or item id' });
    }

    const shelf = await loadShelfForUser(req.user.id, shelfId);
    if (!shelf) return res.status(404).json({ error: 'Shelf not found' });

    const currentItem = await shelvesQueries.getItemById(itemId, req.user.id, shelf.id);
    if (!currentItem) return res.status(404).json({ error: 'Item not found' });
    if (!currentItem.collectableId) {
      return res.status(400).json({ error: 'Owned platforms can only be set on catalog collectables' });
    }

    const collectableKind = normalizeString(currentItem.collectableKind).toLowerCase();
    if (collectableKind !== 'games' && collectableKind !== 'game') {
      return res.status(400).json({ error: 'Owned platforms are only supported for game collectables' });
    }

    const rawPlatforms = req.body?.platforms;
    if (!Array.isArray(rawPlatforms)) {
      return res.status(400).json({ error: 'platforms must be an array of strings' });
    }
    if (rawPlatforms.length > 25) {
      return res.status(400).json({ error: 'platforms supports up to 25 entries' });
    }
    const platforms = normalizeOwnedPlatforms(rawPlatforms);
    const formatProvided = req.body && Object.prototype.hasOwnProperty.call(req.body, 'format');
    const rawFormat = req.body?.format;
    const normalizedFormat = normalizeOwnedGameFormat(rawFormat);
    if (!formatProvided || !normalizeString(rawFormat)) {
      return res.status(400).json({ error: 'format is required and must be either "physical" or "digital"' });
    }
    if (normalizedFormat === null) {
      return res.status(400).json({ error: 'format must be either "physical" or "digital"' });
    }

    const ownedPlatforms = await shelvesQueries.replaceOwnedPlatformsForCollectionItem({
      collectionItemId: itemId,
      userId: req.user.id,
      shelfId: shelf.id,
      platforms,
    });
    if (ownedPlatforms === null) {
      return res.status(404).json({ error: 'Item not found' });
    }

    let persistedFormat = normalizedFormat;
    if (typeof collectablesQueries.updateFormat === 'function') {
      const updatedCollectable = await collectablesQueries.updateFormat(currentItem.collectableId, normalizedFormat);
      const updatedValue = normalizeOwnedGameFormat(updatedCollectable?.format);
      if (updatedValue) {
        persistedFormat = updatedValue;
      }
    }

    const refreshed = await shelvesQueries.getItemById(itemId, req.user.id, shelf.id);
    const formatted = formatShelfItem(refreshed);
    if (formatted) {
      formatted.ownedPlatforms = normalizeOwnedPlatforms(ownedPlatforms);
      if (formatted.collectable) {
        formatted.collectable.format = persistedFormat;
      }
    }

    return res.json({
      item: formatted || {
        id: itemId,
        ownedPlatforms: normalizeOwnedPlatforms(ownedPlatforms),
        collectable: { format: persistedFormat },
      },
    });
  } catch (err) {
    logger.error('updateOwnedPlatforms error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

module.exports = {
  listShelves,
  createShelf,
  getShelf,
  updateShelf,
  deleteShelf,
  listShelfItems,
  searchManualEntry,
  addManualEntry,
  addCollectable,
  searchCollectablesForShelf,
  removeShelfItem,
  createReplacementIntent,
  replaceShelfItem,
  processShelfVision,
  processCatalogLookup,
  getVisionScanPhoto,
  getVisionScanPhotoImage,
  listVisionScanRegions,
  getVisionScanRegionCrop,
  updateManualEntry,
  uploadManualCover,
  getShelfItemOwnerPhoto,
  getShelfItemOwnerPhotoImage,
  getShelfItemOwnerPhotoThumbnail,
  updateShelfItemOwnerPhotoVisibility,
  uploadShelfItemOwnerPhoto,
  updateShelfItemOwnerPhotoThumbnail,
  deleteShelfItemOwnerPhoto,
  listReviewItems,
  completeReviewItem,
  dismissReviewItem,
  rateShelfItem,
  getVisionStatus,
  setVisionBackground,
  abortVision,
  addCollectableFromApi,
  getManualItem,
  updateOwnedPlatforms,
  searchUserCollection,
};
