const COMBINING_MARKS_RE = /[\u0300-\u036f]/g;
const NON_ALNUM_RE = /[^a-z0-9]+/g;
const WHITESPACE_RE = /\s+/g;

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

export function normalizeSearchText(value) {
  return foldLatinText(value)
    .replace(NON_ALNUM_RE, ' ')
    .trim()
    .replace(WHITESPACE_RE, ' ');
}
