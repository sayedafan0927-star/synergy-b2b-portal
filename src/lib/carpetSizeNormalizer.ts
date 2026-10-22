/**
 * Carpet Size Normalizer & Canonical Clustering
 * 
 * Maps factory production variations (e.g. 2.94 × 5, 2.42 × 4, 3 × 3.8, 3.88 × 5, 3.88 × 6)
 * to clean canonical nominal industry dimensions (e.g. 3 × 5, 2.5 × 4, 3 × 4, 4 × 5, 4 × 6)
 * for catalog filters, while preserving exact physical dimensions in product cards, cart, and orders.
 */

export interface Dimension2D {
  w: number;
  l: number;
}

/**
 * Standard nominal carpet dimensions (width × length in meters)
 */
export const CANONICAL_RUG_DIMENSIONS: ReadonlyArray<[number, number]> = [
  [0.8, 1.2],
  [0.8, 1.5],
  [1.0, 1.5],
  [1.0, 2.0],
  [1.0, 3.0],
  [1.2, 1.2],
  [1.2, 1.8],
  [1.4, 2.0],
  [1.5, 2.3],
  [1.6, 1.6],
  [1.6, 2.3],
  [1.7, 2.8],
  [2.0, 3.0],
  [2.0, 4.0],
  [2.5, 3.5],
  [2.5, 4.0],
  [2.5, 4.5],
  [2.5, 5.0],
  [3.0, 4.0],
  [3.0, 5.0],
  [3.0, 6.0],
  [3.5, 5.0],
  [3.5, 6.0],
  [3.5, 7.0],
  [3.5, 8.0],
  [4.0, 4.0],
  [4.0, 5.0],
  [4.0, 6.0],
  [4.0, 7.0],
  [4.0, 8.0],
];

export const STANDARD_RUNNER_WIDTHS: ReadonlyArray<number> = [
  0.8, 1.0, 1.2, 1.5, 2.0, 2.5, 3.0, 4.0
];

/**
 * Parse a raw size string into width and length numbers
 */
export function parseDimensions(rawSize: string): Dimension2D | null {
  if (!rawSize) return null;
  const normalized = String(rawSize)
    .replace(',', '.')
    .replace(/[*xXхХ]/g, '×');
  const parts = normalized.split('×').map(s => parseFloat(s.trim()));
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1]) && parts[0] > 0 && parts[1] > 0) {
    return { w: parts[0], l: parts[1] };
  }
  return null;
}

function formatDimensionNumber(num: number): string {
  if (Number.isInteger(num)) return String(num);
  // Round to max 1 decimal place to prevent floating point noise
  const rounded = Math.round(num * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * Maps any variant size string to its canonical nominal dimension for filters.
 * Example: '2.94 × 5' -> '3 × 5', '2.42 × 4' -> '2.5 × 4', '3.88 × 6' -> '4 × 6'
 */
export function toCanonicalNominalSize(rawSize: string): string {
  if (!rawSize) return '';
  const dims = parseDimensions(rawSize);
  if (!dims) return rawSize.trim();

  const { w, l } = dims;
  const minDim = Math.min(w, l);
  const maxDim = Math.max(w, l);

  // Check if it's a runner roll (long roll length >= 10m and aspect ratio >= 2.4)
  const isRunnerRoll = maxDim / minDim >= 2.4 && minDim <= 4.0 && maxDim >= 10.0;
  if (isRunnerRoll) {
    let bestWidth = minDim;
    for (const sw of STANDARD_RUNNER_WIDTHS) {
      if (Math.abs(minDim - sw) <= 0.12 || Math.abs(minDim - sw) / sw <= 0.10) {
        bestWidth = sw;
        break;
      }
    }
    const roundedLength = Math.round(maxDim);
    return `${formatDimensionNumber(bestWidth)} × ${roundedLength}`;
  }

  // Rug matching: find closest canonical standard nominal size within tolerance
  let bestCanonical: string | null = null;
  let bestDistance = Number.MAX_VALUE;

  for (const [cw, cl] of CANONICAL_RUG_DIMENSIONS) {
    for (const [targetW, targetL] of [[cw, cl], [cl, cw]]) {
      const diffW = Math.abs(w - targetW);
      const diffL = Math.abs(l - targetL);
      // Tolerance: width within 0.22m (and <= 10%), length within 0.26m (and <= 10%)
      if (diffW <= 0.22 && diffL <= 0.26 && (diffW / targetW) <= 0.10 && (diffL / targetL) <= 0.10) {
        const dist = diffW + diffL;
        if (dist < bestDistance) {
          bestDistance = dist;
          bestCanonical = `${formatDimensionNumber(targetW)} × ${formatDimensionNumber(targetL)}`;
        }
      }
    }
  }

  if (bestCanonical) {
    return bestCanonical;
  }

  return `${formatDimensionNumber(w)} × ${formatDimensionNumber(l)}`;
}

/**
 * Checks whether a product variant's raw size matches any of the user's selected canonical sizes.
 */
export function matchesCanonicalSize(variantRawSize: string | undefined, selectedSizes: Set<string>): boolean {
  if (!selectedSizes || selectedSizes.size === 0) return true;
  if (!variantRawSize) return false;

  const rawTrimmed = variantRawSize.trim();
  if (selectedSizes.has(rawTrimmed)) return true;

  const canonical = toCanonicalNominalSize(rawTrimmed);
  if (selectedSizes.has(canonical)) return true;

  return false;
}
