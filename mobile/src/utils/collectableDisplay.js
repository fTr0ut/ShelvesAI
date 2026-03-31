function toArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function toStringArray(value) {
  return toArray(value)
    .map((entry) => String(entry ?? '').trim())
    .filter(Boolean);
}

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toPositiveInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeYearValue(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;
  const match = trimmed.match(/\b(19|20)\d{2}\b/);
  if (match?.[0]) return match[0];
  return trimmed;
}

function firstNonEmpty(values) {
  for (const value of values) {
    const normalized = String(value ?? '').trim();
    if (normalized) return normalized;
  }
  return null;
}

function maxPositiveInt(values) {
  let max = null;
  for (const value of values) {
    const parsed = toPositiveInt(value);
    if (parsed == null) continue;
    if (max == null || parsed > max) max = parsed;
  }
  return max;
}

function resolveMultiplayerData(item) {
  const sources = toArray(item?.sources);
  const sourceMultiplayer = sources
    .map((entry) => entry?.raw?.multiplayer)
    .find((entry) => entry && typeof entry === 'object');
  const extrasMultiplayer = item?.extras?.igdb?.multiplayer;
  if (sourceMultiplayer && typeof sourceMultiplayer === 'object') return sourceMultiplayer;
  if (extrasMultiplayer && typeof extrasMultiplayer === 'object') return extrasMultiplayer;
  return null;
}

function resolveRatingsData(item) {
  const metascore = item?.metascore;
  if (metascore && typeof metascore === 'object' && !Array.isArray(metascore)) {
    return metascore;
  }
  const extrasRatings = item?.extras?.igdb?.ratings;
  if (extrasRatings && typeof extrasRatings === 'object' && !Array.isArray(extrasRatings)) {
    return extrasRatings;
  }
  return null;
}

function isGameType(item) {
  const raw = String(item?.kind || item?.type || '').trim().toLowerCase();
  return raw === 'game' || raw === 'games';
}

function resolveCollectableYear(item) {
  return normalizeYearValue(item?.year || item?.releaseYear || item?.publishYear);
}

function resolveCollectablePrimaryPlatform(item) {
  const platformData = toArray(item?.platformData);
  const platformDataCandidates = [];
  platformData.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    platformDataCandidates.push(entry.name, entry.abbreviation, entry.abbr);
  });
  return firstNonEmpty([
    item?.systemName,
    item?.system_name,
    item?.platform,
    ...toStringArray(item?.platforms),
    ...platformDataCandidates,
  ]);
}

function resolveCollectableMaxPlayers(item) {
  const explicit = toPositiveInt(item?.maxPlayers ?? item?.max_players);
  if (explicit != null) return explicit;
  const multiplayer = resolveMultiplayerData(item);
  if (!multiplayer) return null;
  return maxPositiveInt([
    multiplayer.maxPlayers,
    multiplayer.max_players,
    multiplayer.maxOnlinePlayers,
    multiplayer.max_online_players,
    multiplayer.maxOfflinePlayers,
    multiplayer.max_offline_players,
    multiplayer.maxOnlineCoopPlayers,
    multiplayer.max_online_coop_players,
    multiplayer.maxOfflineCoopPlayers,
    multiplayer.max_offline_coop_players,
    multiplayer.onlinemax,
    multiplayer.offlinemax,
    multiplayer.onlinecoopmax,
    multiplayer.offlinecoopmax,
  ]);
}

function resolveCollectableRating(item) {
  const ratings = resolveRatingsData(item);
  if (!ratings) return null;
  const value = toFiniteNumber(
    ratings.rating
    ?? ratings.totalRating
    ?? ratings.aggregatedRating,
  );
  return value;
}

function resolveCollectableRatingCount(item) {
  const ratings = resolveRatingsData(item);
  if (!ratings) return null;
  return toPositiveInt(
    ratings.ratingCount
    ?? ratings.totalRatingCount
    ?? ratings.aggregatedRatingCount,
  );
}

function formatCollectableSearchMeta(item) {
  const parts = [];
  const year = resolveCollectableYear(item);
  if (year) parts.push(year);

  const platform = resolveCollectablePrimaryPlatform(item);
  if (platform) parts.push(platform);

  if (isGameType(item)) {
    const maxPlayers = resolveCollectableMaxPlayers(item);
    if (maxPlayers != null) parts.push(`${maxPlayers}P`);

    const rating = resolveCollectableRating(item);
    if (rating != null) parts.push(`${rating.toFixed(1)}★`);
  }

  return parts.join(' • ');
}

export {
  isGameType,
  resolveMultiplayerData,
  resolveRatingsData,
  resolveCollectableYear,
  resolveCollectablePrimaryPlatform,
  resolveCollectableMaxPlayers,
  resolveCollectableRating,
  resolveCollectableRatingCount,
  formatCollectableSearchMeta,
};
