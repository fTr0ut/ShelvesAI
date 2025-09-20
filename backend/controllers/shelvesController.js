const Shelf = require("../models/Shelf");

const Collectable = require("../models/Collectable");

const UserManual = require("../models/UserManual");

const UserCollection = require("../models/UserCollection");

const OpenAI = require("openai");

const EventLog = require("../models/EventLog");

const { lookupWorkMetadata } = require("../services/openLibrary");

let openaiClient;

const VISIBILITY_OPTIONS = ["private", "friends", "public"];

const VISION_PROMPT_RULES = [
  {
    match: ["book", "books", "novel", "novels", "comic", "manga"],

    prompt: `You are assisting with cataloging physical collections. The user has indicated that this photo is a single book or a collection of books. Provide the canonical title, the primary author, the physical format (e.g., hardcover, paperback, omnibus). Include "coordinates" in the format of "x,y" describing the relative physical location in the photo. Zoom into the photo if needed. Do not include explanations.`,
  },

  {
    match: ["movie", "movies", "film", "films", "blu-ray", "dvd", "4k"],

    prompt: `You are assisting with cataloging physical collections. The user has indicated that this photo is a movie or a collection of movies. Report the primary director in the "author" field, use "format" for the medium (Blu-ray, DVD, 4K, digital, etc.), use "publisher" for the studio or distributor, and provide the original release year. If any metadata is missing, research reliable film databases before responding. Include "position" describing the relative physical location in the photo (e.g., "top shelf, far left"). Do not include explanations.`,
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

    prompt: `You are assisting with cataloging physical collections. The user has indicated that this photo is a game or a collection of games. For video games, place the primary developer or studio in "author", the platform or edition in "format", the publishing company in "publisher", and the release year in "year". For board games, use the lead designer in "author" and the publisher in "publisher". Search authoritative sources when information is missing. Include "position" describing the relative physical location in the photo (e.g., "top shelf, far left"). Do not include explanations.`,
  },

  {
    match: ["music", "album", "albums", "vinyl", "records", "cd", "cds"],

    prompt: `You are assisting with cataloging physical collections. The user has indicated that this photo is a music collection (vinyl, CDs, tapes, etc.) Use "author" for the primary artist, "format" for the medium or edition, "publisher" for the record label, and "year" for the original release or pressing year. If any detail is missing, consult trusted music databases before responding. Include "position" describing the relative physical location in the photo (e.g., "top shelf, far left"). Do not include explanations.`,
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

    prompt: `You are assisting with cataloging physical collections. The user has indicated that this photo is a collection of wine or spirits. Use "author" for the producer, winery, or distillery, "format" for the varietal or bottle/edition details, "publisher" for the region or bottler, and "year" for the vintage or bottling year. If any metadata is missing, research reputable wine or spirits sources before responding. Include "position" describing the relative physical location in the photo (e.g., "top shelf, far left"). Do not include explanations.`,
  },
];

const BOOK_TYPE_HINTS = new Set(
  VISION_PROMPT_RULES[0].match.map((hint) => hint.toLowerCase()),
);

function isLikelyBookType(value) {
  const normalized = String(value || "").toLowerCase();

  for (const hint of BOOK_TYPE_HINTS) {
    if (normalized.includes(hint)) return true;
  }

  return false;
}

function coerceNumber(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;

  const num = Number(value);

  return Number.isFinite(num) ? num : fallback;
}

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
            name: { type: "string" },

            type: { type: "string" },

            author: { type: ["string", "null"] },

            format: { type: ["string", "null"] },

            //publisher: { type: ["string","null"] },

            //year: { type: ["string","null"] },

            // notes: { type: ["string","null"] },

            position: { type: ["string", "null"] },

            confidence: { type: "number", minimum: 0, maximum: 1 },
          },

          //required: ["name","type","author","format","publisher","year","notes","position","confidence"]

          required: [
            "name",
            "type",
            "author",
            "format",
            "position",
            "confidence",
          ],
        },
      },
    },

    required: ["shelfConfirmed", "items"],
  },
};

function getVisionMaxOutputTokens() {
  const envValue = parseInt(
    process.env.OPENAI_VISION_MAX_OUTPUT_TOKENS || "",
    10,
  );

  const fallback = 4096;

  const limit = Number.isFinite(envValue) ? envValue : fallback;

  return Math.max(256, Math.min(limit, 8192));
}

