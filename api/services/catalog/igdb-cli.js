#!/usr/bin/env node
/* igdb-cli.js
 * Minimal test harness for GameCatalogService → IGDB
 *
 * Usage examples:
 *   IGDB_CLIENT_ID=xxx IGDB_CLIENT_SECRET=yyy node igdb-cli.js --title "The Legend of Zelda: A Link Between Worlds" --platform "Nintendo 3DS" --limit 3
 *   node igdb-cli.js --json --title "Ocarina of Time"
 *   node igdb-cli.js --safe --title "Super Street Fighter IV 3D Edition" --platform "Nintendo 3DS"
 *   node igdb-cli.js --raw 'fields id,name,slug,first_release_date,platforms.name,cover.image_id; search "Metroid"; limit 5;'
 */

const path = require('path');
const fs = require('fs');

const { GameCatalogService } = require('./GameCatalogService'); // keep file next to this CLI

// ---- tiny arg parser (no deps) ----
const args = process.argv.slice(2);
const flags = {};
let i = 0;
while (i < args.length) {
  const a = args[i];

  if (a === '--raw') {
    // Collect everything after --raw until the next --flag or end
    let j = i + 1;
    const parts = [];
    while (j < args.length && !args[j].startsWith('--')) {
      parts.push(args[j]);
      j++;
    }
    flags.raw = parts.join(' ');
    i = j;
    continue;
  }

  if (a.startsWith('--')) {
    const key = a.replace(/^--/, '');
    const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
    flags[key] = val;
    i += (val === true ? 1 : 2);
  } else {
    i += 1;
  }
}


