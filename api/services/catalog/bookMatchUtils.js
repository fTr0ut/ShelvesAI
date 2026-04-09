const TITLE_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'at',
  'by',
  'for',
  'from',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);

const VARIANT_DISTINGUISHING_TOKENS = new Set([
  'again',
  'anniversary',
  'book',
  'books',
  'collection',
  'complete',
  'deluxe',
  'edition',
  'expanded',
  'extended',
  'forever',
  'later',
  'part',
  'returns',
  'revisited',
  'special',
  'volume',
  'vol',
]);

function normalizeString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function normalizeComparison(value) {
  return normalizeString(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function compactComparison(value) {
  return normalizeComparison(value).replace(/\s+/g, '');
}

function tokenizeComparison(value) {
  const normalized = normalizeComparison(value);
  return normalized ? normalized.split(/\s+/).filter(Boolean) : [];
}

function getSignificantTitleTokens(value) {
  return tokenizeComparison(value).filter((token) => !TITLE_STOPWORDS.has(token));
}

function normalizeCandidateAuthors(candidate) {
  const authors = [];
  const pushIfPresent = (value) => {
    const normalized = normalizeString(value);
    if (normalized) authors.push(normalized);
  };

  pushIfPresent(candidate?.primaryCreator);
  pushIfPresent(candidate?.primaryAuthor);
  pushIfPresent(candidate?.author);

  if (Array.isArray(candidate?.creators)) {
    candidate.creators.forEach(pushIfPresent);
  }
  if (Array.isArray(candidate?.authors)) {
    candidate.authors.forEach((entry) => {
      if (typeof entry === 'string') pushIfPresent(entry);
      else pushIfPresent(entry?.name);
    });
  }
  if (Array.isArray(candidate?.authorsDetailed)) {
    candidate.authorsDetailed.forEach((entry) => pushIfPresent(entry?.name));
  }
  if (Array.isArray(candidate?.contributions)) {
    candidate.contributions.forEach((entry) => pushIfPresent(entry?.author?.name));
  }
  if (candidate?.book) {
    return normalizeCandidateAuthors(candidate.book);
  }

  return Array.from(new Set(authors));
}

function extractCandidateIdentifiers(candidate) {
  if (candidate?.identifiers && typeof candidate.identifiers === 'object') {
    return candidate.identifiers;
  }
  if (candidate?.edition) {
    return {
      isbn10: candidate.edition.isbn_10 || candidate.edition.isbn10 || [],
      isbn13: candidate.edition.isbn_13 || candidate.edition.isbn13 || [],
    };
  }
  return {};
}

function normalizeIdentifierSet(values = []) {
  const normalized = new Set();
  const queue = Array.isArray(values) ? values : [values];
  for (const value of queue) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      value.forEach((entry) => normalized.add(normalizeIdentifier(entry)));
      continue;
    }
    if (typeof value === 'object') {
      Object.values(value).forEach((entry) => normalized.add(normalizeIdentifier(entry)));
      continue;
    }
    normalized.add(normalizeIdentifier(value));
  }
  normalized.delete('');
  return normalized;
}

function normalizeIdentifier(value) {
  return normalizeString(value).replace(/[^0-9Xx]/g, '').toUpperCase();
}

function hasMatchingIsbn(expectedIdentifiers = {}, candidateIdentifiers = {}) {
  const expected = normalizeIdentifierSet([
    expectedIdentifiers?.isbn13,
    expectedIdentifiers?.isbn10,
  ]);
  if (!expected.size) return false;

  const candidate = normalizeIdentifierSet([
    candidateIdentifiers?.isbn13,
    candidateIdentifiers?.isbn10,
  ]);

  for (const isbn of expected) {
    if (candidate.has(isbn)) return true;
  }
  return false;
}

function levenshteinDistance(a, b) {
  if (a === b) return 0;
  const aLen = a.length;
  const bLen = b.length;
  if (!aLen) return bLen;
  if (!bLen) return aLen;

  const previous = new Array(bLen + 1);
  const current = new Array(bLen + 1);
  for (let j = 0; j <= bLen; j++) previous[j] = j;

  for (let i = 1; i <= aLen; i++) {
    current[0] = i;
    for (let j = 1; j <= bLen; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost,
      );
    }
    for (let j = 0; j <= bLen; j++) previous[j] = current[j];
  }

  return previous[bLen];
}

function tokenSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (!maxLen) return 0;
  return 1 - (levenshteinDistance(a, b) / maxLen);
}

function isRomanNumeral(token) {
  return /^[ivxlcdm]+$/i.test(token);
}

function isMeaningfulVariantToken(token) {
  if (!token) return false;
  if (/^\d+$/.test(token)) return true;
  if (isRomanNumeral(token)) return true;
  return VARIANT_DISTINGUISHING_TOKENS.has(token);
}

function compareTokenSets(expectedTokens, candidateTokens, minSimilarity = 0.84) {
  const matchedCandidateIndexes = new Set();
  let matchedCount = 0;
  let similarityTotal = 0;
  const unmatchedExpectedTokens = [];

  for (const expectedToken of expectedTokens) {
    let bestIndex = -1;
    let bestScore = 0;
    for (let index = 0; index < candidateTokens.length; index++) {
      if (matchedCandidateIndexes.has(index)) continue;
      const similarity = tokenSimilarity(expectedToken, candidateTokens[index]);
      if (similarity > bestScore) {
        bestScore = similarity;
        bestIndex = index;
      }
    }

    if (bestIndex >= 0 && bestScore >= minSimilarity) {
      matchedCandidateIndexes.add(bestIndex);
      matchedCount += 1;
      similarityTotal += bestScore;
    } else {
      unmatchedExpectedTokens.push(expectedToken);
    }
  }

  const unmatchedCandidateTokens = candidateTokens.filter((_, index) => !matchedCandidateIndexes.has(index));
  const avgSimilarity = matchedCount > 0 ? similarityTotal / matchedCount : 0;

  return {
    matchedCount,
    coverage: expectedTokens.length ? matchedCount / expectedTokens.length : 0,
    precision: candidateTokens.length ? matchedCount / candidateTokens.length : 0,
    avgSimilarity,
    unmatchedExpectedTokens,
    unmatchedCandidateTokens,
    sameLength: expectedTokens.length === candidateTokens.length,
  };
}

