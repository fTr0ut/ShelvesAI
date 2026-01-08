#!/usr/bin/env node
const fs = require('fs/promises');
const path = require('path');
const mongoose = require('mongoose');
const fetch = require('node-fetch');
const dotenv = require('dotenv');

const Collectable = require('../models/Collectable');

const __dirnameResolved = __dirname;

dotenv.config({ path: path.join(__dirnameResolved, '..', '.env'), override: true });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const MONGO_DB = process.env.MONGO_DB || undefined;
const CACHE_ROOT = process.env.COVER_CACHE_DIR || path.join(__dirnameResolved, '..', 'cache');
const COVER_DIR = path.join(CACHE_ROOT, 'covers');

const EXT_MAP = new Map([
  ['image/jpeg', '.jpg'],
  ['image/jpg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
]);

function extFromContentType(contentType, fallbackExt) {
  if (!contentType) return fallbackExt;
  const lower = contentType.toLowerCase().split(';')[0].trim();
  if (EXT_MAP.has(lower)) {
    return EXT_MAP.get(lower);
  }
  if (lower.includes('jpeg')) return '.jpg';
  if (lower.includes('png')) return '.png';
  if (lower.includes('webp')) return '.webp';
  if (lower.includes('gif')) return '.gif';
  return fallbackExt;
}

async function ensureDirectories() {
  await fs.mkdir(COVER_DIR, { recursive: true });
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      console.warn(`[warn] access failed for ${filePath}: ${err.message}`);
    }
    return false;
  }
}

function urlExtension(url) {
  try {
    const parsed = new URL(url);
    const ext = path.extname(parsed.pathname || '').toLowerCase();
    if (ext && ext.length <= 5) {
      return ext;
    }
  } catch (err) {
    // ignore
  }
  return '.jpg';
}

function makeFileName(collectableId, imageIndex, ext) {
  const safeId = String(collectableId);
  return `${safeId}-${imageIndex}${ext}`;
}

async function downloadToFile(url, destPath) {
  const response = await fetch(url, { timeout: 20000 });
  if (!response.ok) {
    throw new Error(`http ${response.status}`);
  }
  const buffer = await response.buffer();
  await fs.writeFile(destPath, buffer);
  return response.headers.get('content-type') || '';
}

async function upsertCachedCover(collectable, image, index) {
  if (!image || !image.urlSmall) return { skipped: true };

  const currentPath = image.cachedSmallPath ? path.join(CACHE_ROOT, image.cachedSmallPath) : null;
  if (currentPath && await fileExists(currentPath)) {
    return { skipped: true };
  }

  const guessedExt = urlExtension(image.urlSmall);
  const fileNameBase = makeFileName(collectable._id, index, guessedExt);
  let fileName = fileNameBase;
  let absolutePath = path.join(COVER_DIR, fileName);

  if (await fileExists(absolutePath)) {
    image.cachedSmallPath = path.posix.join('covers', fileName);
    return { reused: true, fileName };
  }

  let contentType;
  try {
    contentType = await downloadToFile(image.urlSmall, absolutePath);
  } catch (err) {
    throw new Error(`download failed: ${err.message}`);
  }

  const resolvedExt = extFromContentType(contentType, guessedExt);
  if (resolvedExt !== guessedExt) {
    const renamed = makeFileName(collectable._id, index, resolvedExt);
    const renamedPath = path.join(COVER_DIR, renamed);
    try {
      await fs.rename(absolutePath, renamedPath);
      fileName = renamed;
      absolutePath = renamedPath;
    } catch (err) {
      // On rename failure keep original path
      fileName = fileNameBase;
      absolutePath = path.join(COVER_DIR, fileNameBase);
    }
  }

  image.cachedSmallPath = path.posix.join('covers', fileName);
  return { downloaded: true, fileName };
}

async function main() {
  await ensureDirectories();
  await mongoose.connect(MONGO_URI, {
    dbName: MONGO_DB,
  });

  const cursor = Collectable.find({ 'images.urlSmall': { $exists: true, $ne: '' } }).cursor();
  let processed = 0;
  let downloaded = 0;
  let reused = 0;
  for await (const collectable of cursor) {
    const updates = {};
    for (let i = 0; i < collectable.images.length; i += 1) {
      const image = collectable.images[i];
      if (!image || !image.urlSmall) continue;
      try {
        const result = await upsertCachedCover(collectable, image, i);
        if (result.downloaded) {
          downloaded += 1;
        } else if (result.reused) {
          reused += 1;
        }
        if ((result.downloaded || result.reused) && image.cachedSmallPath) {
          updates[`images.${i}.cachedSmallPath`] = image.cachedSmallPath;
        }
      } catch (err) {
        console.warn(`[warn] ${collectable._id} image ${i}: ${err.message}`);
      }
    }
    const updateKeys = Object.keys(updates);
    if (updateKeys.length) {
      try {
        await Collectable.updateOne(
          { _id: collectable._id },
          { $set: updates },
          { runValidators: false },
        );
        processed += 1;
      } catch (err) {
        console.warn(`[warn] failed to update collectable ${collectable._id}: ${err.message}`);
      }
    }
  }

  console.log(`Cache complete. Updated ${processed} collectables. Downloaded ${downloaded} covers. Reused ${reused}.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('[error] cover cache script failed:', err);
  mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
