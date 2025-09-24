const { openLibraryToCollectable } = require("../adapters/openlibrary.adapter");
const { upsertCollectable } = require("../services/collectables.upsert");
const crypto = require("crypto");

const Shelf = require("../models/Shelf");

const Collectable = require("../models/Collectable");

const UserManual = require("../models/UserManual");

const UserCollection = require("../models/UserCollection");

const OpenAI = require("openai");

const EventLog = require("../models/EventLog");

const { lookupWorkBookMetadata } = require("../services/openLibrary");

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

function makeLightweightFingerprint(title, creator) {
  const base = `${(title || "").trim().toLowerCase()}|${(creator || "").trim().toLowerCase()}`;
  return crypto.createHash("sha1").update(base).digest("hex");
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
            title: { type: "string" },

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
            "title",
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

// async function ensureCollectableFromVision(item, fallbackType) {
//   const type = item.type || fallbackType || "unsorted";
//   const positionValue = (() => {
//     if (item.position === undefined || item.position === null) return undefined;
//     const stringified = String(item.position).trim();
//     return stringified ? stringified : undefined;
//   })();
//   const normalizedTags = normalizeVisionTags(item.tags);

//   const name = item.name;

//   let collectable = await Collectable.findOne({ name, type });

//   const shouldEnrichBooks =
//     isLikelyBookType(type) || (fallbackType && isLikelyBookType(fallbackType));

//   const collectableMissingCore =
//     !collectable ||
//     !collectable.author ||
//     !collectable.publisher ||
//     !collectable.year ||
//     !collectable.description;

//   const itemMissingCore =
//     !item.author || !item.publisher || !item.year || !item.notes;

//   if (shouldEnrichBooks && (collectableMissingCore || itemMissingCore)) {
//     try {
//       const enrichment = await lookupWorkMetadata({
//         title: name,

//         author: item.author || (collectable ? collectable.author : "") || "",
//       });

//       if (enrichment) {
//         if (!item.author && enrichment.authors.length)
//           item.author = enrichment.authors[0];

//         if (!item.publisher && enrichment.publishers.length)
//           item.publisher = enrichment.publishers[0];

//         if (!item.year && enrichment.publishYear)
//           item.year = enrichment.publishYear;

//         if (!item.notes) {
//           const noteParts = [];

//           if (enrichment.subtitle) noteParts.push(enrichment.subtitle);

//           if (enrichment.subjects.length) {
//             noteParts.push(
//               `Subjects: ${enrichment.subjects.slice(0, 5).join(", ")}`,
//             );
//           }

//           if (enrichment.isbn) noteParts.push(`ISBN: ${enrichment.isbn}`);

//           const combinedNotes = noteParts.filter(Boolean).join(" - ");

//           if (combinedNotes) item.notes = combinedNotes;
//         }
//       }
//     } catch (err) {
//       console.warn("OpenLibrary enrichment failed", err.message);
//     }
//   }

//   if (!collectable) {
//     collectable = await Collectable.create({
//       name,
//       type,
//       description: item.notes,
//       author: item.author,
//       format: item.format,
//       publisher: item.publisher,
//       year: item.year,
//       position: positionValue,
//       tags: normalizedTags,
//     });

//     return collectable;
//   }

//   const updates = {};

//   if ((!collectable.author || collectable.author === name) && item.author)
//     updates.author = item.author;

//   if (!collectable.format && item.format) updates.format = item.format;

//   if (!collectable.publisher && item.publisher)
//     updates.publisher = item.publisher;

//   if (!collectable.year && item.year) updates.year = item.year;

//   if (!collectable.description && item.notes) updates.description = item.notes;

//   if (positionValue && positionValue !== collectable.position) {
//     updates.position = positionValue;
//   }

//   if (normalizedTags.length) {
//     const existingTags = Array.isArray(collectable.tags)
//       ? collectable.tags.map((tag) => String(tag || "").trim()).filter(Boolean)
//       : [];
//     const normalizedExisting = existingTags.map((tag) => tag.toLowerCase());
//     const normalizedIncoming = normalizedTags.map((tag) => tag.toLowerCase());
//     if (
//       normalizedIncoming.length !== normalizedExisting.length ||
//       normalizedIncoming.some((tag, idx) => tag !== normalizedExisting[idx])
//     ) {
//       updates.tags = normalizedTags;
//     }
//   }

//   if (Object.keys(updates).length) {
//     collectable.set(updates);

//     await collectable.save();
//   }

//   return collectable;
// }
const delay = ms => new Promise(r => setTimeout(r, ms));

async function safeLookup(item, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      console
      return await lookupWorkBookMetadata({
        title: item.name || item.title,
        author: item.author || ""
      });
    } catch (err) {
      if (String(err.message).includes("429") && attempt < retries) {
        const backoff = 500 * Math.pow(2, attempt);
        console.warn(`429 from OpenLibrary, retrying in ${backoff}ms`);
        await delay(backoff);
        continue;
      }
      if (String(err.message).includes("aborted") && attempt < retries) {
        const backoff = 1000 * (attempt + 1);
        console.warn(`Timeout/abort, retrying in ${backoff}ms`);
        await delay(backoff);
        continue;
      }
      throw err;
    }
  }
  return null;
}

