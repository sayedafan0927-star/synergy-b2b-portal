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
 * Creates a canonical, searchable string where homoglyphs, dimensions, and symbols
 * are harmonized for maximum search recall.
 */
export function toCanonicalSearchString(str: string): string {
  if (!str) return '';
  const lower = str.toLowerCase();
  const withNormDims = normalizeDimensions(lower);
  const withNormHomoglyphs = normalizeHomoglyphs(withNormDims);
  
  // Also keep alphanumeric collapsed version for articles (e.g. 'a-102' -> 'a102')
  const collapsedPunctuation = withNormHomoglyphs.replace(/[-_/\s]+/g, ' ');
  return `${withNormDims} ${withNormHomoglyphs} ${collapsedPunctuation}`.trim();
}

/**
 * Splits user search query into normalized search tokens.
 */
export function tokenizeSearchQuery(query: string): string[] {
  if (!query) return [];
  const clean = normalizeDimensions(query.trim().toLowerCase());
  return clean
    .split(/\s+/)
    .map(tok => normalizeHomoglyphs(tok))
    .filter(Boolean);
}

/**
 * High-speed token matching: verifies that all tokens from the user query
 * match somewhere within the searchable canonical text.
 */
export function matchesSearchTokens(searchableText: string, tokens: string[]): boolean {
  if (!tokens || tokens.length === 0) return true;
  if (!searchableText) return false;

  const canonicalTarget = toCanonicalSearchString(searchableText);
  return tokens.every(token => {
    // Direct match or homoglyph match
    if (canonicalTarget.includes(token)) return true;
    
    // Alphanumeric collapsed match (e.g. search 'a102' against 'a-102')
    const cleanToken = token.replace(/[-_\s]/g, '');
    if (cleanToken.length > 2 && canonicalTarget.replace(/[-_\s]/g, '').includes(cleanToken)) {
      return true;
    }
    return false;
  });
}
