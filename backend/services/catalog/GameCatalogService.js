const fetch = require('node-fetch');
const {
  makeCollectableFingerprint,
  makeLightweightFingerprint,
} = require('../collectables/fingerprint');

const AbortController =
  (globalThis && globalThis.AbortController) || fetch.AbortController || null;

const DEFAULT_CONCURRENCY = 5;
const DEFAULT_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_RESULTS = 8;

const IGDB_BASE_URL = 'https://api.igdb.com/v4';
const IGDB_AUTH_URL = 'https://id.twitch.tv/oauth2/token';

const GAME_TYPE_HINTS = new Set([
  'game',
  'games',
  'video game',
  'video games',
  'nintendo',
  'playstation',
  'xbox',
  'switch',
  'pc games',
]);

const IGDB_REGION_MAP = {
  1: 'Europe',
  2: 'North America',
  3: 'Australia',
  4: 'New Zealand',
  5: 'Japan',
  6: 'China',
  7: 'Asia',
  8: 'Worldwide',
  9: 'Korea',
  10: 'Brazil',
  11: 'Germany',
  12: 'France',
  13: 'United Kingdom',
  14: 'Rest of the world',
  15: 'Africa',
};

function normalizeString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function normalizeCompare(value) {
  return normalizeString(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function uniqueStrings(values = []) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const normalized = normalizeString(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function pruneObject(source) {
  const out = {};
  Object.entries(source || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    out[key] = value;
  });
  return out;
}

function summarizeItemForLog(item, index) {
  const title = normalizeString(item?.name || item?.title);
  const platform = normalizeString(item?.systemName || item?.platform);
  const developer = normalizeString(
    item?.author || item?.primaryCreator || item?.developer,
  );

  return pruneObject({
    index,
    title: title ? title.slice(0, 80) : undefined,
    platform: platform ? platform.slice(0, 60) : undefined,
    developer: developer ? developer.slice(0, 60) : undefined,
    year: normalizeString(item?.year) || undefined,
  });
}

function summarizeEnrichment(enrichment) {
  if (!enrichment) return null;

  const gameTitle = normalizeString(enrichment.game?.name);

  return pruneObject({
    provider: enrichment.provider,
    gameId: enrichment.game?.id,
    title: gameTitle ? gameTitle.slice(0, 80) : undefined,
    score: Number.isFinite(enrichment.score) ? enrichment.score : undefined,
  });
}

function igdbImageUrl(imageId, size) {
  if (!imageId) return null;
  const preset = size || 't_cover_big';
  return `https://images.igdb.com/igdb/image/upload/${preset}/${imageId}.jpg`;
}

function secondsToYear(timestampSeconds) {
  if (!timestampSeconds) return null;
  const date = new Date(timestampSeconds * 1000);
  if (!Number.isFinite(date.getTime())) return null;
  return String(date.getUTCFullYear());
}

function pickBest(list, scorer) {
  if (!Array.isArray(list) || !list.length) return null;
  let best = null;
  let bestScore = -Infinity;
  for (const item of list) {
    const score = Number.isFinite(item?.score) ? item.score : scorer(item) || 0;
    if (score > bestScore) {
      bestScore = score;
      best = { item, score };
    }
  }
  if (!best) return null;
  return { value: best.item, score: bestScore };
}

function makeDelay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class GameCatalogService {
  constructor(options = {}) {
    const enableSecondPass =
      options.enableSecondPass ?? process.env.ENABLE_SHELF_VISION_SECOND_PASS;

    this.enableSecondPass = String(enableSecondPass || 'false')
      .trim()
      .toLowerCase() === 'true';

    this.clientId =
      normalizeString(options.clientId || process.env.IGDB_CLIENT_ID) || null;
    this.clientSecret =
      normalizeString(options.clientSecret || process.env.IGDB_CLIENT_SECRET) ||
      null;
    this.baseUrl =
      normalizeString(options.baseUrl || process.env.IGDB_BASE_URL) ||
      IGDB_BASE_URL;
    this.authUrl =
      normalizeString(options.authUrl || process.env.IGDB_AUTH_URL) ||
      IGDB_AUTH_URL;
    this.timeoutMs = Number.isFinite(options.timeoutMs)
      ? options.timeoutMs
      : Number.parseInt(process.env.IGDB_TIMEOUT_MS || '', 10) ||
        DEFAULT_TIMEOUT_MS;
    this.maxResults = Number.isFinite(options.maxResults)
      ? options.maxResults
      : Number.parseInt(process.env.IGDB_MAX_RESULTS || '', 10) ||
        DEFAULT_MAX_RESULTS;

    this._token = null;
    this._tokenExpiresAt = 0;
    this._warnedMissingCredentials = false;
  }

  supportsShelfType(type) {
    const normalized = normalizeString(type).toLowerCase();
    if (!normalized) return false;
    if (normalized === 'games' || normalized === 'game') return true;
    for (const hint of GAME_TYPE_HINTS) {
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
    if (!Array.isArray(items) || !items.length) return [];
    const concurrency = options.concurrency || DEFAULT_CONCURRENCY;
    const retries = options.retries ?? DEFAULT_RETRIES;
    const results = new Array(items.length);
    let index = 0;

    const previewSize = Math.min(items.length, 3);
    const preview = [];
    for (let i = 0; i < previewSize; i++) {
      preview.push(summarizeItemForLog(items[i], i));
    }
    console.info('[GameCatalogService.lookupFirstPass] starting batch', {
      total: items.length,
      preview,
    });

    const worker = async () => {
      while (index < items.length) {
        const currentIndex = index++;
        const input = items[currentIndex];
        const logContext = summarizeItemForLog(input, currentIndex);
        console.info('[GameCatalogService.lookupFirstPass] lookup.start', logContext);
        let enrichment = null;
        let status = 'unresolved';
        try {
          enrichment = await this.safeLookup(input, retries);
          if (enrichment) {
            results[currentIndex] = {
              status: 'resolved',
              input,
              enrichment,
            };
            status = 'resolved';
          } else {
            results[currentIndex] = { status: 'unresolved', input };
            status = 'unresolved';
          }
        } catch (err) {
          status = 'error';
          console.error('[GameCatalogService.lookupFirstPass] failed', {
            ...logContext,
            message: err?.message || err,
          });
          results[currentIndex] = { status: 'unresolved', input };
        } finally {
          const enrichmentSummary = summarizeEnrichment(enrichment);
          const payload = {
            ...logContext,
            status,
          };
          if (enrichmentSummary) {
            payload.enrichment = enrichmentSummary;
          }
          console.info('[GameCatalogService.lookupFirstPass] lookup.finish', payload);
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, items.length) }, worker),
    );
    return results;
  }

  async safeLookup(item, retries = DEFAULT_RETRIES) {
    const title = normalizeString(item?.name || item?.title);
    const developer = normalizeString(
      item?.author || item?.primaryCreator || item?.developer,
    );
    const platform = normalizeString(item?.systemName || item?.platform);
    const publisher = normalizeString(item?.publisher);
    const year = normalizeString(item?.year);

    const logContext = pruneObject({
      ...summarizeItemForLog(item),
      title: title || undefined,
      developer: developer || undefined,
      platform: platform || undefined,
      publisher: publisher || undefined,
      year: year || undefined,
    });

    if (!title) {
      console.info('[GameCatalogService.safeLookup] lookup.skipped', {
        ...logContext,
        reason: 'missing-title',
      });
      return null;
    }

    if (!this.clientId || !this.clientSecret) {
      if (!this._warnedMissingCredentials) {
        console.warn(
          '[GameCatalogService.safeLookup] IGDB credentials missing; skipping lookup',
        );
        this._warnedMissingCredentials = true;
      }
      console.warn('[GameCatalogService.safeLookup] lookup.skipped', {
        ...logContext,
        reason: 'missing-credentials',
      });
      return null;
    }

    const query = this.buildSearchQuery({ title, limit: this.maxResults });

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const payload = await this.callIgdb('games', query);
        if (!Array.isArray(payload) || payload.length === 0) {
          console.info('[GameCatalogService.safeLookup] lookup.skipped', {
            ...logContext,
            reason: 'no-results',
            payloadLength: Array.isArray(payload) ? payload.length : 0,
            attempt,
          });
          return null;
        }
        const scored = payload
          .map((game) => ({
            game,
            score: this.scoreCandidate(game, {
              title,
              developer,
              platform,
              publisher,
              year,
            }),
          }))
          .filter((entry) => Number.isFinite(entry.score));

        const best = pickBest(scored, (entry) => entry.score);
        if (!best || best.score < 25) {
          console.info('[GameCatalogService.safeLookup] lookup.skipped', {
            ...logContext,
            reason: 'low-score',
            attempt,
            payloadLength: payload.length,
            topCandidateName: best?.value?.game?.name,
            topCandidateScore: best?.score,
          });
          return null;
        }
        return {
          provider: 'igdb',
          game: best.value.game,
          score: best.score,
        };
      } catch (err) {
        const message = String(err?.message || err);
        if (message.includes('401') && attempt < retries) {
          await this.getAccessToken({ forceRefresh: true });
          continue;
        }
        if (message.includes('429') && attempt < retries) {
          const backoff = 500 * Math.pow(2, attempt);
          console.warn('[GameCatalogService.safeLookup] rate limited', {
            backoff,
            title,
          });
          await makeDelay(backoff);
          continue;
        }
        if (message.includes('aborted') && attempt < retries) {
          const backoff = 1000 * (attempt + 1);
          console.warn('[GameCatalogService.safeLookup] request aborted', {
            backoff,
            title,
          });
          await makeDelay(backoff);
          continue;
        }
        throw err;
      }
    }

    return null;
  }

  buildSearchQuery({ title, limit }) {
    const sanitizedTitle = normalizeString(title).replace(/"/g, '\\"');
    const cappedLimit = Math.max(1, Math.min(limit || this.maxResults, 50));
    const fields = [
      'id',
      'name',
      'slug',
      'summary',
      'storyline',
      'first_release_date',
      'release_dates.date',
      'release_dates.region',
      'release_dates.human',
      'release_dates.platform.name',
      'release_dates.platform.abbreviation',
      'platforms.name',
      'platforms.abbreviation',
      'genres.name',
      'involved_companies.company.name',
      'involved_companies.company.slug',
      'involved_companies.developer',
      'involved_companies.publisher',
      'keywords.name',
      'collection.name',
      'franchises.name',
      'alternative_names.name',
      'cover.image_id',
      'screenshots.image_id',
      'artworks.image_id',
      'websites.url',
      'url',
    ];

    const categoryFilter =
      'where category = (0, 8, 9, 10, 11);';

    const parts = [
      `search "${sanitizedTitle}";`,
      `fields ${fields.join(',')};`,
      categoryFilter,
      `limit ${cappedLimit};`,
    ];

    return parts.join('\n');
  }

  scoreCandidate(game, expected = {}) {
    if (!game) return 0;
    const titleNeedle = normalizeCompare(expected.title);
    const developerNeedle = normalizeCompare(expected.developer);
    const platformNeedle = normalizeCompare(expected.platform);
    const publisherNeedle = normalizeCompare(expected.publisher);
    const yearNeedle = normalizeString(expected.year);

    let score = 0;

    const gameTitle = normalizeCompare(game.name);
    if (titleNeedle && gameTitle) {
      if (gameTitle === titleNeedle) score += 60;
      else if (gameTitle.includes(titleNeedle) || titleNeedle.includes(gameTitle))
        score += 40;
      else {
        const distance = Math.abs(gameTitle.length - titleNeedle.length);
        if (distance <= 2) score += 20;
      }
    }

    const developers = this.extractCompanyNames(game, 'developer');
    if (developerNeedle && developers.length) {
      const hasMatch = developers.some(
        (name) => normalizeCompare(name) === developerNeedle,
      );
      const partialMatch = developers.some((name) =>
        normalizeCompare(name).includes(developerNeedle),
      );
      if (hasMatch) score += 40;
      else if (partialMatch) score += 20;
    }

    const publishers = this.extractCompanyNames(game, 'publisher');
    if (publisherNeedle && publishers.length) {
      const hasMatch = publishers.some(
        (name) => normalizeCompare(name) === publisherNeedle,
      );
      const partialMatch = publishers.some((name) =>
        normalizeCompare(name).includes(publisherNeedle),
      );
      if (hasMatch) score += 25;
      else if (partialMatch) score += 10;
    }

    const platforms = this.extractPlatformNames(game);
    if (platformNeedle && platforms.length) {
      const hasMatch = platforms.some(
        (name) => normalizeCompare(name) === platformNeedle,
      );
      const partialMatch = platforms.some((name) =>
        normalizeCompare(name).includes(platformNeedle),
      );
      if (hasMatch) score += 25;
      else if (partialMatch) score += 10;
    }

    const releaseYear =
      secondsToYear(game.first_release_date) || this.extractReleaseYear(game);
    if (yearNeedle && releaseYear) {
      if (normalizeString(releaseYear) === yearNeedle) score += 15;
    }

    if (Array.isArray(game.keywords) && game.keywords.length) {
      score += 2;
    }

    return score;
  }

  extractCompanyNames(game, role) {
    if (!game || !Array.isArray(game.involved_companies)) return [];
    return uniqueStrings(
      game.involved_companies
        .filter((entry) => entry && entry[role])
        .map((entry) => entry.company && entry.company.name)
        .filter(Boolean),
    );
  }

  extractPlatformNames(game) {
    const names = [];
    if (Array.isArray(game.platforms)) {
      for (const platform of game.platforms) {
        if (!platform) continue;
        const maybe = platform.name || platform.abbreviation;
        if (maybe) names.push(maybe);
      }
    }
    if (Array.isArray(game.release_dates)) {
      for (const rd of game.release_dates) {
        if (!rd) continue;
        const platformName = rd.platform?.name || rd.platform?.abbreviation;
        if (platformName) names.push(platformName);
      }
    }
    return uniqueStrings(names);
  }

  extractReleaseYear(game) {
    if (!game) return null;
    const dates = [];
    if (game.first_release_date) dates.push(game.first_release_date);
    if (Array.isArray(game.release_dates)) {
      for (const rd of game.release_dates) {
        if (rd?.date) dates.push(rd.date);
      }
    }
    const earliest = dates.length
      ? dates.reduce((min, current) => (current && current < min ? current : min))
      : null;
    return earliest ? secondsToYear(earliest) : null;
  }

  pickPreferredRegion(game, fallbackRegion) {
    if (!Array.isArray(game?.release_dates) || !game.release_dates.length) {
      return fallbackRegion ? normalizeString(fallbackRegion) : null;
    }
    const prioritized = game.release_dates.find((rd) => rd?.region === 8);
    const target =
      prioritized || game.release_dates.find((rd) => rd?.region) || null;
    if (target?.region && IGDB_REGION_MAP[target.region]) {
      return IGDB_REGION_MAP[target.region];
    }
    return fallbackRegion ? normalizeString(fallbackRegion) : null;
  }

  pickPreferredPlatform(game, fallbackPlatform) {
    const normalizedFallback = normalizeString(fallbackPlatform);
    const platforms = this.extractPlatformNames(game);
    if (!platforms.length) return normalizedFallback || null;
    if (normalizedFallback) {
      const exact = platforms.find(
        (name) => normalizeCompare(name) === normalizeCompare(normalizedFallback),
      );
      if (exact) return exact;
      const partial = platforms.find((name) =>
        normalizeCompare(name).includes(normalizeCompare(normalizedFallback)),
      );
      if (partial) return partial;
    }
    return platforms[0] || normalizedFallback || null;
  }

  buildIdentifiers(game, itemIdentifiers = {}) {
    const identifiers = Object.assign({}, itemIdentifiers || {});
    const igdbIdentifiers = Object.assign({}, identifiers.igdb || {});

    const idList = Array.isArray(igdbIdentifiers.gameId)
      ? igdbIdentifiers.gameId.map((id) => String(id))
      : [];
    if (game?.id != null) {
      const idValue = String(game.id);
      if (!idList.includes(idValue)) idList.push(idValue);
    }

    const slugList = Array.isArray(igdbIdentifiers.slug)
      ? igdbIdentifiers.slug.map((slug) => String(slug))
      : [];
    if (game?.slug) {
      if (!slugList.includes(game.slug)) slugList.push(game.slug);
    }

    const altNames = Array.isArray(igdbIdentifiers.alternativeName)
      ? igdbIdentifiers.alternativeName.map((name) => normalizeString(name))
      : [];
    if (Array.isArray(game?.alternative_names)) {
      for (const alt of game.alternative_names) {
        const normalized = normalizeString(alt?.name);
        if (normalized && !altNames.includes(normalized)) {
          altNames.push(normalized);
        }
      }
    }

    identifiers.igdb = Object.assign({}, igdbIdentifiers, {
      gameId: idList,
      slug: slugList,
      alternativeName: altNames,
    });

    return identifiers;
  }

  mapIgdbGameToCollectable(game, item, lightweightFingerprint, score) {
    if (!game) return null;
    const developerNames = this.extractCompanyNames(game, 'developer');
    const publisherNames = this.extractCompanyNames(game, 'publisher');
    const primaryCreator =
      developerNames[0] || normalizeString(item?.primaryCreator);
    const developer = developerNames[0] || normalizeString(item?.developer);
    const publisher = publisherNames[0] || normalizeString(item?.publisher);
    const year =
      this.extractReleaseYear(game) || normalizeString(item?.year) || null;
    const region = this.pickPreferredRegion(game, item?.region);
    const systemName = this.pickPreferredPlatform(game, item?.systemName);
    const descriptionParts = [game.summary, game.storyline]
      .map((part) => normalizeString(part))
      .filter(Boolean);
    const description = descriptionParts.length
      ? descriptionParts.join('\n\n')
      : normalizeString(item?.description) || null;
    const genres = uniqueStrings(
      (Array.isArray(game.genres) ? game.genres.map((g) => g?.name) : []) || [],
    );
    const keywords = uniqueStrings(
      (Array.isArray(game.keywords) ? game.keywords.map((k) => k?.name) : []) ||
        [],
    );
    if (game.collection?.name) keywords.push(game.collection.name);
    if (Array.isArray(game.franchises)) {
      for (const franchise of game.franchises) {
        if (franchise?.name) keywords.push(franchise.name);
      }
    }
    const coverLarge = igdbImageUrl(game.cover?.image_id, 't_cover_big');
    const coverSmall = igdbImageUrl(game.cover?.image_id, 't_thumb');
    const coverXL = igdbImageUrl(game.cover?.image_id, 't_cover_big_2x');
    const screenshots = Array.isArray(game.screenshots)
      ? game.screenshots
          .map((shot) => {
            const large = igdbImageUrl(shot?.image_id, 't_screenshot_huge');
            const medium = igdbImageUrl(shot?.image_id, 't_screenshot_big');
            const small = igdbImageUrl(shot?.image_id, 't_thumb');
            if (!large && !medium && !small) return null;
            return {
              kind: 'screenshot',
              urlLarge: large || medium || small || null,
              urlMedium: medium || large || small || null,
              urlSmall: small || medium || large || null,
              provider: 'igdb',
            };
          })
          .filter(Boolean)
      : [];
    const artworks = Array.isArray(game.artworks)
      ? game.artworks
          .map((art) => {
            const large = igdbImageUrl(art?.image_id, 't_1080p');
            const medium = igdbImageUrl(art?.image_id, 't_720p');
            const small = igdbImageUrl(art?.image_id, 't_thumb');
            if (!large && !medium && !small) return null;
            return {
              kind: 'artwork',
              urlLarge: large || medium || small || null,
              urlMedium: medium || large || small || null,
              urlSmall: small || medium || large || null,
              provider: 'igdb',
            };
          })
          .filter(Boolean)
      : [];

    const images = [];
    if (coverLarge || coverSmall || coverXL) {
      images.push({
        kind: 'cover',
        urlLarge: coverXL || coverLarge || null,
        urlMedium: coverLarge || coverSmall || null,
        urlSmall: coverSmall || coverLarge || null,
        provider: 'igdb',
      });
    }
    images.push(...screenshots, ...artworks);

    const identifiers = this.buildIdentifiers(game, item?.identifiers);

    const sourceUrls = {};
    if (game.url) sourceUrls.page = game.url;
    if (Array.isArray(game.websites)) {
      const official = game.websites.find((w) => /official/i.test(w?.url || ''));
      if (official?.url) sourceUrls.official = official.url;
      const wiki = game.websites.find((w) => /wiki/i.test(w?.url || ''));
      if (wiki?.url) sourceUrls.wiki = wiki.url;
    }

    const lwf =
      lightweightFingerprint ||
      makeLightweightFingerprint({ title: game.name, primaryCreator });
    const fingerprint =
      makeCollectableFingerprint({ uniqueKey: `igdb:${game.id}` }) ||
      makeCollectableFingerprint({
        title: game.name,
        primaryCreator,
        releaseYear: year,
        mediaType: 'game',
        platforms: systemName ? [systemName] : undefined,
      }) || null;

    const tags = uniqueStrings([
      ...(Array.isArray(item?.tags) ? item.tags : []),
      ...keywords,
    ]);

    const now = new Date();

    return {
      kind: 'game',
      type: 'game',
      title: game.name || item?.name || item?.title || '',
      description: description || null,
      primaryCreator: primaryCreator || null,
      creators: uniqueStrings([
        ...developerNames,
        ...(primaryCreator ? [primaryCreator] : []),
      ]),
      developer: developer || null,
      publisher: publisher || null,
      year: year || null,
      region: region || null,
      systemName: systemName || null,
      urlCoverFront: coverXL || coverLarge || null,
      urlCoverBack: null,
      genre: genres,
      tags,
      identifiers,
      images,
      physical: {
        format: normalizeString(item?.format) || 'physical',
        extras: {},
      },
      editions: [],
      sources: [
        {
          provider: 'igdb',
          ids: pruneObject({
            id: game.id != null ? String(game.id) : undefined,
            slug: game.slug || undefined,
          }),
          urls: pruneObject(sourceUrls),
          fetchedAt: now,
          raw: {
            score: score ?? null,
          },
        },
      ],
      extras: {
        igdb: {
          first_release_date: game.first_release_date || null,
          release_dates: Array.isArray(game.release_dates)
            ? game.release_dates.map((rd) => ({
                date: rd?.date || null,
                human: rd?.human || null,
                region: rd?.region || null,
                regionName: rd?.region ? IGDB_REGION_MAP[rd.region] || null : null,
                platform: rd?.platform?.name || rd?.platform?.abbreviation || null,
              }))
            : [],
        },
      },
      lightweightFingerprint: lwf || null,
      fingerprint,
    };
  }

  async enrichWithOpenAI(unresolved = [], openaiClient) {
    if (!Array.isArray(unresolved) || unresolved.length === 0) return [];
    if (!openaiClient)
      return unresolved.map((u) => ({ status: 'unresolved', input: u.input }));

    const prepared = [];
    const skipped = [];

    for (let index = 0; index < unresolved.length; index++) {
      const entry = unresolved[index];
      const original = entry?.input || {};
      const payload = {
        inputId: `item-${index + 1}`,
        title: normalizeString(original?.name || original?.title),
        developer: normalizeString(
          original?.author || original?.primaryCreator || original?.developer,
        ),
        publisher: normalizeString(original?.publisher),
        platform: normalizeString(original?.systemName || original?.platform),
        region: normalizeString(original?.region),
        year: normalizeString(original?.year),
        notes: normalizeString(original?.description || original?.notes),
        identifiers: original?.identifiers || {},
      };

      if (!payload.title) {
        skipped.push(entry);
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

    const response = await openaiClient.responses.create({
      model: process.env.OPENAI_TEXT_MODEL || 'gpt-5-mini',
      reasoning: { effort: 'low' },
      tools: [{ type: 'web_search' }],
      tool_choice: 'auto',
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text:
                'You are a video game archivist. Correct noisy OCR metadata for physical video games. For each entry, return authoritative data and cite reliable sources. Use web_search when information is missing or uncertain. Return structured JSON only.',
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: `Given these OCR video game candidates, produce corrected metadata matching the schema. Preserve the provided inputId on every response object. Provide developer, publisher, release year, region, platform, genre, cover art URLs, and trustworthy source links when possible. Use null when a field cannot be confirmed.

${JSON.stringify(payloadForPrompt, null, 2)}`,
            },
          ],
        },
      ],
      text: {
        format: {
          name: 'CorrectedGameMetadata',
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
                    primaryCreator: { type: ['string', 'null'] },
                    developer: { type: ['string', 'null'] },
                    publisher: { type: ['string', 'null'] },
                    description: { type: ['string', 'null'] },
                    year: { type: ['string', 'number', 'null'] },
                    region: { type: ['string', 'null'] },
                    format: { type: ['string', 'null'] },
                    platforms: {
                      type: 'array',
                      items: { type: 'string' },
                    },
                    genres: {
                      type: 'array',
                      items: { type: 'string' },
                    },
                    tags: {
                      type: 'array',
                      items: { type: 'string' },
                    },
                    coverImage: { type: ['string', 'null'] },
                    coverImageBack: { type: ['string', 'null'] },
                    sourceUrl: { type: ['string', 'null'] },
                    confidence: { type: ['number', 'null'] },
                    identifiers: {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        igdb: {
                          type: 'array',
                          items: { type: ['integer', 'string'] },
                        },
                        slug: {
                          type: 'array',
                          items: { type: 'string' },
                        },
                        upc: {
                          type: 'array',
                          items: { type: 'string' },
                        },
                      },
                      required: ['igdb', 'slug', 'upc'],
                    },
                  },
                  required: [
                    'inputId',
                    'title',
                    'primaryCreator',
                    'developer',
                    'publisher',
                    'year',
                    'region',
                    'format',
                    'platforms',
                    'genres',
                    'tags',
                    'description',
                    'coverImage',
                    'coverImageBack',
                    'sourceUrl',
                    'identifiers',
                    'confidence',
                  ],
                },
              },
            },
            required: ['items'],
          },
        },
      },
    });

    let corrections = [];
    if (Array.isArray(response?.output_parsed?.items)) {
      corrections = response.output_parsed.items;
    } else if (Array.isArray(response?.output_parsed)) {
      corrections = response.output_parsed;
    } else {
      const textOut = this.safeGetOutputText(response);
      const parsed = this.coerceCorrectionsArray(textOut);
      corrections = Array.isArray(parsed?.items) ? parsed.items : parsed || [];
    }

    if (!Array.isArray(corrections) || corrections.length === 0) {
      return unresolved.map((u) => ({ status: 'unresolved', input: u.input }));
    }

    const results = [];
    const handledIds = new Set();
    const now = new Date();

    const clampArray = (value) =>
      Array.isArray(value) ? value.filter(Boolean) : [];

    const normalizeIdentifiers = (identifiers = {}) => {
      const out = {};
      const igdb = clampArray(identifiers.igdb).map((id) => String(id));
      const slug = clampArray(identifiers.slug).map((id) => String(id));
      const upc = clampArray(identifiers.upc).map((code) => normalizeString(code));
      if (igdb.length) {
        out.igdb = { gameId: Array.from(new Set(igdb)) };
      }
      if (slug.length) {
        out.igdb = Object.assign(out.igdb || {}, {
          slug: Array.from(new Set(slug)),
        });
      }
      if (upc.length) {
        out.upc = Array.from(new Set(upc));
      }
      return out;
    };

    corrections.forEach((corr, index) => {
      const entryId = normalizeString(corr.inputId);
      if (entryId) handledIds.add(entryId);
      const referenceEntry = entryId ? idToUnresolved.get(entryId) : null;
      const fallbackEntry = trimmed[index] || null;
      const original =
        referenceEntry?.input ||
        fallbackEntry?.unresolved?.input ||
        unresolved[index]?.input || {};

      const baseTitle = normalizeString(corr.title || original.name || original.title);
      if (!baseTitle) {
        results.push({ status: 'unresolved', input: original });
        return;
      }

      const baseDeveloper = normalizeString(
        corr.developer ||
          corr.primaryCreator ||
          original.primaryCreator ||
          original.developer,
      );

      const platforms = clampArray(corr.platforms).map(normalizeString);
      const genres = clampArray(corr.genres).map(normalizeString);
      const tags = uniqueStrings([
        ...clampArray(corr.tags).map(normalizeString),
        ...(Array.isArray(original.tags) ? original.tags : []),
      ]);

      const images = [];
      const coverFront = normalizeString(corr.coverImage);
      if (coverFront) {
        images.push({
          kind: 'cover',
          urlLarge: coverFront,
          urlMedium: coverFront,
          urlSmall: coverFront,
          provider: 'openai',
        });
      }
      const coverBack = normalizeString(corr.coverImageBack);
      if (coverBack) {
        images.push({
          kind: 'cover-back',
          urlLarge: coverBack,
          urlMedium: coverBack,
          urlSmall: coverBack,
          provider: 'openai',
        });
      }

      const identifiers = normalizeIdentifiers(corr.identifiers);

      const collectable = {
        kind: 'game',
        type: 'game',
        title: baseTitle,
        description: normalizeString(corr.description) || null,
        primaryCreator: normalizeString(corr.primaryCreator || baseDeveloper) || null,
        creators: baseDeveloper ? [baseDeveloper] : [],
        developer: baseDeveloper || null,
        publisher: normalizeString(corr.publisher) || null,
        year: corr.year ? String(corr.year) : original.year || null,
        region: normalizeString(corr.region) || original.region || null,
        systemName: platforms.length ? platforms[0] : original.systemName || null,
        urlCoverFront: coverFront || null,
        urlCoverBack: coverBack || null,
        genre: genres,
        tags,
        identifiers,
        images,
        physical: {
          format: normalizeString(corr.format) || original.format || 'physical',
          extras: {},
        },
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

      const lwf =
        makeLightweightFingerprint({
          title: collectable.title,
          primaryCreator: collectable.primaryCreator,
        }) || null;
      collectable.lightweightFingerprint = lwf;
      collectable.fingerprint =
        makeCollectableFingerprint({
          title: collectable.title,
          primaryCreator: collectable.primaryCreator,
          releaseYear: collectable.year,
          mediaType: 'game',
          platforms: collectable.systemName ? [collectable.systemName] : undefined,
        }) || null;

      results.push({
        status: 'resolved',
        input: original,
        enrichment: { __collectable: true, collectable },
      });
    });

    for (const entry of trimmed) {
      const entryId = entry.payload.inputId;
      if (entryId && handledIds.has(entryId)) continue;
      results.push({ status: 'unresolved', input: entry.unresolved.input });
    }

    for (const entry of overflow) {
      results.push({ status: 'unresolved', input: entry.unresolved.input });
    }

    for (const entry of skipped) {
      results.push({ status: 'unresolved', input: entry.input });
    }

    return results;
  }

  safeGetOutputText(response) {
    if (!response) return '';
    if (Array.isArray(response.output_text)) {
      return response.output_text.join('\n');
    }
    if (typeof response.output_text === 'string') {
      return response.output_text;
    }
    const textNode = response.output?.find?.(
      (entry) => entry?.content && Array.isArray(entry.content),
    );
    if (textNode) {
      const buffer = [];
      for (const piece of textNode.content) {
        if (piece?.text) buffer.push(piece.text);
      }
      return buffer.join('\n');
    }
    return '';
  }

  coerceCorrectionsArray(rawText) {
    if (!rawText) return [];
    try {
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
      return JSON.parse(rawText);
    } catch (err) {
      return [];
    }
  }

  buildCollectablePayload(entry, item, lightweightFingerprint) {
    if (!entry || entry.status !== 'resolved' || !entry.enrichment) return null;

    if (entry.enrichment.__collectable) {
      const collectable = { ...(entry.enrichment.collectable || {}) };
      collectable.kind = collectable.kind || 'game';
      collectable.type = collectable.type || 'game';
      collectable.lightweightFingerprint =
        collectable.lightweightFingerprint || lightweightFingerprint || null;
      if (!collectable.fingerprint) {
        collectable.fingerprint =
          makeCollectableFingerprint({
            title: collectable.title,
            primaryCreator: collectable.primaryCreator,
            releaseYear: collectable.year,
            mediaType: collectable.type || collectable.kind,
            platforms: collectable.systemName ? [collectable.systemName] : undefined,
          }) || null;
      }
      collectable.images = Array.isArray(collectable.images)
        ? collectable.images
        : collectable.images
        ? [collectable.images]
        : [];
      collectable.tags = Array.isArray(collectable.tags)
        ? collectable.tags
        : collectable.tags
        ? [collectable.tags]
        : [];
      collectable.sources = Array.isArray(collectable.sources)
        ? collectable.sources
        : collectable.sources
        ? [collectable.sources]
        : [];
      collectable.identifiers = collectable.identifiers || {};
      collectable.physical = collectable.physical || {};
      return collectable;
    }

    if (entry.enrichment.provider === 'igdb' && entry.enrichment.game) {
      return this.mapIgdbGameToCollectable(
        entry.enrichment.game,
        item,
        lightweightFingerprint,
        entry.enrichment.score,
      );
    }

    return null;
  }

  async getAccessToken(options = {}) {
    const forceRefresh = options.forceRefresh || false;
    if (!this.clientId || !this.clientSecret) return null;

    const now = Date.now();
    if (!forceRefresh && this._token && this._tokenExpiresAt > now + 60000) {
      return this._token;
    }

    const params = new URLSearchParams();
    params.set('client_id', this.clientId);
    params.set('client_secret', this.clientSecret);
    params.set('grant_type', 'client_credentials');

    const response = await fetch(this.authUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `IGDB auth failed with ${response.status}: ${text.slice(0, 200)}`,
      );
    }

    const data = await response.json();
    this._token = data.access_token || null;
    this._tokenExpiresAt = data.expires_in
      ? now + Number(data.expires_in) * 1000
      : now + 3600 * 1000;
    return this._token;
  }

  async callIgdb(endpoint, query) {
    const token = await this.getAccessToken();
    if (!token) return null;

    const url = `${this.baseUrl.replace(/\/$/, '')}/${endpoint.replace(/^\//, '')}`;
    const controller = AbortController ? new AbortController() : null;
    const timeout = controller
      ? setTimeout(() => controller.abort(), this.timeoutMs)
      : null;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Client-ID': this.clientId,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'text/plain',
          Accept: 'application/json',
        },
        body: query,
        signal: controller ? controller.signal : undefined,
      });

      if (res.status === 401) {
        this._token = null;
        this._tokenExpiresAt = 0;
        throw new Error('401 Unauthorized');
      }

      if (res.status === 429) {
        throw new Error('429 Too Many Requests');
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(
          `IGDB request failed with ${res.status}: ${text.slice(0, 200)}`,
        );
      }

      return await res.json();
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('IGDB request aborted');
      }
      throw err;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}

module.exports = { GameCatalogService };