async function batchLookupFirstPass(items, concurrency = 5) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      const input = items[i];
      try {
        const value = await safeLookup(input);
        if (value) {
          results[i] = { status: "resolved", input, enrichment: value };
        } else {
          results[i] = { status: "unresolved", input };
        }
      } catch (err) {
        console.error("OpenLibrary lookup failed", err.message);
        results[i] = { status: "unresolved", input };
      }
    }
  }

  // run limited concurrency
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

// async function batchEnrichWithOpenAI(unresolved) {
//   if (!unresolved.length) return [];
//   const openai = getOpenAIClient();
//   if (!openai) return unresolved.map(u => ({ status: "unresolved", input: u.input }));

//   const payload = unresolved.map(u => ({ title: u.input.name || u.input.title, author: u.input.author || "" }));

//   const aiResponse = await openai.responses.create({
//     model: "gpt-4.1-mini",
//     tools: [{ type: "web_search" }],
//     tool_choice: "auto",
//     text: { format: structuredVisionFormat },

//     input: [
//       { role: "system", content: "You are cleaning up noisy OCR text from book covers so they can match OpenLibrary records." },
//       { role: "user", content: `OCR extracted list:\n${JSON.stringify(payload, null, 2)}\n\n Search the web for similarly spelled or similarly sounding titles or authors. Dig deeper if no initial results found. No comments.` }
//     ]
//   });

//   let corrections = [];
//   try {
//     corrections = JSON.parse(aiResponse.output_text);
//   } catch (err) {
//     console.error("Failed to parse OpenAI output", err);
//     return unresolved;
//   }

//   // second pass: lookup corrected titles in OpenLibrary
//   const requeue = await Promise.allSettled(
//     corrections.map(c => lookupWorkBookMetadata({ title: c.title, author: c.author }))
//   );

