const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { BookCatalogService } = require('../services/catalog/BookCatalogService');

function argMap(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const current = argv[i];
    if (!current || !current.startsWith('--')) continue;
    const key = current.slice(2);
    const next = argv[i + 1];
    const value = next && !next.startsWith('--') ? next : true;
    if (value !== true) i += 1;
    args[key] = value;
  }
  return args;
}

function parseBoolean(value) {
  if (value === true || value === false) return value;
  if (value == null) return null;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  return null;
}

function pickFirstString(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).find(Boolean) || null;
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
    const example = 'node scripts/test-book-catalog.js --title "Left of Forever" --author "Thom"';
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

function normalizeLookupItem(item) {
  const identifiers = item && typeof item === 'object' ? item.identifiers || {} : {};
  const title = pickFirstString(item?.title || item?.name) || null;
  const author =
    pickFirstString(item?.author || item?.primaryCreator || item?.creator) || null;
  const isbn =
    pickFirstString(item?.isbn) ||
    pickFirstString(item?.isbn13) ||
    pickFirstString(item?.isbn10) ||
    pickFirstString(identifiers?.isbn13) ||
    pickFirstString(identifiers?.isbn10) ||
    null;

  const output = {
    title,
    name: title,
    author,
    primaryCreator: author,
    identifiers: { ...identifiers },
  };

  if (isbn) {
    if (!output.identifiers.isbn13 && String(isbn).length === 13) {
      output.identifiers.isbn13 = [isbn];
    } else if (!output.identifiers.isbn10 && String(isbn).length === 10) {
      output.identifiers.isbn10 = [isbn];
    } else if (!output.identifiers.isbn13 && !output.identifiers.isbn10) {
      output.identifiers.isbn13 = [isbn];
    }
  }

  return output;
}

function buildItemsFromArgs(args) {
  const title = pickFirstString(args.title);
  const author = pickFirstString(args.author);
  const isbn = pickFirstString(args.isbn);
  if (!title && !author && !isbn) return [];
  return [
    normalizeLookupItem({
      title,
      author,
      identifiers: isbn ? { isbn13: [isbn] } : {},
    }),
  ];
}

function printUsage() {
  console.log('Usage: node scripts/test-book-catalog.js --title "..." --author "..."');
  console.log('  or: node scripts/test-book-catalog.js <json-or-path>');
  console.log('Flags:');
  console.log('  --input <json-or-path>');
  console.log('  --file <json-or-path>');
  console.log('  --stdin (read JSON from stdin)');
  console.log('  --title <title>');
  console.log('  --author <author>');
  console.log('  --isbn <isbn>');
  console.log('  --router true|false (override USE_CATALOG_ROUTER)');
  console.log('  --retries <number>');
}

async function main() {
  const args = argMap(process.argv);
  if (args.help || args.h) {
    printUsage();
    process.exit(0);
  }

  const inlineItems = buildItemsFromArgs(args);
  const inputArg = args.input || args.file || process.argv[2];
  const shouldReadStdin = args.stdin === true || inputArg === '-';

  let items = inlineItems;
  if (!items.length) {
    if (!inputArg && !shouldReadStdin && process.stdin.isTTY) {
      printUsage();
      process.exit(1);
    }

    const rawInput = shouldReadStdin ? await readStdin() : inputArg;
    let parsed;
    try {
      parsed = parseJsonInput(rawInput);
    } catch (err) {
      console.error(err?.message || String(err));
      process.exit(1);
    }
    items = normalizeItems(parsed);
  }

  if (!Array.isArray(items) || items.length === 0) {
    console.error('No items found in input.');
    process.exit(1);
  }

  const useRouterOverride =
    parseBoolean(args.router) ?? parseBoolean(args.useRouter) ?? null;
  const retries = Number.isFinite(Number(args.retries)) ? Number(args.retries) : undefined;

  const service = new BookCatalogService(
    useRouterOverride === null ? {} : { useRouter: useRouterOverride },
  );

  const results = [];
  for (const item of items) {
    const lookupItem = normalizeLookupItem(item);
    try {
      const result = await service.safeLookup(lookupItem, retries);
      let metadataScore = null;
      let metadataMissing = null;
      if (result && Number.isFinite(result._metadataScore)) {
        metadataScore = result._metadataScore;
        metadataMissing = result._metadataMissing || [];
      } else if (result) {
        const metadata = service.scoreBookMetadata(result, result.provider);
        metadataScore = metadata.score;
        metadataMissing = metadata.missing;
      }

      results.push({
        input: lookupItem,
        provider: result?._source || result?.provider || null,
        metadataScore,
        metadataMissing,
        result: result || null,
      });
    } catch (err) {
      results.push({
        input: lookupItem,
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
