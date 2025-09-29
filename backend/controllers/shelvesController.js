const { upsertCollectable } = require("../services/collectables.upsert");
const { makeLightweightFingerprint, makeVisionOcrFingerprint, normalizeFingerprintComponent } = require('../services/collectables/fingerprint');

const Shelf = require("../models/Shelf");

const Collectable = require("../models/Collectable");

const UserManual = require("../models/UserManual");

const UserCollection = require("../models/UserCollection");

const OpenAI = require("openai");

const EventLog = require("../models/EventLog");

const { BookCatalogService } = require("../services/catalog/BookCatalogService");

let openaiClient;

const VISIBILITY_OPTIONS = ["private", "friends", "public"];

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
    match: [
      "game",
      "games",
      "video game",
      "video games",
      "board game",
      "board games",
    ],

    prompt: `You are assisting with cataloging physical collections. The user has indicated that this photo is a game or a collection of games. For video games, place the primary developer or studio in "primaryCreator" and also in "developer", set "format" to "physical", set "systemName" to the exact hardware/platform name, capture the publishing company in "publisher", note the release region in "region" when visible, include direct links in "urlCoverFront" and "urlCoverBack" when discernible, and provide the release year in "year". Always populate the "genre" field when known. For board games, use the lead designer in "author" and the publisher in "publisher". Search authoritative sources when information is missing. Include "coordinates" in the format of "x,y" describing the relative physical location in the photo. Do not include explanations.`,
  },

  {
    match: ["music", "album", "albums", "vinyl", "records", "cd", "cds"],

    prompt: `You are assisting with cataloging physical collections. The user has indicated that this photo is a music collection (vinyl, CDs, tapes, etc.) Use "author" for the primary artist, "format" for the medium or edition, "publisher" for the record label, and "year" for the original release or pressing year. Always populate the "genre" field when known. If any detail is missing, consult trusted music databases before responding. Include "coordinates" in the format of "x,y" describing the relative physical location in the photo. Do not include explanations.`,
  },

  {
    match: [
      "wine",
      "wines",
      "spirits",
      "liquor",
      "whisky",
      "whiskey",
      "bourbon",
      "tequila",
    ],

    prompt: `You are assisting with cataloging physical collections. The user has indicated that this photo is a collection of wine or spirits. Use "author" for the producer, winery, or distillery, "format" for the varietal or bottle/edition details, "publisher" for the region or bottler, and "year" for the vintage or bottling year. Always populate the "genre" field when known. If any metadata is missing, research reputable wine or spirits sources before responding. Include "coordinates" in the format of "x,y" describing the relative physical location in the photo. Do not include explanations.`,
  },
];

function coerceNumber(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;

  const num = Number(value);

  return Number.isFinite(num) ? num : fallback;
}

const DEFAULT_OCR_CONFIDENCE_THRESHOLD = 0.7;

const OCR_CONFIDENCE_THRESHOLD = (() => {
  const raw = parseFloat(
    process.env.OPENAI_VISION_OCR_CONFIDENCE_THRESHOLD ||
      process.env.OPENAI_VISION_CONFIDENCE_THRESHOLD ||
      "",
  );
  if (Number.isFinite(raw)) {
    return Math.max(0, Math.min(1, raw));
  }
  return DEFAULT_OCR_CONFIDENCE_THRESHOLD;
})();

const VISION_FINGERPRINT_SOURCE = "vision-ocr";

const DEFAULT_AI_REVIEW_CONFIDENCE_THRESHOLD = 0.35;

const AI_REVIEW_CONFIDENCE_THRESHOLD = (() => {
  const raw = parseFloat(
    process.env.OPENAI_ENRICH_REVIEW_CONFIDENCE_THRESHOLD ||
      process.env.OPENAI_ENRICH_CONFIDENCE_THRESHOLD ||
      "",
  );
  if (Number.isFinite(raw)) {
    return Math.max(0, Math.min(1, raw));
  }
  return DEFAULT_AI_REVIEW_CONFIDENCE_THRESHOLD;
})();

function extractPositionPayload(body) {
  if (!body) return null;

  const result = {};

  const direct = body.position || {};

  if (direct && (direct.x !== undefined || direct.y !== undefined)) {
    if (direct.x !== undefined) result.x = direct.x;

    if (direct.y !== undefined) result.y = direct.y;
  }

  if (body.positionX !== undefined) result.x = body.positionX;

  if (body.positionY !== undefined) result.y = body.positionY;

  return Object.keys(result).length ? result : null;
}

function normalizeShelfPosition(input, defaults = { x: 0, y: 0 }) {
  const base = { x: defaults?.x ?? 0, y: defaults?.y ?? 0 };

  if (!input) return base;

  if (input.x !== undefined) base.x = coerceNumber(input.x, base.x);

  if (input.y !== undefined) base.y = coerceNumber(input.y, base.y);

  return base;
}

async function logShelfEvent({ userId, shelfId, type, payload }) {
  if (!userId || !shelfId || !type) return;

  try {
    await EventLog.create({
      user: userId,
      shelf: shelfId,
      type,
      payload: payload || {},
    });
  } catch (err) {
    console.warn("Event log failed", err.message || err);
  }
}

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

              genre: {
                anyOf: [
                  { type: "string" },
                  { type: "array", items: { type: "string" } },
                  { type: "null" },
                ],
              },

              tags: {
                anyOf: [
                  { type: "array", items: { type: "string" } },
                  { type: "string" },
                  { type: "null" },
                ],
              },

              description: { type: ["string", "null"] },

              position: { type: ["number", "null"] },

              confidence: { type: "number", minimum: 0, maximum: 1 },

          },
          required: ["title", "type", "primaryCreator", "region", "format", "position", "confidence","publisher", "year", "developer" ,"genre", "tags", "description", "urlCoverFront", "urlCoverBack", "systemName"],
        },
      },
    },
    required: ["shelfConfirmed", "items"],
  },
};

const bookCatalogService = new BookCatalogService();

function getVisionMaxOutputTokens() {
  const envValue = parseInt(
    process.env.OPENAI_VISION_MAX_OUTPUT_TOKENS || "",
    10,
  );

  const fallback = 4096;

  const limit = Number.isFinite(envValue) ? envValue : fallback;

  return Math.max(256, Math.min(limit, 8192));
}