//   return requeue.map((res, idx) => {
//     const orig = unresolved[idx].input;
//     if (res.status === "fulfilled" && res.value) {
//       return { status: "resolved", input: orig, enrichment: res.value };
//     } else {
//       return { status: "unresolved", input: orig };
//     }
//   });
// }
// Replace your current batchEnrichWithOpenAI with this:
async function batchEnrichWithOpenAI(unresolved = []) {
  // unresolved comes from firstPass: [{ status:"unresolved", input:{ name, author, ... } }, ...]
  if (!Array.isArray(unresolved) || unresolved.length === 0) return [];

  const openai = getOpenAIClient();
  if (!openai) return unresolved.map(u => ({ status: "unresolved", input: u.input }));

  // Build a compact payload: [{ title, author }]
  // - take only what's needed
  // - dedupe by "title|author"
  // - keep the batch modest to avoid hitting token limits
  const raw = unresolved
    .map(u => ({
      title: (u?.input?.name || u?.input?.title || "").trim(),
      author: (u?.input?.author || "").trim()
    }))
    .filter(it => it.title);

  const seen = new Set();
  const payload = [];
  for (const it of raw) {
    const key = `${it.title.toLowerCase()}|${(it.author || "").toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    payload.push(it);
  }

  // Hard cap the batch if needed (tune if you expect larger batches)
  const LIMITED_BATCH_SIZE = parseInt(process.env.OPENAI_ENRICH_BATCH_MAX || "30", 10);
  const trimmed = payload.slice(0, LIMITED_BATCH_SIZE);

  // Nothing to do?
  if (trimmed.length === 0) {
    return unresolved.map(u => ({ status: "unresolved", input: u.input }));
  }

  // Call OpenAI with strict JSON array schema
  const resp = await openai.responses.create({
    model: process.env.OPENAI_TEXT_MODEL || "gpt-5-mini",
    tools: [{ type: "web_search" }],
    tool_choice: "auto",
    text: {
      format: {
        name: "BookCorrections",
        type: "json_schema",
        strict: true,
        schema: {
            type: "object",
            additionalProperties: false,

            properties: {
              items: {  
                type: "array",
               items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    title:  { type: "string" },
                    author: { type: ["string", "null"] }
                },
                required: ["title", "author"]
              },
              
           }                     
        },
        required: ["items"] 
      }
    }
  },
    input: [
      { role: "system", content: "Return ONLY a JSON array matching the schema: [{ title, author }]. No prose." },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Clean and correct these OCR book entries. (fix spelling/sound-alikes; web-search reliable sources for correct data). Output ONLY the corrected JSON array (no wrapper objects, no extra fields).

${JSON.stringify(trimmed, null, 2)}`
          }
        ]
      }
    ]
  });

  // Prefer parsed output if the SDK provides it; otherwise parse text safely
  let corrections = [];
  if (Array.isArray(resp?.output_parsed)) {
    corrections = resp.output_parsed;
  } else {
    const text = safeGetOutputText(resp);
    corrections = coerceCorrectionsArray(text); // your helper returns [] when it can’t parse
  }

  if (!Array.isArray(corrections) || corrections.length === 0) {
    // Couldn’t parse or got an empty array—leave them unresolved
    return unresolved.map(u => ({ status: "unresolved", input: u.input }));
  }

  // Re-query OpenLibrary with throttling + retries, like first pass
  // Use the same safeLookup to avoid 429s/timeouts
  const results = [];
  for (let i = 0; i < corrections.length; i++) {
    results[i] = null;
  }

  const concurrency = 5;
  let idx = 0;

  async function worker() {
    while (idx < corrections.length) {
      const i = idx++;
      const corr = corrections[i];
      try {
        const ol = await safeLookup({ title: corr.title, author: corr.author || "" });
        if (ol) {
          // Map back to the *original* unresolved entry by index where possible:
          // If counts mismatch (model dropped/added items), fall back to pairing by title.
          const orig = unresolved[i]?.input || unresolved.find(u => 
            (u.input?.name || u.input?.title || "").trim().toLowerCase() === corr.title.trim().toLowerCase()
          )?.input || { title: corr.title, author: corr.author || "" };

          results[i] = { status: "resolved", input: orig, enrichment: ol };
        } else {
          const orig = unresolved[i]?.input || { title: corr.title, author: corr.author || "" };
          results[i] = { status: "unresolved", input: orig };
        }
      } catch (err) {
        const orig = unresolved[i]?.input || { title: corr.title, author: corr.author || "" };
        console.error("OpenLibrary requeue failed", err?.message || err);
        results[i] = { status: "unresolved", input: orig };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, corrections.length) }, worker));

  // Filter out any nulls (shouldn’t happen, but be safe)
  return results.filter(Boolean);
}


