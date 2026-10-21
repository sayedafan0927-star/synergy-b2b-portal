/**
 * Synergy B2B Portal — Enterprise Carpet Search Normalization Engine
 * 
 * Provides:
 * 1. Cyrillic <-> Latin homoglyph canonicalization (e.g. Russian 'А' -> 'a', 'С' -> 'c', 'Х' -> 'x')
 * 2. Carpet dimension normalization ('2х3', '2x3', '2*3', '2×3', '2.0x3.0' -> '2x3')
 * 3. Article punctuation stripping ('A-102' <-> 'A102' <-> 'А 102')
 * 4. High-performance sub-10ms multi-token search matcher
 */

// Homoglyph map: maps Cyrillic characters to visually identical Latin characters
const CYRILLIC_TO_LATIN_HOMOGLYPHS: Record<string, string> = {
  'а': 'a',
  'в': 'b',
  'е': 'e',
  'к': 'k',
  'м': 'm',
  'н': 'h',
  'о': 'o',
  'р': 'p',
  'с': 'c',
  'т': 't',
  'у': 'y',
  'х': 'x',
  'ё': 'e',
};

const CYRILLIC_TO_LATIN_PHONETIC: Record<string, string> = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e',
  'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
  'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
  'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch',
  'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
};

/**
 * Transliterates Cyrillic text into phonetic Latin (e.g. 'шанти' -> 'shanti', 'флора' -> 'flora').
 */
export function transliterateCyrillicToLatin(str: string): string {
  if (!str) return '';
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i].toLowerCase();
    out += CYRILLIC_TO_LATIN_PHONETIC[ch] !== undefined ? CYRILLIC_TO_LATIN_PHONETIC[ch] : ch;
  }
  return out;
}

/**
 * Normalizes Cyrillic homoglyphs to Latin canonical characters.
 */
export function normalizeHomoglyphs(str: string): string {
  if (!str) return '';
  return str.replace(/[авекмнорстухё]/gi, char => {
    const lower = char.toLowerCase();
    return CYRILLIC_TO_LATIN_HOMOGLYPHS[lower] || lower;
  });
}

/**
 * Normalizes carpet dimensions (e.g. '2х3', '2x3', '2*3', '2×3', '2.00x3.00')
 * into canonical representation without extra zeroes.
 */
export function normalizeDimensions(str: string): string {
  if (!str) return '';
  return str
    // Normalize multiplication symbols and cyrillic 'х' to standard 'x'
    .replace(/([0-9]+(?:[\.,][0-9]+)?)\s*[xхXХ*×]\s*([0-9]+(?:[\.,][0-9]+)?)/gi, (_, w, l) => {
      const cleanW = w.replace(',', '.').replace(/\.0+$/, '').replace(/(\.[0-9]*[1-9])0+$/, '$1');
      const cleanL = l.replace(',', '.').replace(/\.0+$/, '').replace(/(\.[0-9]*[1-9])0+$/, '$1');
      return `${cleanW}x${cleanL}`;
    });
}

/**
 * Creates a canonical, searchable string where homoglyphs, phonetic transliteration,
 * dimensions, and symbols are harmonized for maximum search recall.
 */
export function toCanonicalSearchString(str: string): string {
  if (!str) return '';
  const lower = str.toLowerCase();
  const withNormDims = normalizeDimensions(lower);
  const withNormHomoglyphs = normalizeHomoglyphs(withNormDims);
  const withPhonetic = transliterateCyrillicToLatin(withNormDims);

  // Also keep alphanumeric collapsed version for articles (e.g. 'a-102' -> 'a102')
  const collapsedPunctuation = withNormHomoglyphs.replace(/[-_/\s]+/g, ' ');
  return `${withNormDims} ${withNormHomoglyphs} ${withPhonetic} ${collapsedPunctuation}`.trim();
}

/**
 * Splits user search query into normalized search tokens.
 */
export function tokenizeSearchQuery(query: string): string[] {
  if (!query) return [];
  const clean = normalizeDimensions(query.trim().toLowerCase());
  return clean
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * High-speed token matching: verifies that all tokens from the user query
 * match somewhere within the searchable canonical text (via direct, homoglyph, or phonetic match).
 */
export function matchesSearchTokens(searchableText: string, tokens: string[]): boolean {
  if (!tokens || tokens.length === 0) return true;
  if (!searchableText) return false;

  const canonicalTarget = toCanonicalSearchString(searchableText);
  const collapsedTarget = canonicalTarget.replace(/[-_\s]/g, '');

  return tokens.every(rawToken => {
    const token = rawToken.toLowerCase();
    const homoglyphToken = normalizeHomoglyphs(token);
    const phoneticToken = transliterateCyrillicToLatin(token);

    if (
      canonicalTarget.includes(token) ||
      canonicalTarget.includes(homoglyphToken) ||
      (phoneticToken.length >= 2 && canonicalTarget.includes(phoneticToken))
    ) {
      return true;
    }

    const cleanHomoglyph = homoglyphToken.replace(/[-_\s]/g, '');
    if (cleanHomoglyph.length > 2 && collapsedTarget.includes(cleanHomoglyph)) {
      return true;
    }
    const cleanPhonetic = phoneticToken.replace(/[-_\s]/g, '');
    if (cleanPhonetic.length > 2 && collapsedTarget.includes(cleanPhonetic)) {
      return true;
    }
    return false;
  });
}
