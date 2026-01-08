const jwt = require('jsonwebtoken');

const User = require('../models/User');
const Shelf = require('../models/Shelf');
const UserCollection = require('../models/UserCollection');
const EventLog = require('../models/EventLog');

const {
  buildOpenIdLoginUrl,
  verifyOpenIdResponse,
  getPlayerSummary,
  getOwnedGames,
  ensureCollectableForSteamGame,
  normalizeReturnUrl,
} = require('../services/steam/steamService');

const DEFAULT_IMPORT_LIMIT = 250;

function ensureJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    const err = new Error('JWT_SECRET must be configured to link Steam accounts');
    err.code = 'JWT_SECRET_MISSING';
    throw err;
  }
  return secret;
}

function signLinkState(userId, metadata = {}) {
  const secret = ensureJwtSecret();
  const payload = { sub: userId, purpose: 'steam-link' };
  if (metadata && typeof metadata === 'object') {
    if (metadata.clientReturnTo) payload.clientReturnTo = metadata.clientReturnTo;
    if (metadata.returnTo) payload.returnTo = metadata.returnTo;
  }
  return jwt.sign(payload, secret, { expiresIn: '10m' });
}

function verifyLinkState(token) {
  const secret = ensureJwtSecret();
  const payload = jwt.verify(token, secret);
  if (payload.purpose !== 'steam-link') {
    throw new Error('Invalid Steam link state token');
  }
  return payload;
}

function mapVisibility(state) {
  if (state === 3) return 'public';
  if (state === 2) return 'friends';
  return 'private';
}

function sanitizeSteam(steam) {
  if (!steam) return null;
  return {
    steamId: steam.steamId,
    personaName: steam.personaName,
    profileUrl: steam.profileUrl,
    avatar: steam.avatar,
    avatarMedium: steam.avatarMedium,
    avatarFull: steam.avatarFull,
    countryCode: steam.countryCode,
    visibilityState: steam.visibilityState ?? null,
    visibility: steam.visibility || mapVisibility(steam.visibilityState),
    linkedAt: steam.linkedAt,
    lastSyncedAt: steam.lastSyncedAt,
    lastImportedAt: steam.lastImportedAt,
    totalGames: steam.totalGames ?? null,
    lastShelfId: steam.lastShelfId || null,
    optedIntoLibrarySync: steam.optedIntoLibrarySync !== false,
  };
}

async function getStatus(req, res) {
  const user = await User.findById(req.user.id).select('steam');
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ steam: sanitizeSteam(user.steam) });
}

async function startLink(req, res) {
  try {
    const body = req.body ?? {};
    const fallbackReturnUrl = process.env.STEAM_OPENID_RETURN_URL;
    const requestedReturnUrl = body.returnUrl || body.redirectUri || fallbackReturnUrl;
    if (!requestedReturnUrl) {
      return res.status(400).json({ error: 'returnUrl is required' });
    }
    const { url: sanitizedReturnUrl, usingFallback } = normalizeReturnUrl(requestedReturnUrl, fallbackReturnUrl);
    if (usingFallback && requestedReturnUrl) {
      sanitizedReturnUrl.searchParams.set('client_return_to', requestedReturnUrl);
    }
    const sanitizedReturnTo = sanitizedReturnUrl.toString();
    const state = signLinkState(req.user.id, {
      clientReturnTo: requestedReturnUrl,
      returnTo: sanitizedReturnTo,
    });
    const { redirectUrl, returnTo, realm } = buildOpenIdLoginUrl({
      returnTo: sanitizedReturnTo,
      realm: body.realm || process.env.STEAM_OPENID_REALM,
      state,
    });
    const payload = { redirectUrl, state, returnTo, realm };
    if (requestedReturnUrl) {
      payload.requestedReturnTo = requestedReturnUrl;
    }
    res.json(payload);
  } catch (err) {
    console.error('[steam] startLink failed', err);
    const status = err.code === "JWT_SECRET_MISSING" ? 500 : 500;
    res.status(status).json({ error: err.message || "Failed to initiate Steam linking" });
  }
}