async function batchLookupOpenLibrary(corrections) {
  if (!Array.isArray(corrections) || !corrections.length) return [];
  
  // Run them in parallel but respect rate limits
  const results = await Promise.allSettled(
    corrections.map(c => lookupWorkBookMetadata({ title: c.title, author: c.author }))
  );

  return results.map((res, idx) => {
    if (res.status === "fulfilled" && res.value) {
      return { ok: true, input: corrections[idx], enrichment: res.value };
    } else {
      return { ok: false, input: corrections[idx], error: res.reason?.message || "OpenLibrary failed" };
    }
  });
}

async function batchCorrectOCR(items) {
  const openai = getOpenAIClient();
  if (!openai) return [];

  const payload = items.map(it => ({ title: it.name || it.title, author: it.author || "" }));
  
  const aiResponse = await openai.responses.create({
    model: "gpt-4.1-mini",
    tools: [{ type: "web_search" }],
    input: [
      {
        role: "system",
        content: "You are cleaning up noisy OCR text from book covers so they can match OpenLibrary records."
      },
      {
        role: "user",
        content: `OCR extracted list:\n${JSON.stringify(payload, null, 2)}\n\nReturn corrected array as JSON [{title, author}]. No comments.`
      }
    ]
  });

  try {
    const corrections = JSON.parse(aiResponse.output_text);
    return Array.isArray(corrections) ? corrections : [];
  } catch (err) {
    console.error("Failed to parse OpenAI corrections", err);
    return [];
  }
}