function buildVisionPrompt(shelfType) {
  const normalized = String(shelfType || "")
    .trim()
    .toLowerCase();

  if (!normalized) {
    return `You are assisting with cataloging physical collections. The user has provided a photo of a collection. If any data is missing, research additional sources before responding. Always populate the "genre" field when known. Include "position" describing the relative physical location in the photo with "x" and "y" coordinates. Do not include explanations.`;
  }

  for (const rule of VISION_PROMPT_RULES) {
    if (rule.match.some((needle) => normalized.includes(needle))) {
      return rule.prompt;
    }
  }

  return `You are assisting with cataloging physical collections. The user has indicated that this photo contains ${normalized}. If any metadata is missing, research additional reputable sources before responding. Always populate the "genre" field when known. Include "position" describing the relative physical location in the photo with "x" and "y" coordinates. Do not include explanations.`;
}

function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) return null;

  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  return openaiClient;
}

function normalizeVisionTags(raw) {
  if (!raw && raw !== 0) return [];
  const source = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(/[\s,]+/)
      : [];
  const seen = new Set();
  const tags = [];
  for (const entry of source) {
    const trimmed = String(entry ?? "").trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(trimmed);
  }
  return tags;
}

function normalizeVisionGenres(raw) {
  if (raw === undefined || raw === null || raw === "") return [];
  if (Array.isArray(raw)) return normalizeVisionTags(raw);
  if (typeof raw === "string") {
    const replaced = raw.replace(/[\/|]+/g, ",");
    return normalizeVisionTags(replaced);
  }
  return normalizeVisionTags(raw);
}

function clampUnit(value) {
  if (value === undefined || value === null || value === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.min(1, num));
}

function parseVisionCoordinates(raw) {
  if (raw === undefined || raw === null || raw === "") return null;

  let x = null;
  let y = null;

  if (typeof raw === "string") {
    const parts = raw.split(/[,\s]+/).filter(Boolean);
    if (parts.length >= 2) {
      x = clampUnit(parts[0]);
      y = clampUnit(parts[1]);
    }
  } else if (Array.isArray(raw)) {
    if (raw.length >= 2) {
      x = clampUnit(raw[0]);
      y = clampUnit(raw[1]);
    }
  } else if (typeof raw === "object") {
    const candidateX = raw.x ?? raw[0];
    const candidateY = raw.y ?? raw[1];
    x = clampUnit(candidateX);
    y = clampUnit(candidateY);
  }

  if (x === null || y === null) return null;

  return { x, y };
}

function extractNormalizedPositionFields(item) {
  if (!item || typeof item !== "object") {
    return { label: undefined, coordinates: undefined };
  }

  const normalizeString = (value) => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  };

  let label;

  if (typeof item.position === "string") {
    label = normalizeString(item.position);
  } else if (item.position && typeof item.position === "object") {
    label =
      normalizeString(item.position.label) ||
      normalizeString(item.position.name) ||
      normalizeString(item.position.title) ||
      normalizeString(item.position.value);
  }

  if (!label) {
    label =
      normalizeString(item.location) ||
      normalizeString(item.slot) ||
      normalizeString(item.relativeLocation) ||
      normalizeString(item.positionLabel);
  }

  const coordinateSources = [];

  if (item.position && typeof item.position === "object") {
    coordinateSources.push(
      item.position.coordinates,
      item.position.coords,
      item.position.positionCoordinates,
      item.position.positionCoords
    );

    if (item.position.x !== undefined || item.position.y !== undefined) {
      coordinateSources.push({ x: item.position.x, y: item.position.y });
    }

    coordinateSources.push(item.position);
  }

  coordinateSources.push(
    item.coordinates,
    item.positionCoordinates,
    item.positionCoords,
    item.coords
  );

  let coordinates;
  for (const source of coordinateSources) {
    const parsed = parseVisionCoordinates(source);
    if (parsed) {
      coordinates = parsed;
      break;
    }
  }

  if (!coordinates) {
    const labelSource =
      label ||
      (typeof item.position === "string" ? item.position : undefined) ||
      (typeof item.location === "string" ? item.location : undefined) ||
      (typeof item.slot === "string" ? item.slot : undefined);
    const parsedFromLabel = parseVisionCoordinates(labelSource);
    if (parsedFromLabel) {
      coordinates = parsedFromLabel;
    }
  }

  return {
    label,
    coordinates,
  };
}

function normalizePositionDocument(value) {
  if (!value || typeof value !== "object") return undefined;

  const label =
    typeof value.label === "string" && value.label.trim()
      ? value.label.trim()
      : undefined;

  let coordinates;
  if (value.coordinates && typeof value.coordinates === "object") {
    const cx = clampUnit(value.coordinates.x ?? value.coordinates[0]);
    const cy = clampUnit(value.coordinates.y ?? value.coordinates[1]);
    if (cx !== null && cy !== null) {
      coordinates = { x: cx, y: cy };
    }
  } else if (value.position && typeof value.position === "object") {
    const cx = clampUnit(value.position.x ?? value.position[0]);
    const cy = clampUnit(value.position.y ?? value.position[1]);
    if (cx !== null && cy !== null) {
      coordinates = { x: cx, y: cy };
    }
  } else if (value.x !== undefined || value.y !== undefined) {
    const cx = clampUnit(value.x);
    const cy = clampUnit(value.y);
    if (cx !== null && cy !== null) {
      coordinates = { x: cx, y: cy };
    }
  }

  if (!label && !coordinates) return undefined;

  const normalized = {};
  if (label) normalized.label = label;
  if (coordinates) normalized.coordinates = coordinates;
  return normalized;
}

function positionsEqual(a, b) {
  const normalizedA = normalizePositionDocument(a);
  const normalizedB = normalizePositionDocument(b);

  if (!normalizedA && !normalizedB) return true;
  if (!normalizedA || !normalizedB) return false;

  const labelsEqual = (normalizedA.label || "") === (normalizedB.label || "");
  const coordinatesEqual =
    (!normalizedA.coordinates && !normalizedB.coordinates) ||
    (normalizedA.coordinates &&
      normalizedB.coordinates &&
      normalizedA.coordinates.x === normalizedB.coordinates.x &&
      normalizedA.coordinates.y === normalizedB.coordinates.y);

  return labelsEqual && coordinatesEqual;
}

