// Deep-merge identifiers where values are arrays or nested objects.
// Arrays are unioned (de-duplicated), nested objects are merged recursively.
function mergeIdentifiers(existingIds = {}, incomingIds = {}) {
  const out = JSON.parse(JSON.stringify(existingIds)); // simple deep clone

  for (const [k, v] of Object.entries(incomingIds || {})) {
    if (Array.isArray(v)) {
      const set = new Set([...(out[k] || []), ...v]);
      out[k] = Array.from(set);
      continue;
    }
    if (v && typeof v === 'object') {
      out[k] = mergeIdentifiers(out[k] || {}, v);
      continue;
    }
    out[k] = v;
  }
  return out;
}

async function upsertCollectable(Collectable, incoming) {
  if (!incoming?.kind || !incoming?.title) return null;

  // Dedup priority: provider-strong IDs â†’ global IDs â†’ fingerprint
  const or = [];

  // Open Library Work ID
  const olw = incoming.identifiers?.openlibrary?.work?.[0];
  if (olw) or.push({ 'identifiers.openlibrary.work': olw });

  // ISBN-13
  const isbn13 = incoming.identifiers?.isbn13;
  if (Array.isArray(isbn13) && isbn13.length) or.push({ 'identifiers.isbn13': { $in: isbn13 } });

  // UPC (music/games/movies)
  const upc = incoming.identifiers?.upc;
  if (Array.isArray(upc) && upc.length) or.push({ 'identifiers.upc': { $in: upc } });

  // Fallback: fingerprint
  if (incoming.fingerprint) or.push({ fingerprint: incoming.fingerprint });

  if (incoming.lightweightFingerprint) { or.push({ lightweightFingerprint: incoming.lightweightFingerprint });}

  const query = or.length ? { $or: or } : { fingerprint: incoming.fingerprint };

  const update = {
    $set: {
      kind: incoming.kind,
      title: incoming.title,
      lightweightFingerprint: incoming.lightweightFingerprint ?? null,
      subtitle: incoming.subtitle ?? null,
      description: incoming.description ?? null,

      primaryCreator: incoming.primaryCreator ?? null,
      creators: incoming.creators || [],
      year: incoming.year ?? null,
      tags: incoming.tags || [],

      physical: incoming.physical || {},

      identifiers: incoming.identifiers || {},
      images: incoming.images || [],
      editions: incoming.editions || [],
      sources: incoming.sources || [],
      extras: incoming.extras || {},

      // merge identifiers (union arrays)
      // NOTE: doing this in app code makes it easy to keep Map fields consistent
    },
    $setOnInsert: {
      fingerprint: incoming.fingerprint || null,
    },
  };

  // If you want to merge identifiers/images/sources on existing docs:
  const existing = await Collectable.findOne(query).lean();
  if (existing) {
    const incomingLwf = incoming.lightweightFingerprint || null;
    const existingLwf = existing.lightweightFingerprint || null;

    if (incomingLwf) {
      update.$set.lightweightFingerprint = existingLwf || incomingLwf;
    }

    if (incomingLwf && existingLwf === incomingLwf) {
      console.log("[collectables.upsert] matched lightweight fingerprint", {
        collectableId: String(existing._id || ""),
        lightweightFingerprint: existingLwf,
        title: existing.title || existing.name || incoming.title || "",
      });
    } else if (incomingLwf && !existingLwf) {
      console.log("[collectables.upsert] assigning lightweight fingerprint", {
        collectableId: String(existing._id || ""),
        lightweightFingerprint: incomingLwf,
        title: existing.title || existing.name || incoming.title || "",
      });
    }
    // 1) IDENTIFIERS: deep-merge nested objects & union arrays
    update.$set.identifiers = mergeIdentifiers(existing.identifiers, incoming.identifiers || {});

    // 2) IMAGES: dedupe by URL (prefer urlLarge, then medium, then small)
    const seen = new Set();
    const imgs = [...(existing.images || []), ...(incoming.images || [])].filter((img) => {
      const key = img?.urlLarge || img?.urlMedium || img?.urlSmall;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    update.$set.images = imgs;

    // 3) SOURCES: dedupe by provider + primary id (work/release/id)
    const byKey = new Map();
    for (const s of (existing.sources || []).concat(incoming.sources || [])) {
      const pid = s?.ids?.work || s?.ids?.release || s?.ids?.id || "";
      const key = `${s?.provider || "unknown"}:${pid}`;
      byKey.set(key, s);
    }
    update.$set.sources = Array.from(byKey.values());
  }


  const opts = { upsert: true, new: true, setDefaultsOnInsert: true };
  return Collectable.findOneAndUpdate(query, update, opts);
}

module.exports = { upsertCollectable };
