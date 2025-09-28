const { URL, URLSearchParams } = require('url');
const fetch = require('node-fetch');
const { AbortController } = fetch;

const Collectable = require('../../models/Collectable');
const { upsertCollectable } = require('../collectables.upsert');
const { makeCollectableFingerprint, makeLightweightFingerprint } = require('../collectables/fingerprint');


const STEAM_OPENID_URL = 'https://steamcommunity.com/openid/login';
const STEAM_API_BASE = 'https://api.steampowered.com';
const STEAM_STORE_BASE = 'https://store.steampowered.com/app';
const STEAM_IMAGE_CDN = 'https://cdn.cloudflare.steamstatic.com/steam/apps';

function ensureApiKey() {
  const key = (process.env.STEAM_WEB_API_KEY || process.env.STEAM_API_KEY || '').trim();
  if (!key) {
    const err = new Error('Steam Web API key not configured (set STEAM_WEB_API_KEY)');
    err.code = 'STEAM_API_KEY_MISSING';
    throw err;
  }
  return key;
}

async function callSteamApi(path, params = {}) {
  const key = ensureApiKey();
  const url = new URL(`${STEAM_API_BASE}/${path}`);
  url.searchParams.set('key', key);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    if (Array.isArray(v)) {
      url.searchParams.set(k, v.join(','));
    } else {
      url.searchParams.set(k, v);
    }
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Steam API request failed (${res.status}): ${body.slice(0, 200)}`);
    }
    return res.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Steam API request timed out');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function buildOpenIdLoginUrl({ returnTo, realm, state }) {
  if (!returnTo) throw new Error('returnTo is required to initiate Steam OpenID login');
  const returnUrl = new URL(returnTo);
  if (state) {
    returnUrl.searchParams.set('state', state);
  }
  const loginUrl = new URL(STEAM_OPENID_URL);
  loginUrl.searchParams.set('openid.ns', 'http://specs.openid.net/auth/2.0');
  loginUrl.searchParams.set('openid.mode', 'checkid_setup');
  loginUrl.searchParams.set('openid.claimed_id', 'http://specs.openid.net/auth/2.0/identifier_select');
  loginUrl.searchParams.set('openid.identity', 'http://specs.openid.net/auth/2.0/identifier_select');
  loginUrl.searchParams.set('openid.return_to', returnUrl.toString());
  const realmUrl = realm ? new URL(realm) : new URL(`${returnUrl.protocol}//${returnUrl.host}`);
  loginUrl.searchParams.set('openid.realm', `${realmUrl.protocol}//${realmUrl.host}`);
  return {
    redirectUrl: loginUrl.toString(),
    realm: loginUrl.searchParams.get('openid.realm'),
    returnTo: returnUrl.toString(),
  };
}

async function verifyOpenIdResponse(query) {
  if (!query || typeof query !== 'object') throw new Error('Missing OpenID response payload');
  const payload = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (!key.startsWith('openid.')) return;
    if (Array.isArray(value)) {
      value.forEach((v) => payload.append(key, v));
    } else {
      payload.append(key, value);
    }
  });
  if (!payload.has('openid.sig')) throw new Error('openid.sig missing from response');
  if (!payload.has('openid.claimed_id')) throw new Error('openid.claimed_id missing from response');
  payload.set('openid.mode', 'check_authentication');

  const res = await fetch(STEAM_OPENID_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: payload.toString(),
  });
  const body = await res.text();
  if (!/^is_valid:true/m.test(body)) {
    throw new Error('Steam OpenID validation failed');
  }
  const claimedId = payload.get('openid.claimed_id') || query['openid.claimed_id'];
  const match = claimedId && claimedId.match(/https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})/);
  if (!match) throw new Error('Unable to extract SteamID from OpenID response');
  return { steamId: match[1] };
}

async function getPlayerSummary(steamId) {
  if (!steamId) return null;
  const data = await callSteamApi('ISteamUser/GetPlayerSummaries/v2/', { steamids: steamId });
  const players = data?.response?.players || [];
  return players[0] || null;
}

async function resolveVanityUrl(vanity) {
  if (!vanity) return null;
  const data = await callSteamApi('ISteamUser/ResolveVanityURL/v1/', { vanityurl: vanity });
  const response = data?.response || {};
  if (response.success !== 1) return null;
  return response.steamid || null;
}