function getRetryVisionOutputTokens(currentTokens) {
  const envValue = parseInt(
    process.env.OPENAI_VISION_MAX_OUTPUT_TOKENS_RETRY || "",
    10,
  );

  if (Number.isFinite(envValue) && envValue > currentTokens) {
    return Math.max(currentTokens + 1, Math.min(envValue, 8192));
  }

  const doubled = currentTokens * 2;

  if (doubled > currentTokens) {
    return Math.min(Math.max(256, doubled), 8192);
  }

  return currentTokens;
}

function buildVisionPrompt(shelfType) {
  const normalized = String(shelfType || "")
    .trim()
    .toLowerCase();

  if (!normalized) {
    return `You are assisting with cataloguing physical collections. The user has provided a photo of a collection. If any data is missing, research additional sources before responding. Include "position" describing the relative physical location in the photo (e.g., "top shelf, far left"). Do not include explanations.`;
  }

  for (const rule of VISION_PROMPT_RULES) {
    if (rule.match.some((needle) => normalized.includes(needle))) {
      return rule.prompt;
    }
  }

  return `You are assisting with cataloguing physical collections. The user has indicated that this photo contains ${normalized}. If any metadata is missing, research additional reputable sources before responding. Include "position" describing the relative physical location in the photo (e.g., "top shelf, far left"). Do not include explanations.`;
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

function sanitizeVisionItems(items, fallbackType) {
  if (!Array.isArray(items)) return [];

  return items
    .map((item) => {
      const name = String(item.name || item.title || "").trim();
      if (!name) return null;

      const type =
        String(item.type || item.category || fallbackType || "").trim() ||
        fallbackType;
      const author =
        item.author ||
        item.creator ||
        item.writer ||
        item.director ||
        item.artist ||
        item.developer ||
        item.designer ||
        item.maker;
      const format =
        item.format ||
        item.edition ||
        item.media ||
        item.platform ||
        item.binding ||
        item.formatType;
      const publisher =
        item.publisher ||
        item.label ||
        item.studio ||
        item.distributor ||
        item.producer ||
        item.manufacturer ||
        item.winery;
      const year =
        item.year ||
        item.releaseYear ||
        item.published ||
        item.vintage ||
        item.releaseDate;
      const normalizedTags = normalizeVisionTags(item.tags);
      item.tags = normalizedTags;

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
        format: format ? String(format).trim() : undefined,
        publisher: publisher ? String(publisher).trim() : undefined,
        year: year ? String(year).trim() : undefined,
        notes:
          item.notes || item.description || item.summary
            ? String(item.notes || item.description || item.summary).trim()
            : undefined,
        position:
          item.position ||
          item.location ||
          item.slot ||
          item.relativeLocation ||
          undefined,
        tags: normalizedTags,
        confidence,
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

async function ensureCollectableFromVision(item, fallbackType) {
  const type = item.type || fallbackType || "unsorted";
  const positionValue = (() => {
    if (item.position === undefined || item.position === null) return undefined;
    const stringified = String(item.position).trim();
    return stringified ? stringified : undefined;
  })();
  const normalizedTags = normalizeVisionTags(item.tags);

  const name = item.name;

  let collectable = await Collectable.findOne({ name, type });

  const shouldEnrichBooks =
    isLikelyBookType(type) || (fallbackType && isLikelyBookType(fallbackType));

  const collectableMissingCore =
    !collectable ||
    !collectable.author ||
    !collectable.publisher ||
    !collectable.year ||
    !collectable.description;

  const itemMissingCore =
    !item.author || !item.publisher || !item.year || !item.notes;

  if (shouldEnrichBooks && (collectableMissingCore || itemMissingCore)) {
    try {
      const enrichment = await lookupWorkMetadata({
        title: name,

        author: item.author || (collectable ? collectable.author : "") || "",
      });

      if (enrichment) {
        if (!item.author && enrichment.authors.length)
          item.author = enrichment.authors[0];

        if (!item.publisher && enrichment.publishers.length)
          item.publisher = enrichment.publishers[0];

        if (!item.year && enrichment.publishYear)
          item.year = enrichment.publishYear;

        if (!item.notes) {
          const noteParts = [];

          if (enrichment.subtitle) noteParts.push(enrichment.subtitle);

          if (enrichment.subjects.length) {
            noteParts.push(
              `Subjects: ${enrichment.subjects.slice(0, 5).join(", ")}`,
            );
          }

          if (enrichment.isbn) noteParts.push(`ISBN: ${enrichment.isbn}`);

          const combinedNotes = noteParts.filter(Boolean).join(" - ");

          if (combinedNotes) item.notes = combinedNotes;
        }
      }
    } catch (err) {
      console.warn("OpenLibrary enrichment failed", err.message);
    }
  }

  if (!collectable) {
    collectable = await Collectable.create({
      name,
      type,
      description: item.notes,
      author: item.author,
      format: item.format,
      publisher: item.publisher,
      year: item.year,
      position: positionValue,
      tags: normalizedTags,
    });

    return collectable;
  }

  const updates = {};

  if ((!collectable.author || collectable.author === name) && item.author)
    updates.author = item.author;

  if (!collectable.format && item.format) updates.format = item.format;

  if (!collectable.publisher && item.publisher)
    updates.publisher = item.publisher;

  if (!collectable.year && item.year) updates.year = item.year;

  if (!collectable.description && item.notes) updates.description = item.notes;

  if (positionValue && positionValue !== collectable.position) {
    updates.position = positionValue;
  }

  if (normalizedTags.length) {
    const existingTags = Array.isArray(collectable.tags)
      ? collectable.tags.map((tag) => String(tag || "").trim()).filter(Boolean)
      : [];
    const normalizedExisting = existingTags.map((tag) => tag.toLowerCase());
    const normalizedIncoming = normalizedTags.map((tag) => tag.toLowerCase());
    if (
      normalizedIncoming.length !== normalizedExisting.length ||
      normalizedIncoming.some((tag, idx) => tag !== normalizedExisting[idx])
    ) {
      updates.tags = normalizedTags;
    }
  }

  if (Object.keys(updates).length) {
    collectable.set(updates);

    await collectable.save();
  }

  return collectable;
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
    createdAt: e.createdAt,
  }));
}

// List shelves for current user

async function listShelves(req, res) {
  const shelves = await Shelf.find({ owner: req.user.id }).sort({
    createdAt: -1,
  });

  res.json({ shelves });
}

// Create a new shelf

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

//}

// Get a shelf (ensure ownership)

async function getShelf(req, res) {
  const shelf = await loadShelfForUser(req.user.id, req.params.shelfId);

  if (!shelf) return res.status(404).json({ error: "Shelf not found" });

  res.json({ shelf });
}

// Update shelf (owner only)

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

// List items in a shelf for the current user (both collectables and manual)

async function listShelfItems(req, res) {
  const shelf = await loadShelfForUser(req.user.id, req.params.shelfId);

  if (!shelf) return res.status(404).json({ error: "Shelf not found" });

  const items = await hydrateShelfItems(req.user.id, shelf._id);

  res.json({ items });
}

// Add a manual entry to a shelf (and link into user collection)

async function addManualEntry(req, res) {
  const shelf = await loadShelfForUser(req.user.id, req.params.shelfId);

  if (!shelf) return res.status(404).json({ error: "Shelf not found" });

  const { name, type, description } = req.body ?? {};

  if (!name) return res.status(400).json({ error: "name is required" });

  const manual = await UserManual.create({
    user: req.user.id,
    shelf: shelf._id,
    name: String(name).trim(),
    type,
    description,
  });

  const join = await UserCollection.create({
    user: req.user.id,
    shelf: shelf._id,
    manual: manual._id,
  });

  await logShelfEvent({
    userId: req.user.id,

    shelfId: shelf._id,

    type: "item.manual_added",

    payload: {
      itemId: join._id,
      manualId: manual._id,
      name: manual.name,
      type: manual.type,
    },
  });

  res.status(201).json({ item: { id: join._id, manual } });
}

// Add a catalog collectable to shelf (by id)

async function addCollectable(req, res) {
  const shelf = await loadShelfForUser(req.user.id, req.params.shelfId);

  if (!shelf) return res.status(404).json({ error: "Shelf not found" });

  const { collectableId } = req.body ?? {};

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

  if (existing)
    return res.status(200).json({ item: { id: existing._id, collectable } });

  const join = await UserCollection.create({
    user: req.user.id,
    shelf: shelf._id,
    collectable: collectable._id,
  });

  await logShelfEvent({
    userId: req.user.id,

    shelfId: shelf._id,

    type: "item.collectable_added",

    payload: {
      itemId: join._id,
      collectableId: collectable._id,
      name: collectable.name,
      type: collectable.type,
    },
  });

  res.status(201).json({ item: { id: join._id, collectable } });
}

// Search the catalog for a shelf

// Remove an item (collectable or manual) from a shelf

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

// Analyze a shelf photo with OpenAI Vision

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

  const rawImagePayload = String(imageBase64);

  const explicitMatch = rawImagePayload.match(
    /^data:(image\/[a-zA-Z0-9.+-]+);base64,/i,
  );

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

  if (!cleaned)
    return res.status(400).json({ error: "Invalid base64 payload" });

  if (!/^[A-Za-z0-9+/]+=*$/.test(cleaned))
    return res.status(400).json({ error: "Invalid base64 payload" });

  if (cleaned.length > 8 * 1024 * 1024)
    return res
      .status(400)
      .json({ error: "Image too large; limit to 8MB base64 payload" });

  const imageDataUrl = `data:${mimeType || "image/jpeg"};base64,${cleaned}`;

  const systemPrompt = prompt || buildVisionPrompt(shelf.type);

  try {
    const maxOutputTokens = getVisionMaxOutputTokens();

    const baseRequest = {
      model: process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini",

      // tools: [{

      //   type: 'web_search',

      // }],

      // tool_choice: "auto",

      text: { format: structuredVisionFormat },

      //reasoning: { effort: 'high' },

      max_output_tokens: maxOutputTokens,

      input: [
        { role: "system", content: systemPrompt },

        {
          role: "user",

          content: [
            {
              type: "input_text",
              text: `This photo shows the shelf named "${shelf.name}" of type "${shelf.type}". Identify the items on the shelf with metadata.`,
            },

            { type: "input_image", image_url: imageDataUrl },
          ],
        },
      ],
    };

    let response = await client.responses.create(baseRequest);

    let usedOutputTokens = maxOutputTokens;

    let retriedMaxTokens = false;

    let hitTokenLimit =
      response?.status === "incomplete" &&
      response?.incomplete_details?.reason === "max_output_tokens";

    if (hitTokenLimit) {
      const retryLimit = getRetryVisionOutputTokens(usedOutputTokens);

      if (retryLimit > usedOutputTokens) {
        retriedMaxTokens = true;

        console.warn(
          "Vision response hit max_output_tokens, retrying with higher limit",
          {
            shelfId: shelf._id,

            previousLimit: usedOutputTokens,

            retryLimit,
          },
        );

        response = await client.responses.create({
          ...baseRequest,
          max_output_tokens: retryLimit,
        });

        usedOutputTokens = retryLimit;

        hitTokenLimit =
          response?.status === "incomplete" &&
          response?.incomplete_details?.reason === "max_output_tokens";
      }
    }

    if (hitTokenLimit) {
      console.warn("Vision response truncated at max_output_tokens", {
        shelfId: shelf._id,

        maxOutputTokens: usedOutputTokens,
      });
    }

    console.log("OpenAI Vision response", JSON.stringify(response, null, 2));

    const parsed = extractVisionResponsePayload(response) || {};

    const responseStatus = {
      status: response?.status || null,

      incompleteReason:
        response?.status === "incomplete"
          ? response?.incomplete_details?.reason || null
          : null,

      maxOutputTokens: usedOutputTokens,

      retried: retriedMaxTokens,
    };

    const normalizedItems = sanitizeVisionItems(parsed.items || [], shelf.type);

    const applied = [];

    if (autoApply) {
      for (const item of normalizedItems) {
        try {
          const collectable = await ensureCollectableFromVision(
            item,
            shelf.type,
          );

          const existing = await UserCollection.findOne({
            user: req.user.id,
            shelf: shelf._id,
            collectable: collectable._id,
          });

          if (!existing) {
            const join = await UserCollection.create({
              user: req.user.id,
              shelf: shelf._id,
              collectable: collectable._id,
            });

            applied.push({
              collectableId: collectable._id,
              name: collectable.name,
            });

            await logShelfEvent({
              userId: req.user.id,

              shelfId: shelf._id,

              type: "item.collectable_added",

              payload: {
                itemId: join._id,
                collectableId: collectable._id,
                name: collectable.name,
                type: collectable.type,
                source: "vision",
              },
            });
          }
        } catch (err) {
          console.warn("Vision auto-apply error", err);
        }
      }
    }

    const items = await hydrateShelfItems(req.user.id, shelf._id);

    res.json({
      analysis: { ...parsed, items: normalizedItems },

      visionStatus: responseStatus,

      addedCount: applied.length,

      applied,

      items,

      metadata,
    });
  } catch (err) {
    console.error("Vision analysis failed", err);

    res.status(502).json({ error: "Vision analysis failed" });
  }
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
};