async function completeLink(req, res) {
  try {
    const body = req.body ?? {};
    const state = body.state || body.linkState;
    const params = body.params || body.query || body.openid;
    if (!state || !params) {
      return res.status(400).json({ error: 'state and params are required' });
    }
    const payload = verifyLinkState(state);
    if (payload.sub !== req.user.id) {
      return res.status(403).json({ error: 'State token does not match user' });
    }
    const { steamId } = await verifyOpenIdResponse(params);
    const existingUser = await User.findOne({ 'steam.steamId': steamId, _id: { $ne: req.user.id } }).select('_id');
    if (existingUser) {
      return res.status(409).json({ error: 'Steam account already linked to another user' });
    }
    const profile = await getPlayerSummary(steamId);
    const now = new Date();
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const previous = user.steam || {};
    user.steam = {
      steamId,
      personaName: profile?.personaname || previous.personaName || null,
      profileUrl: profile?.profileurl || previous.profileUrl || null,
      avatar: profile?.avatar || previous.avatar || null,
      avatarMedium: profile?.avatarmedium || previous.avatarMedium || null,
      avatarFull: profile?.avatarfull || previous.avatarFull || null,
      countryCode: profile?.loccountrycode || previous.countryCode || null,
      visibilityState: profile?.communityvisibilitystate ?? previous.visibilityState ?? null,
      visibility: mapVisibility(profile?.communityvisibilitystate) || previous.visibility || 'private',
      linkedAt: previous.linkedAt || now,
      lastSyncedAt: now,
      lastImportedAt: previous.lastImportedAt || null,
      totalGames: previous.totalGames ?? null,
      lastShelfId: previous.lastShelfId || null,
      optedIntoLibrarySync: previous.optedIntoLibrarySync !== false,
    };
    user.markModified('steam');
    await user.save();
    res.json({ steam: sanitizeSteam(user.steam) });
  } catch (err) {
    console.error('[steam] completeLink failed', err);
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(400).json({ error: 'Invalid or expired state token' });
    }
    if (err.message && err.message.includes("validation")) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: err.message || "Failed to complete Steam linking" });
  }
}

async function unlinkAccount(req, res) {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.steam) {
    user.set('steam', undefined);
    user.markModified('steam');
    await user.save();
  }
  res.json({ steam: null });
}

async function importLibrary(req, res) {
  try {
    const body = req.body ?? {};
    const shelfId = body.shelfId || body.shelf || null;
    if (!shelfId) return res.status(400).json({ error: 'shelfId is required' });
    const includeFreeGames = body.includeFreeGames !== false;
    const limitRaw = body.maxItems ?? body.limit ?? DEFAULT_IMPORT_LIMIT;
    const dryRun = body.dryRun === true;
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.steam || !user.steam.steamId) {
      return res.status(400).json({ error: 'Steam account is not linked' });
    }
    const shelf = await Shelf.findOne({ _id: shelfId, owner: req.user.id });
    if (!shelf) return res.status(404).json({ error: 'Shelf not found' });
    const { total, games } = await getOwnedGames(user.steam.steamId, {
      includeAppInfo: true,
      includeFreeGames,
    });
    if (!games.length) {
      return res.json({
        summary: { imported: 0, skippedExisting: 0, errors: [] },
        totalGames: total,
        shelfId: shelf._id,
        dryRun,
      });
    }
    let maxItems = Number(limitRaw);
    if (!Number.isFinite(maxItems) || maxItems <= 0) {
      maxItems = games.length;
    }
    const selected = games.slice(0, Math.min(maxItems, games.length));
    const summary = { imported: 0, skippedExisting: 0, errors: [] };
    const importedSamples = [];
    if (!dryRun) {
      for (const game of selected) {
        try {
          const collectable = await ensureCollectableForSteamGame(game);
          if (!collectable) {
            summary.errors.push({ appId: game.appid, name: game.name, message: 'Collectable creation failed' });
            continue;
          }
          const exists = await UserCollection.findOne({
            user: req.user.id,
            shelf: shelf._id,
            collectable: collectable._id,
          }).select('_id');
          if (exists) {
            summary.skippedExisting += 1;
            continue;
          }
          await UserCollection.create({
            user: req.user.id,
            shelf: shelf._id,
            collectable: collectable._id,
            format: 'Digital',
            notes: `Imported from Steam on ${new Date().toISOString()}`,
          });
          summary.imported += 1;
          if (importedSamples.length < 5) {
            importedSamples.push({ appId: game.appid, collectableId: collectable._id });
          }
        } catch (error) {
          console.error('[steam] import error', { appId: game.appid, error });
          summary.errors.push({ appId: game.appid, name: game.name, message: error.message || 'Unknown error' });
        }
      }
      const now = new Date();
      user.steam = Object.assign({}, user.steam || {}, {
        lastImportedAt: now,
        lastSyncedAt: now,
        totalGames: total,
        lastShelfId: shelf._id,
      });
      user.markModified('steam');
      await user.save();
      if (summary.imported) {
        await EventLog.create({
          user: req.user.id,
          shelf: shelf._id,
          type: 'steam.library_imported',
          payload: {
            imported: summary.imported,
            skippedExisting: summary.skippedExisting,
            totalGames: total,
            importedSamples,
          },
        });
      }
    } else {
      summary.preview = selected.slice(0, 10).map((game) => ({ appId: game.appid, name: game.name }));
    }
    res.json({
      summary,
      totalGames: total,
      processed: selected.length,
      shelfId: shelf._id,
      dryRun,
    });
  } catch (err) {
    console.error('[steam] importLibrary failed', err);
    res.status(err.code === "STEAM_API_KEY_MISSING" ? 500 : 500).json({
      error: err.message || 'Failed to import Steam library',
    });
  }
}

module.exports = {
  getStatus,
  startLink,
  completeLink,
  unlinkAccount,
  importLibrary,
};