async function ensureCollectableFromVision(item, shelfType) {
  const name = item.name;

  if (shelfType === "books" || isLikelyBookType(shelfType)) {
   // 0) Compute lightweightFingerprint from OCR fields
   const lwf = makeLightweightFingerprint(name, item.author || "");

   // 1) Check if Collectable already exists by lightweightFingerprint
   const existing = await Collectable.findOne({ lightweightFingerprint: lwf });
      if (existing) {
        // Link it to this shelf if not already linked
        const alreadyLinked = await UserCollection.findOne({
          user: req.user.id,
          shelf: shelf._id,
          collectable: existing._id,
        });
        if (!alreadyLinked) {
          await UserCollection.create({
            user: req.user.id,
            shelf: shelf._id,
            collectable: existing._id,
          });
        }
        return { status: "linked", collectable: existing };
      }


    // 2) Try Open Library first
    let enrichment = await safeLookup({ name, author: item.author || "" });

    // 3) Retry via OpenAI spelling/alias correction if needed (your existing logic)
    if (!enrichment) {
      try {
        const openai = getOpenAIClient();
        if (openai) {
          const aiResponse = await openai.responses.create({
            model: "gpt-4.1-mini",
            tools: [{ type: "web_search" }],
            input: [
              { role: "system", content: "You are cleaning up noisy OCR text from book covers so they can match OpenLibrary records." },
              { role: "user", content: `OCR extracted: "${name}" by "${item.author || ""}". Use a web search to find a similarly spelled or similarly "sounding" corrected book title and author as JSON {title, author}. No comments, no explanations.` }
            ]
          });

          let suggestion = null;
          try { suggestion = JSON.parse(aiResponse.output_text); } catch {}
          if (suggestion?.title) {
            enrichment = await safeLookup({ name: suggestion.title, author: suggestion.author || "" });
          }
        }
      } catch (err) {
        console.error("OpenAI retry failed:", err.message);
      }
    }

    // 4) If still nothing, bubble up for manual
    if (!enrichment) {
      return {
        status: "edit_required",
        item: {
          id: item._id || item.id || null,
          name,
          type: item.type || shelfType || "manual",
          author: item.author || "",
          format: item.format || "",
          publisher: item.publisher || "",
          year: item.year || "",
          position: item.position || "",
          tags: item.tags || [],
          description: item.notes || "",
          reason: "No OpenLibrary match",
        },
      };
    }

    // 5) We have an OL work → map to generic Collectable and upsert

    const incoming = openLibraryToCollectable({
                  ...enrichment,
                  position: item.position || null,  // 👈 forward position from vision
                  lightweightFingerprint: lwf,          // 👈 store lightweightFingerprint
                });
    const saved = await upsertCollectable(Collectable, incoming);

    return { status: "created", collectable: saved };
  }
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

function safeGetOutputText(resp) {
  // Works for both legacy and current @openai SDK shapes
  try {
    if (typeof resp?.output_text === "string") return resp.output_text;
    const maybeText = resp?.output?.[0]?.content?.[0]?.text;
    if (typeof maybeText === "string") return maybeText;
  } catch {}
  return "";
}

function coerceCorrectionsArray(jsonLike) {
  // Accept: stringified JSON, array, or object wrappers
  let parsed = jsonLike;
  if (typeof jsonLike === "string") {
    const trimmed = jsonLike.trim();
    // attempt to extract a JSON block if the model added prose
    const start = trimmed.indexOf("[") !== -1 ? trimmed.indexOf("[") : trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("]") !== -1 ? trimmed.lastIndexOf("]") + 1 : trimmed.lastIndexOf("}") + 1;
    try {
      parsed = JSON.parse(start >= 0 && end > start ? trimmed.slice(start, end) : trimmed);
    } catch {
      return []; // could not parse
    }
  }

  // If already an array of items
  if (Array.isArray(parsed)) return parsed;

  // Common wrapper: { corrections: [...] }
  if (parsed && Array.isArray(parsed.corrections)) return parsed.corrections;

  // Single object case: {title, author}
  if (parsed && (parsed.title || parsed.author)) return [parsed];

  return [];
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
  const systemPrompt = prompt || buildVisionPrompt(shelf.type);

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

    // --- Step 2: Throttled + retrying OpenLibrary lookups ---
    const firstPass = await batchLookupFirstPass(normalizedItems, 5); // concurrency=5
    const resolved = firstPass.filter(r => r.status === "resolved");
    const unresolved = firstPass.filter(r => r.status === "unresolved");

    // --- Step 3: Only unresolved go to OpenAI ---
    let enrichedFromAI = [];
    if ((shelf.type === "books" || isLikelyBookType(shelf.type)) && unresolved.length) {
      enrichedFromAI = await batchEnrichWithOpenAI(unresolved);
    }

    // --- Step 4: Merge all enrichment results ---
    const enriched = [...resolved, ...enrichedFromAI];
    const results = [];

    // --- Step 5: Apply results ---
    if (autoApply) {
      for (const entry of enriched) {
        const item = entry.input;
        if (entry.status === "resolved" && entry.enrichment) {
          // ✅ Good OpenLibrary result
          const enrichment = entry.enrichment;

          // Map + upsert using the new model
          const lwf = makeLightweightFingerprint(item.name || item.title, item.author || "");
         const incoming = openLibraryToCollectable({
                      ...enrichment,
                      position: item.position || null,  // 👈 forward position from vision
                      lightweightFingerprint: lwf, // 👈 store lightweightFingerprint
                    });
          const collectable = await upsertCollectable(Collectable, incoming);

          // Add to this shelf if not already present
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

            await logShelfEvent({
              userId: req.user.id,
              shelfId: shelf._id,
              type: "item.collectable_added",
              payload: {
                itemId: join._id,
                collectableId: collectable._id,
                name: collectable.name,
                author: collectable.author || "",
                // keep your legacy fields in the event payload for FE compatibility
                coverUrl: collectable.coverUrl || "",
                openLibraryId: collectable.openLibraryId || "",
                publisher: collectable.publisher || "",
                year: collectable.year || "",
                description: collectable.description || "",
                type: collectable.type,
                source: "vision",
              },
            });

            results.push({ status: "linked", collectable });
          } else {
            results.push({ status: "existing", collectable });
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
            position: item.position || "",
            tags: item.tags || [],
          };
          const manual = await UserManual.create(manualPayload);
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
              source: "vision",
              needsReview: true,
            },
          });
          results.push({ status: "manual_added", itemId: String(join._id), manual });
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