function isStrongBookAuthorMatch(expectedAuthor, candidateAuthors = []) {
  const expected = normalizeString(expectedAuthor);
  if (!expected) return true;
  const normalizedExpected = normalizeComparison(expected);
  const compactExpected = compactComparison(expected);
  const expectedTokens = tokenizeComparison(expected);

  return candidateAuthors.some((candidate) => {
    const normalizedCandidate = normalizeComparison(candidate);
    if (!normalizedCandidate) return false;
    if (normalizedCandidate === normalizedExpected) return true;

    const compactCandidate = compactComparison(candidate);
    if (compactCandidate === compactExpected) return true;

    const candidateTokens = tokenizeComparison(candidate);
    if (!expectedTokens.length || !candidateTokens.length) return false;

    const sharedExpected = expectedTokens.filter((token) => candidateTokens.includes(token));
    const sharedCandidate = candidateTokens.filter((token) => expectedTokens.includes(token));
    const expectedCoverage = sharedExpected.length / expectedTokens.length;
    const candidateCoverage = sharedCandidate.length / candidateTokens.length;

    return expectedCoverage >= 0.75 && candidateCoverage >= 0.75;
  });
}

function extractBookCandidateInfo(candidate) {
  if (candidate?.book) {
    return extractBookCandidateInfo(candidate.book);
  }

  const title = normalizeString(candidate?.title || candidate?.name);
  const authors = normalizeCandidateAuthors(candidate);
  const identifiers = extractCandidateIdentifiers(candidate);

  return {
    title,
    authors,
    identifiers,
  };
}

function isBookCandidateRelevant(expected, candidate, options = {}) {
  const expectedTitle = normalizeString(expected?.title || expected?.name);
  const expectedAuthor = normalizeString(
    expected?.author || expected?.primaryCreator || expected?.creator,
  );
  const expectedIdentifiers = expected?.identifiers || {};
  const candidateInfo = extractBookCandidateInfo(candidate);

  if (hasMatchingIsbn(expectedIdentifiers, candidateInfo.identifiers)) {
    return { relevant: true, reason: 'isbn_match' };
  }

  if (!expectedTitle && !expectedAuthor) {
    return { relevant: true, reason: 'no_expected_query' };
  }

  const authorMatch = expectedAuthor
    ? isStrongBookAuthorMatch(expectedAuthor, candidateInfo.authors)
    : true;

  if (!expectedTitle) {
    return {
      relevant: authorMatch,
      reason: authorMatch ? 'author_only_match' : 'author_only_mismatch',
    };
  }

  if (!candidateInfo.title) {
    return { relevant: false, reason: 'missing_candidate_title' };
  }

  const normalizedExpectedTitle = normalizeComparison(expectedTitle);
  const normalizedCandidateTitle = normalizeComparison(candidateInfo.title);

  if (normalizedExpectedTitle === normalizedCandidateTitle) {
    if (!expectedAuthor || authorMatch) {
      return { relevant: true, reason: 'exact_title_match' };
    }
    return { relevant: false, reason: 'exact_title_author_mismatch' };
  }

  const expectedTokens = getSignificantTitleTokens(expectedTitle);
  const candidateTokens = getSignificantTitleTokens(candidateInfo.title);
  if (!expectedTokens.length || !candidateTokens.length) {
    return { relevant: false, reason: 'missing_significant_tokens' };
  }

  const stats = compareTokenSets(
    expectedTokens,
    candidateTokens,
    options.minTitleTokenSimilarity || 0.84,
  );
  const hasMeaningfulExtraTokens = stats.unmatchedCandidateTokens.some(isMeaningfulVariantToken);
  const expectedTokenCount = expectedTokens.length;

  if (expectedTokenCount <= 1) {
    return { relevant: false, reason: 'single_token_requires_exact_match', stats };
  }

  if (expectedTokenCount === 2) {
    const relevant = authorMatch && stats.sameLength && stats.coverage === 1 && stats.avgSimilarity >= 0.92;
    return {
      relevant,
      reason: relevant ? 'two_token_strong_match' : 'two_token_match_too_weak',
      stats,
    };
  }

  if (expectedAuthor && !authorMatch) {
    return { relevant: false, reason: 'author_mismatch', stats };
  }

  const relevant = (
    stats.coverage >= 0.8
    && stats.precision >= 0.8
    && stats.avgSimilarity >= 0.86
    && !hasMeaningfulExtraTokens
  );

  return {
    relevant,
    reason: relevant ? 'long_title_match' : 'long_title_match_too_weak',
    stats,
  };
}

module.exports = {
  TITLE_STOPWORDS,
  VARIANT_DISTINGUISHING_TOKENS,
  normalizeComparison,
  getSignificantTitleTokens,
  tokenSimilarity,
  compareTokenSets,
  isStrongBookAuthorMatch,
  isMeaningfulVariantToken,
  isBookCandidateRelevant,
  extractBookCandidateInfo,
};