function parseVisionRating(raw) {
  if (raw === undefined || raw === null || raw === "") return null;

  let candidate = raw;

  if (typeof candidate === "string") {
    const fraction = candidate.match(/([0-9]+(?:\.[0-9]+)?)\s*\/\s*([0-9]+(?:\.[0-9]+)?)/);
    if (fraction) {
      const value = Number.parseFloat(fraction[1]);
      const denom = Number.parseFloat(fraction[2]);
      if (Number.isFinite(value) && Number.isFinite(denom) && denom > 0) {
        const scaled = (value / denom) * 5;
        return Math.max(0, Math.min(5, scaled));
      }
    }

    const numeric = candidate.match(/-?\d+(?:\.\d+)?/);
    if (numeric) {
      candidate = Number.parseFloat(numeric[0]);
    }
  }

  const num = Number(candidate);
  if (!Number.isFinite(num)) return null;

  return Math.max(0, Math.min(5, num));
}

function buildUserCollectionMetadata(item) {
  if (!item) return {};

  const metadata = {};

  const { label: positionLabel, coordinates: positionCoordinates } =
    extractNormalizedPositionFields(item);

  if (positionLabel || positionCoordinates) {
    const position = {};
    if (positionLabel) position.label = positionLabel;
    if (positionCoordinates) {
      position.coordinates = { x: positionCoordinates.x, y: positionCoordinates.y };
    }
    if (Object.keys(position).length) {
      metadata.position = position;
    }
  }

  if (typeof item.format === "string") {
    const trimmedFormat = item.format.trim();
    if (trimmedFormat) {
      metadata.format = trimmedFormat;
    }
  }

  if (typeof item.notes === "string" && item.notes.trim()) {
    metadata.notes = item.notes.trim();
  }

  if (typeof item.rating === "number" && Number.isFinite(item.rating)) {
    metadata.rating = Math.max(0, Math.min(5, item.rating));
  }

  return metadata;
}

function applyUserCollectionMetadata(doc, metadata) {
  if (!doc || !metadata) return false;
  const entries = Object.entries(metadata).filter(([, value]) => value !== undefined);
  if (!entries.length) return false;

  let changed = false;

  for (const [key, value] of entries) {
    if (key === "position") {
      const existingRaw =
        doc.position && typeof doc.position.toObject === "function"
          ? doc.position.toObject()
          : doc.position;
      const nextPosition = normalizePositionDocument(value);
      if (!positionsEqual(existingRaw, nextPosition)) {
        doc.position = nextPosition;
        if (typeof doc.markModified === "function") {
          doc.markModified("position");
        }
        changed = true;
      }
      continue;
    }

    if (key === "format") {
      const normalized =
        typeof value === "string" && value.trim() ? value.trim() : undefined;
      if ((doc.format || undefined) !== normalized) {
        doc.format = normalized;
        if (typeof doc.markModified === "function") {
          doc.markModified("format");
        }
        changed = true;
      }
      continue;
    }

    if (key === "notes") {
      const normalized =
        typeof value === "string" && value.trim() ? value.trim() : undefined;
      if ((doc.notes || undefined) !== normalized) {
        doc.notes = normalized;
        changed = true;
      }
      continue;
    }

    if (key === "rating") {
      const numeric =
        typeof value === "number" && Number.isFinite(value)
          ? Math.max(0, Math.min(5, value))
          : undefined;
      if ((doc.rating ?? undefined) !== numeric) {
        doc.rating = numeric;
        changed = true;
      }
      continue;
    }

    if (doc[key] !== value) {
      doc[key] = value;
      changed = true;
    }
  }

  return changed;
}

function sanitizeVisionItems(items, fallbackType) {
  if (!Array.isArray(items)) return [];

  return items
    .map((item) => {
      const name = String(item.name || item.title || "").trim();
      if (!name) return null;

      const type =
        String(item.type || item.category || fallbackType || "").trim() ||
        fallbackType;
      const normalizedType = String(type || "").toLowerCase();
      const author =
        item.author ||
        item.creator ||
        item.writer ||
        item.director ||
        item.artist ||
        item.developer ||
        item.designer ||
        item.maker;
      const formatCandidate =
        item.format ||
        item.edition ||
        item.media ||
        item.platform ||
        item.binding ||
        item.formatType;
      const publisherRaw =
        item.publisher ||
        item.label ||
        item.studio ||
        item.distributor ||
        item.producer ||
        item.manufacturer ||
        item.winery;
      const developerRaw =
        item.developer ||
        item.studio ||
        item.maker ||
        item.developmentStudio ||
        item.developerName;
      let publisher = publisherRaw;
      let developer = developerRaw;
      if (normalizedType.includes("game")) {
        if (!developer && publisher) developer = publisher;
        if (!publisher && developer) publisher = developer;
      }
      const systemNameRaw =
        item.systemName ||
        item.system ||
        item.console ||
        item.hardware ||
        item.platform ||
        item.machine;
      const region = item.region || item.territory || item.releaseRegion;
      const urlCoverFront =
        item.urlCoverFront ||
        item.coverFront ||
        item.frontCoverUrl ||
        item.frontImage ||
        item.coverFrontUrl;
      const urlCoverBack =
        item.urlCoverBack ||
        item.coverBack ||
        item.backCoverUrl ||
        item.rearImage ||
        item.coverBackUrl;
      const year =
        item.year ||
        item.releaseYear ||
        item.published ||
        item.vintage ||
        item.releaseDate;
      const normalizedTags = normalizeVisionTags(item.tags);
      item.tags = normalizedTags;
      const normalizedGenres = normalizeVisionGenres(
        item.genre ?? item.genres ?? item.categoryLabels ?? null,
      );
      item.genre = normalizedGenres;

      const {
        label: normalizedPositionLabel,
        coordinates: normalizedPositionCoordinates,
      } = extractNormalizedPositionFields(item);

      const rating = parseVisionRating(
        item.rating ??
          item.stars ??
          item.starRating ??
          item.score ??
          item.reviewRating,
      );

      const confidence =
        typeof item.confidence === "number"
          ? Math.max(0, Math.min(1, item.confidence))
          : typeof item.confidenceScore === "number"
            ? Math.max(0, Math.min(1, item.confidenceScore))
            : undefined;

      return {
        name,
        type,
        author: author ? String(author).trim() : undefined,
        format: formatCandidate ? String(formatCandidate).trim() : undefined,
        publisher: publisher ? String(publisher).trim() : undefined,
        developer: developer ? String(developer).trim() : undefined,
        region: region ? String(region).trim() : undefined,
        systemName: systemNameRaw ? String(systemNameRaw).trim() : undefined,
        urlCoverFront: urlCoverFront ? String(urlCoverFront).trim() : undefined,
        urlCoverBack: urlCoverBack ? String(urlCoverBack).trim() : undefined,
        year: year ? String(year).trim() : undefined,
        notes:
          item.notes || item.description || item.summary
            ? String(item.notes || item.description || item.summary).trim()
            : undefined,
        position: normalizedPositionLabel,
        positionCoordinates: normalizedPositionCoordinates,
        tags: normalizedTags,
        genre: normalizedGenres,
        confidence,
        rating,
      };
    })
    .filter(Boolean);
}

