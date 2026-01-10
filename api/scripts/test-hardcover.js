const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { HardcoverClient } = require('../services/hardcover');

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

function parseBoolean(value) {
  if (value === true || value === false) return value;
  if (value == null) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'y';
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
  const trimmed = raw.trim().replace(/^\uFEFF/, '');
  const normalized = trimmed
    .replace(/\u00a0/g, ' ')
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");
  const candidates = [];
  if (normalized) candidates.push(normalized);
  const hereStringMatch = normalized.match(/^@['"]([\s\S]*)['"]@$/);
  if (hereStringMatch && hereStringMatch[1]) {
    candidates.push(hereStringMatch[1].trim());
  }
  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    candidates.push(normalized.slice(1, -1).trim());
  }

  const tryParse = (value) => {
    try {
      return { ok: true, value: JSON.parse(value) };
    } catch (err) {
      return { ok: false };
    }
  };

  for (const candidate of candidates) {
    const parsed = tryParse(candidate);
    if (parsed.ok) {
      if (typeof parsed.value === 'string') {
        const inner = parsed.value.trim();
        if (
          (inner.startsWith('{') && inner.endsWith('}')) ||
          (inner.startsWith('[') && inner.endsWith(']'))
        ) {
          const nested = tryParse(inner);
          if (nested.ok) return nested.value;
        }
      }
      return parsed.value;
    }

    const relaxed = tryParseLooseJson(candidate);
    if (relaxed.ok) return relaxed.value;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    const relaxed = tryParseLooseJson(raw);
    if (relaxed.ok) return relaxed.value;
    const example = 'node scripts/test-hardcover.js \'{ "title": "Oathbringer", "author": "Brandon Sanderson" }\'';
    const hint = 'On PowerShell, wrap JSON in single quotes or use --input with a here-string.';
    throw new Error(`Invalid JSON input. ${hint} Example: ${example}`);
  }
}

function quoteBareValues(input) {
  let out = '';
  let i = 0;

  while (i < input.length) {
    const ch = input[i];
    out += ch;

    if (ch !== ':') {
      i += 1;
      continue;
    }

    let j = i + 1;
    while (j < input.length && /\s/.test(input[j])) j += 1;
    out += input.slice(i + 1, j);

    if (j >= input.length) {
      i = j;
      continue;
    }

    const next = input[j];
    if (next === '"' || next === '{' || next === '[') {
      i = j;
      continue;
    }

    if (next === "'") {
      let k = j + 1;
      while (k < input.length && input[k] !== "'") k += 1;
      const inner = input.slice(j + 1, k);
      const escaped = inner.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      out += `"${escaped}"`;
      i = k + 1;
      continue;
    }

    let k = j;
    while (k < input.length && !/[,\}\]]/.test(input[k])) k += 1;
    const raw = input.slice(j, k).trim();
    if (!raw) {
      i = k;
      continue;
    }
    if (/^(true|false|null)$/i.test(raw) || /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(raw)) {
      out += raw;
    } else {
      const escaped = raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      out += `"${escaped}"`;
    }
    i = k;
  }

  return out;
}

function tryParseLooseJson(raw) {
  if (!raw || typeof raw !== 'string') return { ok: false };
  const trimmed = raw.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
    return { ok: false };
  }

  let candidate = trimmed;
  candidate = candidate.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, inner) => {
    const escaped = inner.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `"${escaped}"`;
  });
  candidate = candidate.replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":');
  candidate = quoteBareValues(candidate);

  try {
    return { ok: true, value: JSON.parse(candidate) };
  } catch (err) {
    return { ok: false };
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
  const title = pickFirstString(item?.title || item?.name) || null;
  const author = pickFirstString(item?.author || item?.primaryCreator || item?.creator) || null;
  const isbn =
    pickFirstString(item?.isbn) ||
    pickFirstString(item?.isbn13) ||
    pickFirstString(item?.isbn10) ||
    pickFirstString(identifiers?.isbn13) ||
    pickFirstString(identifiers?.isbn10) ||
    null;

  return { title, author, isbn };
}