async function getOwnedGames(steamId, options = {}) {
  const { includeAppInfo = true, includeFreeGames = true, appIdsFilter } = options;
  const params = {
    steamid: steamId,
    include_appinfo: includeAppInfo ? 1 : 0,
    include_played_free_games: includeFreeGames ? 1 : 0,
  };
  if (Array.isArray(appIdsFilter) && appIdsFilter.length) {
    params.appids_filter = appIdsFilter.join(',');
  }
  const data = await callSteamApi('IPlayerService/GetOwnedGames/v1/', params);
  const response = data?.response || {};
  return {
    total: response.game_count || 0,
    games: response.games || [],
  };
}

function buildImageVariants(appId, game) {
  const images = new Map();
  const push = (key, variant) => {
    if (!variant?.urlLarge && !variant?.urlMedium && !variant?.urlSmall) return;
    images.set(key, Object.assign({ provider: 'steam', kind: key }, variant));
  };
  const header = `${STEAM_IMAGE_CDN}/${appId}/header.jpg`;
  push('header', { urlSmall: header, urlMedium: header, urlLarge: header });
  const library = `${STEAM_IMAGE_CDN}/${appId}/library_600x900.jpg`;
  push('library', { urlSmall: library, urlMedium: library, urlLarge: library });
  const capsule = `${STEAM_IMAGE_CDN}/${appId}/capsule_616x353.jpg`;
  push('capsule', { urlSmall: capsule, urlMedium: capsule, urlLarge: capsule });
  if (game?.img_logo_url) {
    const legacy = `https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/${appId}/${game.img_logo_url}.jpg`;
    push('logo', { urlSmall: legacy, urlMedium: legacy, urlLarge: legacy });
  }
  if (game?.img_icon_url) {
    const icon = `https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/${appId}/${game.img_icon_url}.jpg`;
    push('icon', { urlSmall: icon, urlMedium: icon, urlLarge: icon });
  }
  return Array.from(images.values());
}

function buildSteamCollectablePayload(game) {
  const appId = String(game.appid);
  const fingerprint = makeCollectableFingerprint({ uniqueKey: `steam:${appId}` });
  const lastPlayed = game.rtime_last_played ? new Date(game.rtime_last_played * 1000) : null;
  return {
    kind: 'game',
    type: 'game',
    title: game.name,
    description: '',
    identifiers: {
      steam: { appId: [appId] },
    },
    sources: [
      {
        provider: 'steam',
        ids: { appId },
        urls: {
          store: `${STEAM_STORE_BASE}/${appId}`,
          library: `steam://rungameid/${appId}`,
        },
        fetchedAt: new Date(),
        raw: {
          appid: game.appid,
          playtime_forever: game.playtime_forever,
          playtime_windows_forever: game.playtime_windows_forever,
          playtime_mac_forever: game.playtime_mac_forever,
          playtime_linux_forever: game.playtime_linux_forever,
          has_community_visible_stats: game.has_community_visible_stats,
          rtime_last_played: game.rtime_last_played,
        },
      },
    ],
    images: buildImageVariants(appId, game),
    extras: {
      steam: {
        appId: game.appid,
        playtimeForeverMinutes: game.playtime_forever ?? 0,
        playtimeWindowsForeverMinutes: game.playtime_windows_forever ?? 0,
        playtimeMacForeverMinutes: game.playtime_mac_forever ?? 0,
        playtimeLinuxForeverMinutes: game.playtime_linux_forever ?? 0,
        hasCommunityStats: Boolean(game.has_community_visible_stats),
        lastPlayedAt: lastPlayed ? lastPlayed.toISOString() : null,
      },
    },
    fingerprint,
    lightweightFingerprint: makeLightweightFingerprint({ uniqueKey: `steam:${appId}`, title: game.name, mediaType: 'game', platform: 'steam' }),
    tags: ['Steam'],
  };
}

async function ensureCollectableForSteamGame(game) {
  const payload = buildSteamCollectablePayload(game);
  return upsertCollectable(Collectable, payload);
}

module.exports = {
  buildOpenIdLoginUrl,
  verifyOpenIdResponse,
  getPlayerSummary,
  getOwnedGames,
  resolveVanityUrl,
  ensureCollectableForSteamGame,
};