function parseVisionPayload(raw) {
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (err) {
    const match = raw.match(/\{[\s\S]*\}/);

    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (e) {
        /* ignore */
      }
    }
  }

  return null;
}

function extractVisionResponsePayload(response) {
  if (!response) return null;

  if (response.output_parsed && typeof response.output_parsed === "object") {
    return response.output_parsed;
  }

  const outputs = Array.isArray(response.output) ? response.output : [];

  const parseTextContent = (text) => {
    if (typeof text !== "string" || !text.trim()) return null;

    return parseVisionPayload(text);
  };

  for (const piece of outputs) {
    if (!piece || piece.type !== "message") continue;

    const parts = Array.isArray(piece.content) ? piece.content : [];

    for (const part of parts) {
      if (part && typeof part.parsed === "object" && part.parsed)
        return part.parsed;

      if (part && typeof part.json === "object" && part.json) return part.json;

      const parsedPart = parseTextContent(part && part.text);

      if (parsedPart) return parsedPart;
    }
  }

  const fromOutputText = parseTextContent(response.output_text);

  if (fromOutputText) return fromOutputText;

  let combinedText = "";

  for (const piece of outputs) {
    if (!piece || piece.type !== "message" || !Array.isArray(piece.content))
      continue;

    for (const part of piece.content) {
      if (part && typeof part.text === "string" && part.text) {
        combinedText += (combinedText ? "\n" : "") + part.text;
      }
    }
  }

  return parseTextContent(combinedText);
}

async function loadShelfForUser(userId, shelfId) {
  return Shelf.findOne({ _id: shelfId, owner: userId });
}

async function hydrateShelfItems(userId, shelfId) {
  const entries = await UserCollection.find({ user: userId, shelf: shelfId })

    .populate("collectable")

    .populate("manual")

    .sort({ createdAt: -1 });

  return entries.map((e) => ({
    id: e._id,
    collectable: e.collectable || null,
    manual: e.manual || null,
    position: e.position || null,
    format: e.format || null,
    notes: e.notes || null,
    rating: e.rating ?? null,
    createdAt: e.createdAt,
  }));
}

async function listShelves(req, res) {
  const shelves = await Shelf.find({ owner: req.user.id }).sort({
    createdAt: -1,
  });

  res.json({ shelves });
}

async function createShelf(req, res) {
  const body = req.body ?? {};

  const { name, type, description } = body;

  if (!name || !type)
    return res.status(400).json({ error: "name and type are required" });

  const visibilityRaw = String(body.visibility ?? "private").toLowerCase();

  const visibility = VISIBILITY_OPTIONS.includes(visibilityRaw)
    ? visibilityRaw
    : "private";

  const position = normalizeShelfPosition(extractPositionPayload(body));

  const shelf = await Shelf.create({
    owner: req.user.id,

    name: String(name).trim(),

    type: String(type).trim(),

    description: description ?? "",

    visibility,

    position,
  });

  await logShelfEvent({
    userId: req.user.id,

    shelfId: shelf._id,

    type: "shelf.created",

    payload: {
      name: shelf.name,
      type: shelf.type,
      visibility: shelf.visibility,
      position: shelf.position,
    },
  });

  res.status(201).json({ shelf });
}

async function getShelf(req, res) {
  const shelf = await loadShelfForUser(req.user.id, req.params.shelfId);

  if (!shelf) return res.status(404).json({ error: "Shelf not found" });

  res.json({ shelf });
}

async function updateShelf(req, res) {
  const body = req.body ?? {};

  const shelf = await loadShelfForUser(req.user.id, req.params.shelfId);

  if (!shelf) return res.status(404).json({ error: "Shelf not found" });

  const updates = {};

  if (body.name != null) updates.name = String(body.name).trim();

  if (body.type != null) updates.type = String(body.type).trim();

  if (body.description != null) updates.description = body.description;

  if (body.visibility != null) {
    const vis = String(body.visibility).toLowerCase();

    if (!VISIBILITY_OPTIONS.includes(vis)) {
      return res
        .status(400)
        .json({ error: "invalid visibility", allowed: VISIBILITY_OPTIONS });
    }

    updates.visibility = vis;
  }

  const positionInput = extractPositionPayload(body);

  if (positionInput) {
    const currentPosition = normalizeShelfPosition(shelf.position);

    updates.position = normalizeShelfPosition(positionInput, currentPosition);
  }

  if (!Object.keys(updates).length) {
    return res.json({ shelf });
  }

  const changed = {};

  for (const [key, value] of Object.entries(updates)) {
    if (key === "position") {
      const before = normalizeShelfPosition(shelf.position);

      if (before.x !== value.x || before.y !== value.y) {
        changed[key] = { before, after: value };

        shelf.position = value;
      }

      continue;
    }

    if (shelf[key] !== value) {
      changed[key] = { before: shelf[key], after: value };

      shelf[key] = value;
    }
  }

  if (!Object.keys(changed).length) {
    return res.json({ shelf });
  }

  await shelf.save();

  await logShelfEvent({
    userId: req.user.id,

    shelfId: shelf._id,

    type: "shelf.updated",

    payload: changed,
  });

  res.json({ shelf });
}

async function listShelfItems(req, res) {
  const shelf = await loadShelfForUser(req.user.id, req.params.shelfId);

  if (!shelf) return res.status(404).json({ error: "Shelf not found" });

  const items = await hydrateShelfItems(req.user.id, shelf._id);

  res.json({ items });
}