const opt = {
  title: s(flags.title),
  developer: s(flags.developer),
  platform: s(flags.platform),
  publisher: s(flags.publisher),
  year: s(flags.year),
  limit: toInt(flags.limit, 8),
  json: !!flags.json,
  safe: !!flags.safe,            // use safeLookup scoring
  showQuery: !!flags.showQuery,
  safe: !!flags.safe,
  raw: s(flags.raw),             // run a raw IGDB query (overrides safe/title flow)
  timeoutMs: toInt(flags.timeoutMs, undefined),
  clientId: s(process.env.IGDB_CLIENT_ID || flags.clientId),
  clientSecret: s(process.env.IGDB_CLIENT_SECRET || flags.clientSecret),
  baseUrl: s(process.env.IGDB_BASE_URL || flags.baseUrl),
  authUrl: s(process.env.IGDB_AUTH_URL || flags.authUrl),
};
      function normalizeRawQuery(q) {
        if (!q) return q;
        // Fix common quote issues in: search <term>;
        // - If single-quoted → convert to double-quoted
        // - If unquoted → wrap in double quotes
        // - Preserve embedded quotes by escaping them
        return q.replace(/\bsearch\s+([^;]+);/i, (m, term) => {
          let t = term.trim();

          // Already double-quoted?
          if (t.startsWith('"') && t.endsWith('"')) return `search ${t};`;

          // Single-quoted? → convert
          if (t.startsWith("'") && t.endsWith("'")) {
            t = t.slice(1, -1);
          }

          // Now ensure double-quoted + escape interior quotes
          const escaped = String(t).replace(/"/g, '\\"');
          return `search "${escaped}";`;
        });
  }
async function resolvePlatformId(svc, platformArg) {
  if (!platformArg) return null;
  const maybeId = Number(platformArg);
  if (Number.isInteger(maybeId)) return maybeId;

  // Look up by name via IGDB "platforms" search
  const q = [
    `search "${platformArg}";`,
    'fields id,name,abbreviation,slug;',
    'limit 1;'
  ].join('\n');
  const rows = await svc.callIgdb('platforms', q);
  return Array.isArray(rows) && rows[0]?.id ? rows[0].id : null;
}

function s(x) { return (x == null) ? '' : String(x).trim(); }
function toInt(x, dflt) {
  const n = parseInt(x, 10);
  return Number.isFinite(n) ? n : dflt;
}

async function main() {
  if (!opt.clientId || !opt.clientSecret) {
    bail('Missing IGDB credentials. Provide IGDB_CLIENT_ID and IGDB_CLIENT_SECRET env vars or --clientId/--clientSecret flags.');
  }

  const svc = new GameCatalogService({
    clientId: opt.clientId,
    clientSecret: opt.clientSecret,
    baseUrl: opt.baseUrl || undefined,
    authUrl: opt.authUrl || undefined,
    timeoutMs: opt.timeoutMs || undefined,
    maxResults: opt.limit || undefined,
  });

  const platformId = await resolvePlatformId(svc, opt.platform);
  // after: const svc = new GameCatalogService({ ... });

    const showQuery = !!flags.showQuery || !!flags.verbose;
    if (showQuery) {
      const _callIgdb = svc.callIgdb.bind(svc);
      svc.callIgdb = async (endpoint, query) => {
        // pretty print the exact IGDB query body
        console.log('\n=== IGDB QUERY =====================================');
        console.log(`Endpoint: ${endpoint}`);
        console.log('Query:\n' + query);
        console.log('====================================================\n');
        return _callIgdb(endpoint, query);
      };
      
    }


  // 1) Raw query mode — give full IGDB DSL
    if (opt.raw) {
      const query = normalizeRawQuery(opt.raw);
      const payload = await svc.callIgdb('games', query);
      if (Array.isArray(payload) && payload.length) {
        const sample = payload[0];
        console.log('[igdb-cli] sample keys:', Object.keys(sample).slice(0, 20).join(', '));
        console.log('[igdb-cli] sample.category (raw):', sample.category);
      }
      return printResult(payload, { raw: true, json: opt.json });
    }
    

  // 2) Safe single-item lookup (title + optional hints)
  if (opt.safe) {
    if (!opt.title) bail('Safe mode requires --title');
    const item = {
      title: opt.title,
      developer: opt.developer || undefined,
      platform: opt.platform || undefined,
      publisher: opt.publisher || undefined,
      year: opt.year || undefined,
    };
    const out = await svc.safeLookup(item, 1);
    if (!out) {
      return printResult([], { message: 'No match', json: opt.json });
    }
    const game = out.game;
    const result = decorate(game);
    if (opt.json) {
      // minimal JSON
      return console.log(JSON.stringify({ score: out.score, game: result }, null, 2));
    }
    prettyPrint([result], { header: `Best match (score=${out.score})` });
    return;
  }

// Build a platform-aware query
const baseFields = 'fields id,name,slug,category,version_parent,remakes,remasters,ports,expanded_games, first_release_date,platforms.name,cover.image_id,url;'
const baseSearch = `search "${opt.title}";`;
const baseLimit  = `limit ${opt.limit || 8};`;

const whereParts = ['version_parent = null'];
if (platformId) whereParts.push(`platforms = (${platformId})`);

let query = [baseSearch, baseFields, `where ${whereParts.join(' & ')};`, baseLimit].join('\n');

let payload = await svc.callIgdb('games', query);
console.log(`[igdb-cli] rows=${Array.isArray(payload) ? payload.length : 0}`);

// After you have `payload` (and any fallbacks) resolved:

// Always show how many rows came back from IGDB
const rawCount = Array.isArray(payload) ? payload.length : 0;
console.log(`[igdb-cli] rows=${rawCount}`);

// Map to lightweight display objects
  let rows = [];
  try {
    rows = Array.isArray(payload) ? payload.map(decorate) : [];
    console.log(`[igdb-cli] mapped=${rows.length}`);
  } catch (e) {
    console.error('[igdb-cli] decorate() failed:', e?.message || e);
    rows = [];
  }

  // JSON mode → dump and return
  if (opt.json) {
    console.log(JSON.stringify({ count: rows.length, items: rows }, null, 2));
    return;
  }

  // Human-readable printing (no helper indirection, print inline)
  const header = `Results for "${opt.title}"${platformId ? ` (platform=${platformId})` : ''}`;
  console.log('\n' + header + '\n' + '='.repeat(header.length));

  if (!rows.length) {
    console.log('(no results)\n');
  } else {
    for (const it of rows) {
      console.log(`- ${it.name}${it.year ? ` (${it.year})` : ''}`);
      if (it.categoryId != null) console.log(`  Category: ${it.category} [${it.categoryId}]`);
      else if (it.rawCategory !== null && it.rawCategory !== undefined) console.log(`  Category(raw): ${it.rawCategory}`);
      if (it.platforms?.length)  console.log(`  Platforms: ${it.platforms.join(', ')}`);
      if (it.developers?.length) console.log(`  Dev: ${it.developers.join(', ')}`);
      if (it.publishers?.length) console.log(`  Pub: ${it.publishers.join(', ')}`);
      if (it.genres?.length)     console.log(`  Genres: ${it.genres.join(', ')}`);
      if (it.cover)              console.log(`  Cover: ${it.cover}`);
      if (it.url)                console.log(`  IGDB: ${it.url}`);
    }
    console.log(''); // final newline
  }
}

// ---- helpers ----
function bail(msg) {
  console.error('[igdb-cli] ' + msg);
  process.exit(1);
}

function decorate(game) {
  const coverId = game?.cover?.image_id;
  const cover = coverId ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${coverId}.jpg` : null;

  const platforms = [];
  if (Array.isArray(game.platforms)) {
    for (const p of game.platforms) {
      if (p?.name) platforms.push(p.name);
      else if (p?.abbreviation) platforms.push(p.abbreviation);
    }
  }
  const companies = { dev: [], pub: [] };
  if (Array.isArray(game.involved_companies)) {
    for (const ic of game.involved_companies) {
      const name = ic?.company?.name;
      if (!name) continue;
      if (ic.developer) companies.dev.push(name);
      if (ic.publisher) companies.pub.push(name);
    }
  }

  // Earliest release year
  const dates = [];
  if (game.first_release_date) dates.push(game.first_release_date);
  if (Array.isArray(game.release_dates)) {
    for (const rd of game.release_dates) if (rd?.date) dates.push(rd.date);
  }
  const year = dates.length ? new Date(Math.min(...dates) * 1000).getUTCFullYear() : null;
 // ---- category handling ----
  let catId = null;
  if (Object.prototype.hasOwnProperty.call(game, 'category')) {
  if (typeof game.category === 'number') catId = game.category;
  else if (typeof game.category === 'string' && /^\d+$/.test(game.category)) {
    catId = parseInt(game.category, 10);
  }
}
// Prefer IGDB category; otherwise infer
const catName = (catId != null) ? mapIgdbCategory(catId) : inferCategoryFromRelations(game);

 return {
    id: game.id,
    name: game.name,
    slug: game.slug,
    year: year || null,
    categoryId: catId,
    category: catId != null ? mapIgdbCategory(catId) : null,
    rawCategory: (game.category === 0 || game.category) ? game.category : null,
    platforms: uniq(platforms),
    developers: uniq(companies.dev),
    publishers: uniq(companies.pub),
    genres: uniq((game.genres || []).map(g => g?.name).filter(Boolean)),
    cover,
    url: game.url || null,
    summary: game.summary || null,
  };
}

function uniq(arr) {
  const seen = new Set();
  const out = [];
  for (const v of arr) {
    const k = String(v).toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}
function mapIgdbCategory(n) {
  const MAP = {
    0: 'main_game',
    1: 'dlc_addon',
    2: 'expansion',
    3: 'bundle',
    4: 'standalone_expansion',
    5: 'mod',
    6: 'episode',
    7: 'season',
    8: 'remake',
    9: 'remaster',
    10: 'expanded_game',
    11: 'port',
    12: 'fork',
  };
  return MAP[n] || 'unknown';
}


function prettyPrint(items, { header, message } = {}) {
  if (header) console.log('\n' + header + '\n' + '='.repeat(header.length));
  if (message) console.log(message);
  if (!Array.isArray(items) || !items.length) {
    console.log('(no results)');
    return;
  }
  for (const it of items) {
    console.log(`- ${it.name} ${it.year ? `(${it.year})` : ''}`);
    if (it.categoryId != null) console.log(`  Category: ${it.category} [${it.categoryId}]`);
    else if (it.rawCategory !== null && it.rawCategory !== undefined) console.log(`  Category(raw): ${it.rawCategory}`);
    if (it.platforms?.length) console.log(`  Platforms: ${it.platforms.join(', ')}`);
    if (it.developers?.length) console.log(`  Dev: ${it.developers.join(', ')}`);
    if (it.publishers?.length) console.log(`  Pub: ${it.publishers.join(', ')}`);
    if (it.genres?.length) console.log(`  Genres: ${it.genres.join(', ')}`);
    if (it.cover) console.log(`  Cover: ${it.cover}`);
    if (it.url) console.log(`  IGDB: ${it.url}`);
  }
  console.log('');
}

function inferCategoryFromRelations(game) {
  // Heuristic:
  // - If this game references a parent → it's a "version" of something (port/remake/remaster/etc.),
  //   but IGDB doesn't tell us which without inspecting the parent/children set.
  //   For a simple, conservative rule: if there's a parent, call it 'version' (or leave null).
  if (game && game.version_parent != null) {
    // You can refine this by inspecting name ("HD", "Remaster") if you want.
    return 'version';
  }

  // If this game lists children of specific kinds, it’s almost always the original/base.
  // We can confidently label it main_game.
  if (Array.isArray(game.remakes) || Array.isArray(game.remasters) ||
      Array.isArray(game.ports) || Array.isArray(game.expanded_games)) {
    return 'main_game';
  }

  // Fallback: if nothing else, and we previously filtered with `version_parent = null`,
  // treat it as main_game.
  return 'main_game';
}

function printResult(payload, { raw = false, json = false, message = '' } = {}) {
  if (json) {
    console.log(JSON.stringify({ message, payload }, null, 2));
  } else {
    if (message) console.log(message);
    if (raw) {
      console.log(Array.isArray(payload) ? `${payload.length} result(s)` : '(non-array payload)');
      prettyPrint((payload || []).map(decorate));
    } else {
      prettyPrint((payload || []).map(decorate));
    }
  }
}

main().catch((err) => {
  const msg = err?.stack || err?.message || String(err);
  console.error('[igdb-cli] Error:', msg.slice(0, 4000));
  process.exit(1);
});
