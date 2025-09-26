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

    const payload = unresolved
      .map((u) => ({
        title: normalizeString(u?.input?.name || u?.input?.title),
        author: normalizeString(u?.input?.author),
        publisher: normalizeString(u?.input?.publisher),
        year: normalizeString(u?.input?.year),
        notes: normalizeString(u?.input?.description || u?.input?.notes),
      }))
      .filter((it) => it.title);

    if (!payload.length) {
      return unresolved.map((u) => ({ status: 'unresolved', input: u.input }));
    }

    const limitedBatchSize = parseInt(
      process.env.OPENAI_ENRICH_BATCH_MAX || '30',
      10,
    );
    const trimmed = payload.slice(0, limitedBatchSize);
    const unresolvedForPrompt = unresolved.slice(0, trimmed.length);
    const overflow = unresolved.slice(trimmed.length);

    const resp = await openaiClient.responses.create({
      model: process.env.OPENAI_TEXT_MODEL || 'gpt-5-mini',
      reasoning: { effort: 'medium' },
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
              text: `Given these OCR book candidates, produce corrected metadata matching the schema. Fill missing fields when unknown with null. Provide authoritative ISBN-13 (and ISBN-10 when available), cover URLs, and source links when possible.\n\n${JSON.stringify(trimmed, null, 2)}`,
            },
          ],
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'CorrectedBookMetadata',
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
                    },
                  },
                  required: ['title'],
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
      const unresolvedOutputs = unresolved.map((u) => ({
        status: 'unresolved',
        input: u.input,
      }));
      return unresolvedOutputs;
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

    corrections.forEach((corr, index) => {
      const origEntry = unresolvedForPrompt[index] || unresolved[index];
      const orig =
        origEntry?.input ||
        unresolved.find(
          (u) =>
            normalizeString(u.input?.name || u.input?.title).toLowerCase() ===
            normalizeString(corr.title).toLowerCase(),
        )?.input || {};

      const baseTitle = normalizeString(
        corr.title || orig.name || orig.title,
      );
      const baseCreator = normalizeString(
        corr.primaryCreator ||
          corr.author ||
          (Array.isArray(corr.creators) ? corr.creators.find(Boolean) : null) ||
          orig.author,
      );

      if (!baseTitle) {
        results.push({ status: 'unresolved', input: orig });
        return;
      }

      const creators = clampArray(corr.creators);
      if (baseCreator && !creators.includes(baseCreator)) creators.unshift(baseCreator);

      const publishers = clampArray(corr.publishers);
      if (corr.publisher) {
        const pref = normalizeString(corr.publisher);
        if (pref && !publishers.includes(pref)) publishers.unshift(pref);
      }

      const tags = clampArray(corr.tags);

      const coverLarge = corr.coverImageLarge || corr.coverImage || null;
      const coverMedium = corr.coverImageMedium || corr.coverImage || null;
      const coverSmall = corr.coverImageSmall || corr.coverImage || null;
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

      const identifiers = normalizeIdentifiers(corr.identifiers);

      const collectable = {
        kind: 'book',
        title: baseTitle,
        subtitle: corr.subtitle || null,
        description: corr.description || null,
        primaryCreator: baseCreator || null,
        creators,
        publishers,
        year: corr.year ? String(corr.year) : orig.year || null,
        tags,
        identifiers,
        images,
        editions: [],
        sources: [
          {
            provider: 'openai',
            ids: {},
            urls: corr.sourceUrl ? { page: corr.sourceUrl } : {},
            fetchedAt: now,
            raw: { confidence: corr.confidence ?? null },
          },
        ],
        extras: {},
      };

      if (orig.position) collectable.position = orig.position;

      results.push({
        status: 'resolved',
        input: orig,
        enrichment: { __collectable: true, collectable },
      });
    });

    for (const entry of overflow) {
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
      position: item?.position || null,
      lightweightFingerprint: lightweightFingerprint || null,
    });

    if (payload && lightweightFingerprint && !payload.lightweightFingerprint) {
      payload.lightweightFingerprint = lightweightFingerprint;
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
