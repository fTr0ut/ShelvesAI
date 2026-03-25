const COMBINING_MARKS_RE = /[\u0300-\u036f]/g;
const NON_ALNUM_RE = /[^a-z0-9]+/g;
const NON_ALNUM_WILDCARD_RE = /[^a-z0-9%]+/g;
const WHITESPACE_RE = /\s+/g;

// Latin-focused replacement set for SQL-side normalization (hybrid search branch).
const SQL_CHAR_CLASS_REPLACEMENTS = [
  { pattern: '[\u00E0\u00E1\u00E2\u00E3\u00E4\u00E5\u0101\u0103\u0105]', replace: 'a' },
  { pattern: '[\u00E7\u0107\u0109\u010B\u010D]', replace: 'c' },
  { pattern: '[\u00F0\u010F\u0111]', replace: 'd' },
  { pattern: '[\u00E8\u00E9\u00EA\u00EB\u0113\u0115\u0117\u0119\u011B]', replace: 'e' },
  { pattern: '[\u00EC\u00ED\u00EE\u00EF\u0129\u012B\u012D\u012F\u0131]', replace: 'i' },
  { pattern: '[\u0135]', replace: 'j' },
  { pattern: '[\u0137]', replace: 'k' },
  { pattern: '[\u013A\u013C\u013E\u0142]', replace: 'l' },
  { pattern: '[\u00F1\u0144\u0146\u0148]', replace: 'n' },
  { pattern: '[\u00F2\u00F3\u00F4\u00F5\u00F6\u00F8\u014D\u014F\u0151]', replace: 'o' },
  { pattern: '[\u0155\u0157\u0159]', replace: 'r' },
  { pattern: '[\u015B\u015D\u015F\u0161]', replace: 's' },
  { pattern: '[\u0165\u0163]', replace: 't' },
  { pattern: '[\u00F9\u00FA\u00FB\u00FC\u0169\u016B\u016D\u016F\u0171\u0173]', replace: 'u' },
  { pattern: '[\u00FD\u00FF\u0177]', replace: 'y' },
  { pattern: '[\u017E\u017A\u017C]', replace: 'z' },
  { pattern: '\u00DF', replace: 'ss' }, // sharp-s
  { pattern: '\u00E6', replace: 'ae' }, // ae ligature
  { pattern: '\u0153', replace: 'oe' }, // oe ligature
  { pattern: '\u00FE', replace: 'th' }, // thorn
];

function foldLatinText(value) {
  if (value === undefined || value === null) return '';
  return String(value)
    .normalize('NFKD')
    .replace(COMBINING_MARKS_RE, '')
    .toLowerCase()
    .replace(/\u00DF/g, 'ss')
    .replace(/\u00E6/g, 'ae')
    .replace(/\u0153/g, 'oe')
    .replace(/\u00FE/g, 'th');
}

function normalizeSearchText(value) {
  return foldLatinText(value)
    .replace(NON_ALNUM_RE, ' ')
    .trim()
    .replace(WHITESPACE_RE, ' ');
}

function normalizeSearchWildcardPattern(value) {
  const withWildcards = String(value ?? '').replace(/\*/g, '%');
  const normalized = foldLatinText(withWildcards)
    .replace(NON_ALNUM_WILDCARD_RE, ' ')
    .trim()
    .replace(WHITESPACE_RE, ' ')
    .replace(/\s*%\s*/g, '%');

  return normalized || '%';
}

function buildNormalizedSqlExpression(columnSql) {
  let expression = `lower(COALESCE(${columnSql}, ''))`;
  for (const rule of SQL_CHAR_CLASS_REPLACEMENTS) {
    expression = `regexp_replace(${expression}, '${rule.pattern}', '${rule.replace}', 'g')`;
  }
  expression = `regexp_replace(${expression}, '[^a-z0-9]+', ' ', 'g')`;
  expression = `regexp_replace(${expression}, '[[:space:]]+', ' ', 'g')`;
  expression = `btrim(${expression})`;
  return expression;
}

module.exports = {
  normalizeSearchText,
  normalizeSearchWildcardPattern,
  buildNormalizedSqlExpression,
};
