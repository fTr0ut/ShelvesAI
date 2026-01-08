const { makeCollectableFingerprint } = require('../collectables/fingerprint');
const { openLibraryToCollectable } = require('../../adapters/openlibrary.adapter');
const {
  lookupWorkBookMetadata,
  lookupWorkByISBN,
} = require('../openLibrary');

const DEFAULT_CONCURRENCY = 5;
const DEFAULT_RETRIES = 2;

const BOOK_TYPE_HINTS = new Set([
  'book',
  'books',
  'novel',
  'novels',
  'comic',
  'manga',
]);

function normalizeString(value) {
  return String(value || '').trim();
}

function makeDelay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class BookCatalogService {
  constructor(options = {}) {
    const enableSecondPass =
      options.enableSecondPass ?? process.env.ENABLE_SHELF_VISION_SECOND_PASS;

    this.enableSecondPass = String(enableSecondPass || 'false')
      .trim()
      .toLowerCase() === 'true';
  }

  supportsShelfType(type) {
    const normalized = normalizeString(type).toLowerCase();
    if (!normalized) return false;
    if (normalized === 'books') return true;

    for (const hint of BOOK_TYPE_HINTS) {
      if (normalized.includes(hint)) return true;
    }

    return false;
  }

  shouldRunSecondPass(type, unresolvedCount) {
    return (
      this.enableSecondPass &&
      unresolvedCount > 0 &&
      this.supportsShelfType(type)
    );
  }

  async lookupFirstPass(items = [], options = {}) {
    const concurrency = options.concurrency || DEFAULT_CONCURRENCY;
    const results = [];
    let index = 0;

    const worker = async () => {
      while (index < items.length) {
        const currentIndex = index++;
        const input = items[currentIndex];
        try {
          const value = await this.safeLookup(input, options.retries);
          if (value) {
            results[currentIndex] = {
              status: 'resolved',
              input,
              enrichment: value,
            };
          } else {
            results[currentIndex] = { status: 'unresolved', input };
          }
        } catch (err) {
          console.error('[BookCatalogService.lookupFirstPass] failed', err?.message || err);
          results[currentIndex] = { status: 'unresolved', input };
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, worker));
    return results;
  }

  async safeLookup(item, retries = DEFAULT_RETRIES) {
    const payload = {
      title: normalizeString(item?.name || item?.title),
      author: normalizeString(item?.author || item?.primaryCreator),
      identifiers: item?.identifiers || {},
    };

    const isbnCandidates = [
      ...(Array.isArray(payload.identifiers?.isbn13)
        ? payload.identifiers.isbn13
        : []),
      ...(Array.isArray(payload.identifiers?.isbn10)
        ? payload.identifiers.isbn10
        : []),
    ]
      .map((code) => normalizeString(code))
      .filter(Boolean);

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const result = await lookupWorkBookMetadata({
          title: payload.title,
          author: payload.author,
        });
        if (result) {
          return result;
        }
        break;
      } catch (err) {
        const message = String(err?.message || err);
        if (message.includes('429') && attempt < retries) {
          const backoff = 500 * Math.pow(2, attempt);
          console.warn('[BookCatalogService.safeLookup] 429 from OpenLibrary', {
            backoff,
            payload,
          });
          await makeDelay(backoff);
          continue;
        }
        if (message.includes('aborted') && attempt < retries) {
          const backoff = 1000 * (attempt + 1);
          console.warn('[BookCatalogService.safeLookup] request aborted', {
            backoff,
            payload,
          });
          await makeDelay(backoff);
          continue;
        }
        console.error('[BookCatalogService.safeLookup] failed', {
          payload,
          error: err,
        });
        throw err;
      }
    }

    for (const isbn of isbnCandidates) {
      try {
        const byIsbn = await lookupWorkByISBN(isbn);
        if (byIsbn) {
          return byIsbn;
        }
      } catch (err) {
        const message = String(err?.message || err);
        if (message.includes('429')) {
          console.warn('[BookCatalogService.safeLookup] isbn 429', { isbn });
          await makeDelay(500);
          continue;
        }
        if (message.includes('aborted')) {
          console.warn('[BookCatalogService.safeLookup] isbn aborted', { isbn });
          await makeDelay(500);
          continue;
        }
        console.error('[BookCatalogService.safeLookup] isbn lookup failed', {
          isbn,
          error: err,
        });
      }
    }

    return null;
  }

  async enrichWithOpenAI(unresolved = [], openaiClient) {
    if (!Array.isArray(unresolved) || unresolved.length === 0) return [];
    if (!openaiClient)
      return unresolved.map((u) => ({ status: 'unresolved', input: u.input }));

    const prepared = [];
    const skippedForMissingTitle = [];

    for (let index = 0; index < unresolved.length; index++) {
      const entry = unresolved[index];
      const original = entry?.input || {};
      const payload = {
        inputId: `item-${index + 1}`,
        title: normalizeString(original?.name || original?.title),
        author: normalizeString(original?.author),
        publisher: normalizeString(original?.publisher),
        year: normalizeString(original?.year),
        notes: normalizeString(original?.description || original?.notes),
        identifiers: original?.identifiers || {},
      };

      if (!payload.title) {
        skippedForMissingTitle.push(entry);
        continue;
      }

      prepared.push({ payload, unresolved: entry });
    }

    if (!prepared.length) {
      return unresolved.map((u) => ({ status: 'unresolved', input: u.input }));
    }

    const limitedBatchSize = parseInt(
      process.env.OPENAI_ENRICH_BATCH_MAX || '30',
      10,
    );
    const trimmed = prepared.slice(0, limitedBatchSize);
    const overflow = prepared.slice(trimmed.length);

    const payloadForPrompt = trimmed.map((entry) => entry.payload);
    const idToUnresolved = new Map(
      trimmed.map((entry) => [entry.payload.inputId, entry.unresolved]),
    );

    const resp = await openaiClient.responses.create({
      model: process.env.OPENAI_TEXT_MODEL || 'gpt-5-mini',
      reasoning: { effort: 'low' },
      tools: [{ type: "web_search" }],
      tool_choice: "auto",
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text:
                'You correct noisy OCR book metadata. For each input entry, return a JSON array of authoritative book objects with the requested fields. Use web_search when necessary. Prefer recent editions when multiple exist. Always supply reliable ISBN values when they can be determined.',
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: `Given these OCR book candidates, produce corrected metadata matching the schema. Fill missing fields when unknown with null. Include the provided inputId unchanged in every response object so we can map results back to the original OCR entry. Provide authoritative ISBN-13 (and ISBN-10 when available), cover URLs, and source links when possible. No prose or comments, return only relevant findings.

${JSON.stringify(payloadForPrompt, null, 2)}`,
            },
          ],
        },
      ],
      text: {
       format:{
        name: 'CorrectedBookMetadata',
        type: 'json_schema',                
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    inputId: { type: 'string' },
                    title: { type: 'string' },
                    subtitle: { type: ['string', 'null'] },
                    author: { type: ['string', 'null'] },
                    primaryCreator: { type: ['string', 'null'] },
                    creators: {
                      type: 'array',
                      items: { type: 'string' },
                    },
                    publisher: { type: ['string', 'null'] },
                    publishers: {
                      type: 'array',
                      items: { type: 'string' },
                    },
                    year: { type: ['string', 'number', 'null'] },
                    description: { type: ['string', 'null'] },
                    tags: {
                      type: 'array',
                      items: { type: 'string' },
                    },
                    coverImage: { type: ['string', 'null'] },
                    coverImageLarge: { type: ['string', 'null'] },
                    coverImageMedium: { type: ['string', 'null'] },
                    coverImageSmall: { type: ['string', 'null'] },
                    sourceUrl: { type: ['string', 'null'] },
                    confidence: { type: ['number', 'null'] },
                    identifiers: {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        isbn10: {
                          type: 'array',
                          items: { type: 'string' },
                        },
                        isbn13: {
                          type: 'array',
                          items: { type: 'string' },
                        },
                        asin: {
                          type: 'array',
                          items: { type: 'string' },
                        },
                      },
                      required: ["isbn13", "isbn10", "asin"],
                    },
                  },
                  required: ['inputId', 'title','subtitle','author','year','primaryCreator','creators','publisher','publishers','description','tags','identifiers','coverImage','coverImageLarge','coverImageMedium','coverImageSmall','sourceUrl','confidence' ],
                },
              },
            },
            required: ['items'],
          },
      },
    },
  });

    let corrections = [];
    if (Array.isArray(resp?.output_parsed?.items)) {
      corrections = resp.output_parsed.items;
    } else if (Array.isArray(resp?.output_parsed)) {
      corrections = resp.output_parsed;
    } else {
      const textOut = this.safeGetOutputText(resp);
      const parsed = this.coerceCorrectionsArray(textOut);
      corrections = Array.isArray(parsed?.items) ? parsed.items : parsed;
    }

    if (!Array.isArray(corrections) || corrections.length === 0) {
      return unresolved.map((u) => ({ status: 'unresolved', input: u.input }));
    }

    const results = [];
    const now = new Date().toISOString();

    const clampArray = (value) =>
      Array.isArray(value) ? value.filter(Boolean) : [];

    const normalizeIdentifiers = (identifiers = {}) => {
      const out = {};
      const isbn10 = clampArray(identifiers.isbn10).map(normalizeString);
      const isbn13 = clampArray(identifiers.isbn13).map(normalizeString);
      const asin = clampArray(identifiers.asin).map(normalizeString);
      if (isbn10.length) out.isbn10 = Array.from(new Set(isbn10));
      if (isbn13.length) out.isbn13 = Array.from(new Set(isbn13));
      if (asin.length) out.asin = Array.from(new Set(asin));
      return out;
    };

    const handledInputIds = new Set();

    corrections.forEach((corr, index) => {
      const corrCopy = { ...corr };
      const corrInputId = typeof corrCopy.inputId === 'string' ? corrCopy.inputId.trim() : '';
      if (corrInputId) delete corrCopy.inputId;

      const referenceEntry = corrInputId ? idToUnresolved.get(corrInputId) : null;
      const fallbackEntry = trimmed[index] || null;
      const lookupId = corrInputId || fallbackEntry?.payload?.inputId || '';
      if (lookupId) handledInputIds.add(lookupId);

      const orig =
        referenceEntry?.input ||
        fallbackEntry?.unresolved?.input ||
        unresolved.find(
          (u) =>
            normalizeString(u.input?.name || u.input?.title).toLowerCase() ===
            normalizeString(corrCopy.title).toLowerCase(),
        )?.input || {};

      const baseTitle = normalizeString(
        corrCopy.title || orig.name || orig.title,
      );
      const baseCreator = normalizeString(
        corrCopy.primaryCreator ||
          corrCopy.author ||
          (Array.isArray(corrCopy.creators) ? corrCopy.creators.find(Boolean) : null) ||
          orig.author,
      );

      if (!baseTitle) {
        results.push({ status: 'unresolved', input: orig });
        return;
      }

      const creators = clampArray(corrCopy.creators);
      if (baseCreator && !creators.includes(baseCreator)) creators.unshift(baseCreator);

      const publishers = clampArray(corrCopy.publishers);
      if (corrCopy.publisher) {
        const pref = normalizeString(corrCopy.publisher);
        if (pref && !publishers.includes(pref)) publishers.unshift(pref);
      }

      const tags = clampArray(corrCopy.tags);

      const coverLarge = corrCopy.coverImageLarge || corrCopy.coverImage || null;
      const coverMedium = corrCopy.coverImageMedium || corrCopy.coverImage || null;
      const coverSmall = corrCopy.coverImageSmall || corrCopy.coverImage || null;
      const images = coverLarge || coverMedium || coverSmall
        ? [
            {
              kind: 'cover',
              urlLarge: coverLarge || null,
              urlMedium: coverMedium || null,
              urlSmall: coverSmall || null,
              provider: 'openai',
            },
          ]
        : [];

      const identifiers = normalizeIdentifiers(corrCopy.identifiers);

      const collectable = {
        kind: 'book',
        title: baseTitle,
        subtitle: corrCopy.subtitle || null,
        description: corrCopy.description || null,
        primaryCreator: baseCreator || null,
        creators,
        publishers,
        year: corrCopy.year ? String(corrCopy.year) : orig.year || null,
        tags,
        identifiers,
        images,
        editions: [],
        sources: [
          {
            provider: 'openai',
            ids: {},
            urls: corrCopy.sourceUrl ? { page: corrCopy.sourceUrl } : {},
            fetchedAt: now,
            raw: { confidence: corrCopy.confidence ?? null },
          },
        ],
        extras: {},
      };

      results.push({
        status: 'resolved',
        input: orig,
        enrichment: { __collectable: true, collectable },
      });
    });

    for (const entry of trimmed) {
      const entryId = entry.payload.inputId;
      if (entryId && handledInputIds.has(entryId)) continue;
      results.push({ status: 'unresolved', input: entry.unresolved.input });
    }

    for (const entry of overflow) {
      results.push({ status: 'unresolved', input: entry.unresolved.input });
    }

    for (const entry of skippedForMissingTitle) {
      results.push({ status: 'unresolved', input: entry.input });
    }

    return results;
  }

  buildCollectablePayload(entry, item, lightweightFingerprint) {
    if (!entry || entry.status !== 'resolved' || !entry.enrichment) {
      return null;
    }

    if (entry.enrichment.__collectable) {
      const direct = { ...(entry.enrichment.collectable || {}) };
      direct.kind = direct.kind || item?.kind || 'book';
      direct.lightweightFingerprint =
        direct.lightweightFingerprint || lightweightFingerprint || null;
      if (!direct.fingerprint) {
        const computedFingerprint = makeCollectableFingerprint({
          title: direct.title || item?.title || item?.name,
          primaryCreator:
            direct.primaryCreator ||
            direct.primaryAuthor ||
            item?.author ||
            item?.creator,
          releaseYear: direct.year || direct.releaseYear || item?.year,
          mediaType: direct.type || direct.kind || item?.type,
          format: direct.physical?.format || direct.format || item?.format,
          platforms: direct.platform || direct.platforms || item?.platform,
        });
        direct.fingerprint = computedFingerprint || null;
      }
      direct.identifiers = direct.identifiers || {};
      direct.images = Array.isArray(direct.images)
        ? direct.images
        : direct.images
        ? [direct.images]
        : [];
      direct.tags = Array.isArray(direct.tags)
        ? direct.tags
        : direct.tags
        ? [direct.tags]
        : [];
      direct.sources = Array.isArray(direct.sources)
        ? direct.sources
        : direct.sources
        ? [direct.sources]
        : [];
      return direct;
    }

    const payload = openLibraryToCollectable({
      ...entry.enrichment,
      lightweightFingerprint: lightweightFingerprint || null,
    });

    if (payload) {
      if (lightweightFingerprint && !payload.lightweightFingerprint) {
        payload.lightweightFingerprint = lightweightFingerprint;
      }

      if (!payload.fingerprint) {
        const computedFingerprint = makeCollectableFingerprint({
          title: payload.title || item?.title || item?.name,
          primaryCreator:
            payload.primaryCreator ||
            payload.primaryAuthor ||
            item?.author ||
            item?.creator,
          releaseYear: payload.year || payload.publishYear || item?.year,
          mediaType: payload.type || payload.kind || item?.type,
          format: payload.physical?.format || payload.format || item?.format,
          platforms: payload.platform || payload.platforms || item?.platform,
        });
        payload.fingerprint = computedFingerprint || null;
      }
    }

    return payload;
  }

  safeGetOutputText(resp) {
    try {
      if (typeof resp?.output_text === 'string') return resp.output_text;
      const maybeText = resp?.output?.[0]?.content?.[0]?.text;
      if (typeof maybeText === 'string') return maybeText;
    } catch (err) {
      /* ignore */
    }
    return '';
  }

  coerceCorrectionsArray(jsonLike) {
    let parsed = jsonLike;
    if (typeof jsonLike === 'string') {
      const trimmed = jsonLike.trim();
      const start =
        trimmed.indexOf('[') !== -1
          ? trimmed.indexOf('[')
          : trimmed.indexOf('{');
      const end =
        trimmed.lastIndexOf(']') !== -1
          ? trimmed.lastIndexOf(']') + 1
          : trimmed.lastIndexOf('}') + 1;
      try {
        parsed = JSON.parse(
          start >= 0 && end > start ? trimmed.slice(start, end) : trimmed,
        );
      } catch (err) {
        return [];
      }
    }

    if (Array.isArray(parsed)) return parsed;

    if (parsed && Array.isArray(parsed.corrections)) return parsed.corrections;

    if (parsed && (parsed.title || parsed.author)) return [parsed];

    return [];
  }
}

module.exports = { BookCatalogService };