function parseLimit(value, fallback = 5) {
  const parsed = parseInt(value, 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return fallback;
}

async function runLookup({ mode, item, limit, client }) {
  const { title, author, isbn } = normalizeItemFields(item);
  let modeUsed = mode;

  if (modeUsed === 'auto') {
    if (isbn) modeUsed = 'isbn';
    else modeUsed = 'search';
  }

  switch (modeUsed) {
    case 'isbn': {
      if (!isbn) throw new Error('Missing isbn/isbn13/isbn10 for isbn mode');
      return { mode: modeUsed, input: { isbn }, result: await client.lookupByISBN(isbn) };
    }
    case 'search':
    default: {
      if (!title && !author) throw new Error('Missing title/author for search mode');
      return {
        mode: 'search',
        input: { title, author, limit },
        result: await client.lookupByTitleAuthor({ title, author, limit }),
      };
    }
  }
}

function getArgValueFromArgv(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const values = [];
  for (let i = idx + 1; i < process.argv.length; i++) {
    const token = process.argv[i];
    if (token && token.startsWith('--')) break;
    values.push(token);
  }
  if (!values.length) return true;
  return values.join(' ');
}

async function main() {
  const args = argMap(process.argv);
  let inputArg = args.input || args.file || process.argv[2];
  const argvInput = getArgValueFromArgv('--input');
  const argvFile = getArgValueFromArgv('--file');
  if (!inputArg || inputArg === true) {
    inputArg =
      (argvInput && argvInput !== true ? argvInput : null) ||
      (argvFile && argvFile !== true ? argvFile : null) ||
      inputArg;
  }
  const mode = String(args.mode || 'auto').toLowerCase();
  const limit = parseLimit(args.limit, 5);
  const debug = parseBoolean(args.debug || process.env.HARDCOVER_DEBUG);
  const debugAuth = parseBoolean(args['debug-auth'] || process.env.HARDCOVER_DEBUG_LOG_AUTH);

  if (!inputArg || mode === 'help') {
    console.log('Usage: node scripts/test-hardcover.js <json-or-path> [--mode auto|search|isbn] [--limit 5]');
    console.log('Tip (PowerShell): wrap JSON in single quotes or use --input with a here-string.');
    console.log('Input can be a JSON string, a file path, an array, or an object with { "items": [...] }.');
    console.log('Debug: add --debug to log the GraphQL request payload; add --debug-auth to include the token.');
    if (process.stdin.isTTY) {
      process.exit(inputArg ? 0 : 1);
    }
  }

  const client = new HardcoverClient({
    debug,
    debugLogAuth: debugAuth,
  });
  if (!client.isConfigured()) {
    console.error('Missing HARDCOVER_API_TOKEN. Add it to api/.env before running this script.');
    process.exit(1);
  }

  let rawInput = inputArg;
  if (!rawInput || rawInput === '-' || args.stdin === true) {
    rawInput = await readStdin();
  }

  let parsed;
  try {
    parsed = parseJsonInput(rawInput);
  } catch (err) {
    let fallbackParsed = null;
    const fallbackRaw =
      argvInput && argvInput !== true && argvInput !== rawInput ? argvInput : null;
    if (fallbackRaw) {
      try {
        fallbackParsed = parseJsonInput(fallbackRaw);
      } catch {
        fallbackParsed = null;
      }
    }
    if (fallbackParsed) {
      parsed = fallbackParsed;
    } else {
      console.error(err?.message || String(err));
      process.exit(1);
    }
  }
  const items = normalizeItems(parsed);
  if (!items.length) {
    console.error('No items found in input.');
    process.exit(1);
  }

  const results = [];
  for (const item of items) {
    try {
      const output = await runLookup({ mode, item, limit, client });
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