async function addManualEntry(req, res) {
  const shelf = await loadShelfForUser(req.user.id, req.params.shelfId);

  if (!shelf) return res.status(404).json({ error: "Shelf not found" });

  const body = req.body ?? {};

  const { name, type, description } = body;

  if (!name) return res.status(400).json({ error: "name is required" });

  const manual = await UserManual.create({
    user: req.user.id,
    shelf: shelf._id,
    name: String(name).trim(),
    type,
    description,
  });

  const joinMetadata = buildUserCollectionMetadata({
    position:
      typeof body.position === "string"
        ? body.position
        : body.position && typeof body.position === "object"
          ? body.position.label ?? undefined
          : undefined,
    positionCoordinates:
      body.position && typeof body.position === "object"
        ? body.position.coordinates ?? body.position
        : undefined,
    format: typeof body.format === "string" ? body.format : undefined,
    notes: typeof body.notes === "string" ? body.notes : undefined,
    rating:
      typeof body.rating === "number"
        ? body.rating
        : parseVisionRating(body.rating),
  });

  const joinPayload = {
    user: req.user.id,
    shelf: shelf._id,
    manual: manual._id,
    ...joinMetadata,
  };

  const join = await UserCollection.create(joinPayload);

  await logShelfEvent({
    userId: req.user.id,

    shelfId: shelf._id,

    type: "item.manual_added",

    payload: {
      itemId: join._id,
      manualId: manual._id,
      name: manual.name,
      type: manual.type,
      source: "manual",
    },
  });

  res.status(201).json({
    item: {
      id: join._id,
      manual,
      position: join.position || null,
      format: join.format || null,
      notes: join.notes || null,
      rating: join.rating ?? null,
    },
  });
}

async function addCollectable(req, res) {
  const shelf = await loadShelfForUser(req.user.id, req.params.shelfId);

  if (!shelf) return res.status(404).json({ error: "Shelf not found" });

  const body = req.body ?? {};

  const { collectableId } = body;

  if (!collectableId)
    return res.status(400).json({ error: "collectableId is required" });

  const collectable = await Collectable.findById(collectableId);

  if (!collectable)
    return res.status(404).json({ error: "Collectable not found" });

  const existing = await UserCollection.findOne({
    user: req.user.id,
    shelf: shelf._id,
    collectable: collectable._id,
  });

  const joinMetadata = buildUserCollectionMetadata({
    position:
      typeof body.position === "string"
        ? body.position
        : body.position && typeof body.position === "object"
          ? body.position.label ?? undefined
          : undefined,
    positionCoordinates:
      body.position && typeof body.position === "object"
        ? body.position.coordinates ?? body.position
        : undefined,
    format: typeof body.format === "string" ? body.format : undefined,
    notes: typeof body.notes === "string" ? body.notes : undefined,
    rating:
      typeof body.rating === "number"
        ? body.rating
        : parseVisionRating(body.rating),
  });

  if (existing) {
    if (applyUserCollectionMetadata(existing, joinMetadata)) {
      await existing.save();
    }
    return res.status(200).json({
      item: {
        id: existing._id,
        collectable,
        position: existing.position || null,
        format: existing.format || null,
        notes: existing.notes || null,
        rating: existing.rating ?? null,
      },
    });
  }

  const joinPayload = {
    user: req.user.id,
    shelf: shelf._id,
    collectable: collectable._id,
    ...joinMetadata,
  };

  const join = await UserCollection.create(joinPayload);

  const displayTitle = collectable.title || collectable.name || "";
  const displayCreator =
    collectable.primaryCreator || collectable.author || "";

  await logShelfEvent({
    userId: req.user.id,

    shelfId: shelf._id,

    type: "item.collectable_added",

    payload: {
      itemId: join._id,
      collectableId: collectable._id,
      title: displayTitle,
      name: displayTitle,
      primaryCreator: displayCreator,
      author: displayCreator,
      coverUrl: collectable.coverUrl || "",
      openLibraryId: collectable.openLibraryId || "",
      publisher: collectable.publisher || "",
      year: collectable.year || "",
      description: collectable.description || "",
      type: collectable.type,
      source: "user",
    },
  });

  res.status(201).json({
    item: {
      id: join._id,
      collectable,
      position: join.position || null,
      format: join.format || null,
      notes: join.notes || null,
      rating: join.rating ?? null,
    },
  });
}

async function removeShelfItem(req, res) {
  const shelf = await loadShelfForUser(req.user.id, req.params.shelfId);

  if (!shelf) return res.status(404).json({ error: "Shelf not found" });

  const item = await UserCollection.findOne({
    _id: req.params.itemId,
    user: req.user.id,
    shelf: shelf._id,
  });

  if (!item) return res.status(404).json({ error: "Item not found" });

  let manualDoc = null;

  let collectableDoc = null;

  if (item.manual) manualDoc = await UserManual.findById(item.manual);

  if (item.collectable)
    collectableDoc = await Collectable.findById(item.collectable);

  if (item.manual) {
    try {
      await UserManual.deleteOne({ _id: item.manual });
    } catch (err) {
      console.warn("Failed to delete manual entry", err);
    }
  }

  await item.deleteOne();

  await logShelfEvent({
    userId: req.user.id,

    shelfId: shelf._id,

    type: "item.removed",

    payload: {
      itemId: req.params.itemId,

      manual: manualDoc
        ? { id: manualDoc._id, name: manualDoc.name, type: manualDoc.type }
        : null,

      collectable: collectableDoc
        ? {
            id: collectableDoc._id,
            name: collectableDoc.name,
            type: collectableDoc.type,
          }
        : null,
    },
  });

  const items = await hydrateShelfItems(req.user.id, shelf._id);

  res.json({ removedId: req.params.itemId, items });
}

async function searchCollectablesForShelf(req, res) {
  const shelf = await loadShelfForUser(req.user.id, req.params.shelfId);

  if (!shelf) return res.status(404).json({ error: "Shelf not found" });

  const q = String(req.query.q || "").trim();

  const limit = Math.min(parseInt(req.query.limit || "10", 10), 50);

  const filter = { type: shelf.type };

  if (q) {
    filter.name = {
      $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      $options: "i",
    };
  }

  const results = await Collectable.find(filter).limit(limit);

  res.json({ results });
}

function escapeRegex(value) {
  return String(value || "")
    .replace(/[\^$.*+?()[\]{}|]/g, "\$&");
}

