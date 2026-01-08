// models/Collectable.js (v1.5 non-breaking)
const mongoose = require("mongoose");

function normalizeStringList(values) {
  if (values == null || values === "") return [];
  const source = Array.isArray(values)
    ? values
    : typeof values === "string"
      ? values.split(/[\s,]+/)
      : [];

  const seen = new Set();
  const cleaned = [];

  for (const entry of source) {
    const trimmed = String(entry ?? "").trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(trimmed);
  }

  return cleaned;
}

const ImageSchema = new mongoose.Schema({
  kind: { type: String, default: "cover" },
  urlSmall: { type: String, trim: true },
  urlMedium: { type: String, trim: true },
  urlLarge: { type: String, trim: true },
  provider: { type: String, trim: true },
  cachedSmallPath: { type: String, trim: true },
}, { _id: false });

const SourceSchema = new mongoose.Schema({
  provider: { type: String, required: true },
  ids: { type: Map, of: String },   // e.g. { work: 'OL1892617W', edition: 'OL12345M' }
  urls: { type: Map, of: String },  // e.g. { work: 'https://…', workJson:'https://…' }
  fetchedAt: { type: Date, default: Date.now },
  raw: { type: Object },            // optional: raw payload for debugging
}, { _id: false });

const EditionSchema = new mongoose.Schema({
  provider: { type: String, trim: true },
  id: { type: String, trim: true },       // provider-specific edition ID
  title: { type: String, trim: true },
  subtitle: { type: String, trim: true },
  labelOrPublisher: { type: [String], default: [] },
  dateOrYear: { type: String, trim: true },
  identifiers: { type: Map, of: [String] },
  physical: {
    format: { type: String, trim: true },
    pages: { type: Number },
    weight: { type: String, trim: true },
    dimensions: { type: String, trim: true },
    languages: { type: [String], default: [] },
    extras: { type: Object, default: {} },
  },
}, { _id: false });

const FuzzyFingerprintSchema = new mongoose.Schema({
  value: { type: String, required: true },
  source: { type: String, trim: true, default: 'vision-ocr' },
  rawTitle: { type: String, trim: true },
  rawCreator: { type: String, trim: true },
  mediaType: { type: String, trim: true },
  confidence: { type: Number, min: 0, max: 1 },
  createdAt: { type: Date, default: Date.now },
}, { _id: false });

// ---- Existing schema + new fields ----
const CollectableSchema = new mongoose.Schema({
  // Existing fields (unchanged)
 title: { type: String, required: true, trim: true },
  type: { type: String, required: true, trim: true }, // e.g., 'book', 'movie'
  description: { type: String, trim: true },

  // Optional metadata
  primaryCreator: { type: String, trim: true },
  format: { type: String, trim: true }, // paperback, hardcover
  publisher: { type: String, trim: true },
  year: { type: String, trim: true },
  openLibraryId: { type: String, trim: true, index: true }, // legacy single ID
  coverUrl: { type: String, trim: true },                   // legacy single image

  tags: {
    type: [String],
    default: [],
    set: normalizeStringList,
  },

  developer: { type: String, trim: true },

  region: { type: String, trim: true },

  systemName: { type: String, trim: true },

  urlCoverFront: { type: String, trim: true },

  urlCoverBack: { type: String, trim: true },

  genre: {
    type: [String],
    default: [],
    set: normalizeStringList,
  },

  // ---- New cross-provider fields ----
  // Normalized identifiers across providers (OL, ISBN, UPC, Discogs, etc.)
 identifiers: { type: mongoose.Schema.Types.Mixed, default: {} },

  // Multiple images from any provider
  images: { type: [ImageSchema], default: [] },

  // Provider provenance
  sources: { type: [SourceSchema], default: [] },

  // Optional: editions/variants/vintages
  editions: { type: [EditionSchema], default: [] },

  // Stable cross-provider fuzzy key (e.g., sha1(title|creator|year))
  fingerprint: { type: String, index: true, sparse: true },

  //Lightweight Hash on title+creator
  lightweightFingerprint: { type: String, index: true, sparse: true },

  // Vision/OCR fingerprints for noisy inputs
  fuzzyFingerprints: { type: [FuzzyFingerprintSchema], default: [] },
}, { timestamps: true });

// Existing index
CollectableSchema.index({ title: "text", type: 1 });

CollectableSchema.index({ 'fuzzyFingerprints.value': 1 }, { sparse: true });

// New sparse uniques on strong IDs (won’t affect docs that don’t have them)
CollectableSchema.index({ 'identifiers.openlibrary.work': 1 }, { unique: true, sparse: true });
CollectableSchema.index({ 'identifiers.isbn13': 1 }, { unique: true, sparse: true });
CollectableSchema.index({ 'identifiers.upc': 1 }, { unique: true, sparse: true });
CollectableSchema.index({ 'identifiers.steam.appId': 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("Collectable", CollectableSchema);
