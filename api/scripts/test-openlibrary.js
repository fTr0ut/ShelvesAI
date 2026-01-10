const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const {
  searchAndHydrateBooks,
  lookupWorkBookMetadata,
  lookupWorkByISBN,
  hydrateWorkByKey,
} = require('../services/openLibrary');

function argMap(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a && a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      args[k] = v;
    }
  }
  return args;
}

function pickFirstString(value) {
  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === 'string' ? v.trim() : '')).find(Boolean) || null;
  }
  if (typeof value === 'string') return value.trim() || null;
  return null;
}

function parseJsonInput(raw) {
  if (!raw) return null;
  if (typeof raw !== 'string') return raw;
  const resolved = path.resolve(process.cwd(), raw);
  if (fs.existsSync(resolved)) {
    const contents = fs.readFileSync(resolved, 'utf8');
    return JSON.parse(contents);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    const example = 'node scripts/test-openlibrary.js \'{ "title": "The UNWANTED MARRIAGE", "author": "CATHARINA MAURA" }\'';
    const hint = 'On PowerShell, wrap JSON in single quotes or use --input with a here-string.';
    throw new Error(`Invalid JSON input. ${hint} Example: ${example}`);
  }
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data.trim()));
    process.stdin.on('error', reject);
  });
}

function normalizeItems(input) {
  if (Array.isArray(input)) return input;
  if (input && Array.isArray(input.items)) return input.items;
  return input ? [input] : [];
}

function normalizeItemFields(item) {
  const identifiers = item && typeof item === 'object' ? item.identifiers || {} : {};
  const openLibrary = identifiers && typeof identifiers === 'object' ? identifiers.openlibrary || {} : {};

  const title = pickFirstString(item?.title || item?.name) || null;
  const author = pickFirstString(item?.author || item?.primaryCreator || item?.creator) || null;
  const isbn =
    pickFirstString(item?.isbn) ||
    pickFirstString(item?.isbn13) ||
    pickFirstString(item?.isbn10) ||
    pickFirstString(identifiers?.isbn13) ||
    pickFirstString(identifiers?.isbn10) ||
    null;
  const workKey =
    pickFirstString(item?.workKey || item?.workId || item?.openLibraryId || item?.openLibraryKey) ||
    pickFirstString(openLibrary?.work) ||
    null;

  return { title, author, isbn, workKey };
}

function parseLimit(value, fallback = 5) {
  const parsed = parseInt(value, 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return fallback;
}

async function runLookup({ mode, item, limit }) {
  const { title, author, isbn, workKey } = normalizeItemFields(item);
  let modeUsed = mode;

  if (modeUsed === 'auto') {
    if (workKey) modeUsed = 'work';
    else if (isbn) modeUsed = 'isbn';
    else modeUsed = 'lookup';
  }

  switch (modeUsed) {
    case 'work': {
      if (!workKey) throw new Error('Missing work key/id for work mode');
      return { mode: modeUsed, input: { workKey }, result: await hydrateWorkByKey(workKey) };
    }
    case 'isbn': {
      if (!isbn) throw new Error('Missing isbn/isbn13/isbn10 for isbn mode');
      return { mode: modeUsed, input: { isbn }, result: await lookupWorkByISBN(isbn) };
    }
    case 'search': {
      if (!title && !author) throw new Error('Missing title/author for search mode');
      const itemLimit = parseLimit(item?.limit, limit);
      return {
        mode: modeUsed,
        input: { title, author, limit: itemLimit },
        result: await searchAndHydrateBooks({ title, author, limit: itemLimit }),
      };
    }
    case 'lookup':
    default: {
      if (!title && !author) throw new Error('Missing title/author for lookup mode');
      return {
        mode: 'lookup',
        input: { title, author },
        result: await lookupWorkBookMetadata({ title, author }),
      };
    }
  }
}

async function main() {
  const args = argMap(process.argv);
  const inputArg = args.input || args.file || process.argv[2];
  const mode = String(args.mode || 'auto').toLowerCase();
  const limit = parseLimit(args.limit, 5);

  if (!inputArg || mode === 'help') {
    console.log('Usage: node scripts/test-openlibrary.js <json-or-path> [--mode auto|lookup|search|isbn|work] [--limit 5]');
    console.log('Tip (PowerShell): wrap JSON in single quotes or use --input with a here-string.');
    console.log('Input can be a JSON string, a file path, an array, or an object with { "items": [...] }.');
    if (process.stdin.isTTY) {
      process.exit(inputArg ? 0 : 1);
    }
  }

  let rawInput = inputArg;
  if (!rawInput || rawInput === '-' || args.stdin === true) {
    rawInput = await readStdin();
  }

  let parsed;
  try {
    parsed = parseJsonInput(rawInput);
  } catch (err) {
    console.error(err?.message || String(err));
    process.exit(1);
  }
  const items = normalizeItems(parsed);
  if (!items.length) {
    console.error('No items found in input.');
    process.exit(1);
  }

  const results = [];
  for (const item of items) {
    try {
      const output = await runLookup({ mode, item, limit });
      results.push(output);
    } catch (err) {
      results.push({
        mode,
        input: item,
        error: err?.message || String(err),
      });
    }
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