async function matchExistingCollectables(items, userId, shelf) {
  const results = [];
  const remaining = [];

  if (!Array.isArray(items) || !items.length) return { results, remaining };

  for (let index = 0; index < items.length; index++) {
    const item = items[index] || {};
    const title = String(item.name || item.title || "").trim();
    const author = String(item.author || "").trim();

    if (!title) {
      console.log("[shelfVision.fingerprint] skip", { index, reason: "missing-title" });
      remaining.push(item);
      continue;
    }

    const lightweightFp = makeLightweightFingerprint(title, author);
    const fuzzyFp = makeVisionOcrFingerprint(title, author);
    const authorRegex = author ? new RegExp(`^${escapeRegex(author)}$`, "i") : null;

    let collectable = null;
    let matchSource = null;

    try {
      if (fuzzyFp && author) {
        const fuzzyQuery = {
          "fuzzyFingerprints.value": fuzzyFp,
        };
        if (authorRegex) {
          fuzzyQuery.$or = [
            { primaryCreator: authorRegex },
            { author: authorRegex },
          ];
        }
        collectable = await Collectable.findOne(fuzzyQuery);
        if (collectable) {
          matchSource = "fuzzy";
        }
      }

      if (!collectable && lightweightFp) {
        collectable = await Collectable.findOne({ lightweightFingerprint: lightweightFp });
        if (collectable) {
          matchSource = "lightweight";
        }
      }

      if (!collectable) {
        const titleRegex = new RegExp(`^${escapeRegex(title)}$`, "i");
        const fallbackQuery = authorRegex
          ? {
              title: titleRegex,
              $or: [
                { primaryCreator: authorRegex },
                { author: authorRegex },
              ],
            }
          : { title: titleRegex };

        collectable = await Collectable.findOne(fallbackQuery);

        if (collectable) {
          matchSource = matchSource || "fallback";

          if (!collectable.lightweightFingerprint) {
            const calcTitle = collectable.title || collectable.name || title;
            const calcCreator =
              collectable.primaryCreator || collectable.author || author;
            const computed = makeLightweightFingerprint(calcTitle, calcCreator);
            if (computed) {
              collectable.lightweightFingerprint = computed;
              try {
                await collectable.save();
                console.log("[shelfVision.fingerprint] backfilled", {
                  index,
                  collectableId: String(collectable._id || ""),
                  lightweightFingerprint: computed,
                });
              } catch (saveErr) {
                console.error("[shelfVision.fingerprint] backfill failed", {
                  index,
                  collectableId: String(collectable._id || ""),
                  error: saveErr?.message || saveErr,
                });
              }
            }
          }
        }
      }

      if (!collectable) {
        console.log("[shelfVision.fingerprint] no-match", { index, title, author });
        remaining.push(item);
        continue;
      }

      const matchedLwf = collectable.lightweightFingerprint || lightweightFp;
      if (!collectable.lightweightFingerprint && matchedLwf) {
        try {
          await Collectable.updateOne(
            { _id: collectable._id },
            { $set: { lightweightFingerprint: matchedLwf } },
          );
          console.log("[shelfVision.fingerprint] persisted", {
            index,
            collectableId: String(collectable._id || ""),
            lightweightFingerprint: matchedLwf,
          });
        } catch (persistErr) {
          console.error("[shelfVision.fingerprint] persist failed", {
            index,
            collectableId: String(collectable._id || ""),
            error: persistErr?.message || persistErr,
          });
        }
      }

      console.log("[shelfVision.fingerprint] match", {
        index,
        title,
        author,
        collectableId: String(collectable._id || ""),
        via: matchSource || "fingerprint",
      });

      const alreadyLinked = await UserCollection.findOne({
        user: userId,
        shelf: shelf._id,
        collectable: collectable._id,
      });

      const joinMetadata = buildUserCollectionMetadata(item);

      if (!alreadyLinked) {
        const joinPayload = {
          user: userId,
          shelf: shelf._id,
          collectable: collectable._id,
          ...joinMetadata,
        };

        const join = await UserCollection.create(joinPayload);

        const displayTitle = collectable.title || collectable.name || title;
        const displayCreator =
          collectable.primaryCreator || collectable.author || author;

        await logShelfEvent({
          userId,
          shelfId: shelf._id,
          type: "item.collectable_added",
          payload: {
            itemId: join._id,
            collectableId: collectable._id,
            title: displayTitle,
            name: displayTitle,
            primaryCreator: displayCreator,
            author: displayCreator,
            coverUrl: collectable.coverUrl || "",
            openLibraryId: collectable.openLibraryId || "",
            publisher: collectable.publisher || "",
            year: collectable.year || "",
            description: collectable.description || "",
            type: collectable.type,
            source: matchSource || "fingerprint",
          },
        });

        results.push({
          status: "linked",
          collectable,
          source: matchSource || "fingerprint",
          itemId: String(join._id || ""),
        });
      } else {
        if (applyUserCollectionMetadata(alreadyLinked, joinMetadata)) {
          await alreadyLinked.save();
        }
        results.push({
          status: "existing",
          collectable,
          source: matchSource || "fingerprint",
          itemId: String(alreadyLinked._id || ""),
        });
      }
    } catch (err) {
      console.error("[shelfVision.fingerprint] lookup failed", {
        index,
        title,
        author,
        error: err?.message || err,
      });
      remaining.push(item);
    }
  }

  return { results, remaining };
}

async function processShelfVision(req, res) {
  console.log("vision req", req.user, req.params.shelfId);

  const shelf = await loadShelfForUser(req.user.id, req.params.shelfId);
  if (!shelf) return res.status(404).json({ error: "Shelf not found" });

  const {
    imageBase64,
    autoApply = true,
    metadata = {},
    prompt,
  } = req.body ?? {};

  if (!imageBase64)
    return res.status(400).json({ error: "imageBase64 is required" });

  const client = getOpenAIClient();
  if (!client)
    return res.status(503).json({ error: "Vision AI is not configured" });

  // --- Clean image payload ---
  const rawImagePayload = String(imageBase64);
  const explicitMatch = rawImagePayload.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/i);
  let mimeType = explicitMatch ? explicitMatch[1] : null;
  let cleanedSource;

  if (explicitMatch) {
    cleanedSource = rawImagePayload.slice(explicitMatch[0].length);
  } else if (rawImagePayload.startsWith("data:image;base64,")) {
    cleanedSource = rawImagePayload.slice("data:image;base64,".length);
    mimeType = mimeType || "image/jpeg";
  } else {
    cleanedSource = rawImagePayload;
  }

  const cleaned = cleanedSource.replace(/\s+/g, "");
  if (!cleaned) return res.status(400).json({ error: "Invalid base64 payload" });
  if (!/^[A-Za-z0-9+/]+=*$/.test(cleaned))
    return res.status(400).json({ error: "Invalid base64 payload" });
  if (cleaned.length > 8 * 1024 * 1024)
    return res.status(400).json({ error: "Image too large; limit to 8MB base64 payload" });

  const imageDataUrl = `data:${mimeType || "image/jpeg"};base64,${cleaned}`;
  const normalizedShelfType = String(shelf.type || "").trim().toLowerCase();
  const visionShelfType = normalizedShelfType === "game" ? "video game" : shelf.type;
  const systemPrompt = prompt || buildVisionPrompt(visionShelfType);

  try {
    // --- Step 1: Run Vision ---
    const maxOutputTokens = getVisionMaxOutputTokens();
    const baseRequest = {
      model: process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini",
      text: { format: structuredVisionFormat },
      max_output_tokens: maxOutputTokens,
      input: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `This photo shows the shelf named "${shelf.name}" of type "${shelf.type}". Identify the items on the shelf with metadata.`
            },
            { type: "input_image", image_url: imageDataUrl },
          ],
        },
      ],
    };

    let response = await client.responses.create(baseRequest);
    const parsed = extractVisionResponsePayload(response) || {};
    const normalizedItems = sanitizeVisionItems(parsed.items || [], shelf.type);

    const fingerprintMatches = await matchExistingCollectables(normalizedItems, req.user.id, shelf);
    const itemsForLookup = fingerprintMatches.remaining;

    console.log("[shelfVision.fingerprint] summary", {
      matched: fingerprintMatches.results.length,
      remaining: itemsForLookup.length,
    });

    // --- Step 2: Type-specific lookup + enrichment ---
    const catalogService = bookCatalogService.supportsShelfType(shelf.type)
      ? bookCatalogService
      : null;

    let resolved = [];
    let unresolved = itemsForLookup.map((input) => ({
      status: "unresolved",
      input,
    }));

    if (catalogService) {
      const firstPass = await catalogService.lookupFirstPass(itemsForLookup, {
        concurrency: 5,
      });
      resolved = firstPass.filter((r) => r.status === "resolved");
      unresolved = firstPass.filter((r) => r.status === "unresolved");
    }

    // --- Step 3: Only unresolved go to OpenAI ---
    let enrichedFromAI = [];
    const shouldRunSecondPass = catalogService
      ? catalogService.shouldRunSecondPass(shelf.type, unresolved.length)
      : false;

    if (catalogService) {
      console.log("[shelfVision.secondPass] gate", {
        rawEnv: process.env.ENABLE_SHELF_VISION_SECOND_PASS,
        enabledEnv: catalogService.enableSecondPass,
        shelfType: shelf.type,
        unresolvedCount: unresolved.length,
        shouldRunSecondPass,
      });
    } else {
      console.log("[shelfVision.secondPass] skipped (no catalog service)", {
        shelfType: shelf.type,
        unresolvedCount: unresolved.length,
      });
    }

    if (shouldRunSecondPass && catalogService) {
      enrichedFromAI = await catalogService.enrichWithOpenAI(unresolved, client);
      console.log("[shelfVision.secondPass] executed", { count: enrichedFromAI.length });
    } else if (catalogService) {
      console.log("[shelfVision.secondPass] skipped");
    }

    // --- Step 4: Merge all enrichment results ---
    const passthrough = shouldRunSecondPass ? enrichedFromAI : unresolved;
    const enriched = [...resolved, ...passthrough];
    const results = [...fingerprintMatches.results];

    // --- Step 5: Apply results ---
    if (autoApply) {
      for (const entry of enriched) {
        const item = entry.input;
        if (entry.status === "resolved" && entry.enrichment) {
          const lwf = makeLightweightFingerprint(item.name || item.title, item.author || "");
          let collectablePayload = catalogService
            ? catalogService.buildCollectablePayload(entry, item, lwf)
            : null;

          if (collectablePayload && lwf && !collectablePayload.lightweightFingerprint) {
            collectablePayload.lightweightFingerprint = lwf;
          }

          if (!collectablePayload) {
            console.warn("[shelfVision.upsert] missing collectable payload", { item });
            results.push({ status: "unresolved", input: item });
            continue;
          }

          const collectable = await upsertCollectable(Collectable, collectablePayload);
          if (!collectable) {
            console.warn("[shelfVision.upsert] upsert returned null", { title: collectablePayload.title });
            results.push({ status: "unresolved", input: item });
            continue;
          }

          const isAiCollectable = Boolean(entry.enrichment?.__collectable);
          let confidenceScore = null;
          if (isAiCollectable) {
            const rawConfidence = entry.enrichment?.collectable?.sources?.[0]?.raw?.confidence;
            if (typeof rawConfidence === "number") {
              confidenceScore = rawConfidence;
            } else if (typeof rawConfidence === "string" && rawConfidence.trim()) {
              const parsed = Number.parseFloat(rawConfidence);
              if (Number.isFinite(parsed)) confidenceScore = parsed;
            }
            if (Number.isFinite(confidenceScore)) {
              confidenceScore = Math.max(0, Math.min(1, confidenceScore));
            } else {
              confidenceScore = null;
            }
          }

          const needsReview =
            isAiCollectable && (confidenceScore === null || confidenceScore < AI_REVIEW_CONFIDENCE_THRESHOLD);

          if (isAiCollectable && confidenceScore !== null && confidenceScore >= OCR_CONFIDENCE_THRESHOLD) {
            const rawTitle = String(item.name || item.title || "").trim();
            const rawAuthor = String(item.author || "").trim();
            const normalizedItemAuthor = normalizeFingerprintComponent(rawAuthor);
            const normalizedCollectableAuthor = normalizeFingerprintComponent(
              collectable.primaryCreator ||
                collectable.author ||
                (Array.isArray(collectable.creators) ? collectable.creators[0] : ""),
            );
            const fuzzyValue = makeVisionOcrFingerprint(rawTitle, rawAuthor);
            const authorMatches =
              normalizedItemAuthor &&
              normalizedCollectableAuthor &&
              normalizedItemAuthor === normalizedCollectableAuthor;

            if (fuzzyValue && authorMatches) {
              const fingerprints = Array.isArray(collectable.fuzzyFingerprints)
                ? collectable.fuzzyFingerprints
                : [];
              const alreadyStored = fingerprints.some((fp) => fp && fp.value === fuzzyValue);

              if (!alreadyStored) {
                const fingerprintDoc = {
                  value: fuzzyValue,
                  source: VISION_FINGERPRINT_SOURCE,
                  rawTitle,
                  rawCreator: rawAuthor,
                  mediaType:
                    collectable.type ||
                    (item.type ? String(item.type).trim() : shelf.type || null),
                  confidence: confidenceScore,
                  createdAt: new Date(),
                };
                try {
                  const updateResult = await Collectable.updateOne(
                    {
                      _id: collectable._id,
                      'fuzzyFingerprints.value': { $ne: fuzzyValue },
                    },
                    { $push: { fuzzyFingerprints: fingerprintDoc } },
                  );

                  if (updateResult?.modifiedCount || updateResult?.nModified) {
                    collectable.fuzzyFingerprints = fingerprints.concat([fingerprintDoc]);
                    console.log("[shelfVision.ocrFingerprint] recorded", {
                      collectableId: String(collectable._id || ""),
                      fingerprint: fuzzyValue,
                      confidence: confidenceScore,
                    });
                  } else {
                    console.log("[shelfVision.ocrFingerprint] skipped (exists)", {
                      collectableId: String(collectable._id || ""),
                      fingerprint: fuzzyValue,
                    });
                  }
                } catch (fpErr) {
                  console.error("[shelfVision.ocrFingerprint] save failed", {
                    collectableId: String(collectable._id || ""),
                    error: fpErr?.message || fpErr,
                  });
                }
              }
            }
          }

          const resultSource = isAiCollectable ? "openai" : "catalog";

          const existing = await UserCollection.findOne({
            user: req.user.id,
            shelf: shelf._id,
            collectable: collectable._id,
          });

          const joinMetadata = buildUserCollectionMetadata(item);

          if (!existing) {
            const joinPayload = {
              user: req.user.id,
              shelf: shelf._id,
              collectable: collectable._id,
              ...joinMetadata,
            };
            const join = await UserCollection.create(joinPayload);
            const joinId = String(join._id);

            const displayTitle = collectable.title || collectable.name || "";
            const displayCreator =
              collectable.primaryCreator || collectable.author || "";

            await logShelfEvent({
              userId: req.user.id,
              shelfId: shelf._id,
              type: "item.collectable_added",
              payload: {
                itemId: join._id,
                collectableId: collectable._id,
                title: displayTitle,
                name: displayTitle,
                primaryCreator: displayCreator,
                author: displayCreator,
                coverUrl: collectable.coverUrl || "",
                openLibraryId: collectable.openLibraryId || "",
                publisher: collectable.publisher || "",
                year: collectable.year || "",
                description: collectable.description || "",
                type: collectable.type,
                source: resultSource,
                confidence: confidenceScore,
                needsReview,
              },
            });

            results.push({
              status: "linked",
              collectable,
              source: resultSource,
              needsReview,
              confidence: confidenceScore,
              itemId: joinId,
            });
          } else {
            results.push({
              status: "existing",
              collectable,
              source: resultSource,
              needsReview,
              confidence: confidenceScore,
              itemId: String(existing._id || ""),
            });
            if (applyUserCollectionMetadata(existing, joinMetadata)) {
              await existing.save();
            }
          }
        } else {
          // ❌ Nothing found → manual entry
          const manualPayload = {
            user: req.user.id,
            shelf: shelf._id,
            name: item.title || item.name,
            type: item.type || shelf.type || "manual",
            description: item.description || "",
            author: item.author || "",
            publisher: item.publisher || "",
            format: item.format || "",
            year: item.year || "",
            tags: item.tags || [],
          };
          const manual = await UserManual.create(manualPayload);
          const joinMetadata = buildUserCollectionMetadata(item);
          const joinPayload = {
            user: req.user.id,
            shelf: shelf._id,
            manual: manual._id,
            ...joinMetadata,
          };
          const join = await UserCollection.create(joinPayload);
          await logShelfEvent({
            userId: req.user.id,
            shelfId: shelf._id,
            type: "item.manual_added",
            payload: {
              itemId: join._id,
              manualId: manual._id,
              name: manual.name,
              type: manual.type,
              source: "vision",
              needsReview: true,
            },
          });
          results.push({
            status: "manual_added",
            itemId: String(join._id),
            manual,
            needsReview: true,
          });
        }
      }
    }

    const items = await hydrateShelfItems(req.user.id, shelf._id);

    res.json({
      analysis: { ...parsed, items: normalizedItems },
      visionStatus: { status: response?.status || null },
      results,
      items,
      metadata,
    });
  } catch (err) {
    console.error("Vision analysis failed", err);
    res.status(502).json({ error: "Vision analysis failed" });
  }
}


async function updateManualEntry(req, res) {
  const { shelfId, itemId } = req.params;
  const body = req.body ?? {};

  const shelf = await loadShelfForUser(req.user.id, shelfId);
  if (!shelf) return res.status(404).json({ error: "Shelf not found" });

  const entry = await UserCollection.findOne({
    _id: itemId,
    user: req.user.id,
    shelf: shelf._id,
  }).populate("manual");

  if (!entry || !entry.manual) {
    return res.status(404).json({ error: "Manual item not found" });
  }

  const manual = entry.manual;

  if (body.name !== undefined) manual.name = String(body.name).trim();
  if (body.type !== undefined) manual.type = String(body.type).trim();
  if (body.description !== undefined) manual.description = String(body.description).trim();
  if (body.author !== undefined) manual.author = String(body.author).trim();
  if (body.publisher !== undefined) manual.publisher = String(body.publisher).trim();
  if (body.format !== undefined) manual.format = String(body.format).trim();
  if (body.year !== undefined) manual.year = String(body.year).trim();

  await manual.save();

  res.json({ item: { id: entry._id, manual } });
}


module.exports = {
  listShelves,

  createShelf,

  getShelf,

  updateShelf,

  listShelfItems,

  addManualEntry,

  addCollectable,

  searchCollectablesForShelf,

  removeShelfItem,

  processShelfVision,

  updateManualEntry,
};

