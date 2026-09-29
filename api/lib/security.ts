/**
 * Enterprise Security & Input Sanitization Utilities
 */

/**
 * Sanitizes input strings for use in Supabase/PostgREST filter clauses (.or(), .ilike(), etc.)
 * Strips or escapes commas, parentheses, colons, dots, and wildcards that could corrupt filter syntax
 */
export function sanitizePostgrestFilter(input: string): string {
  if (!input) return '';
  // Remove PostgREST operator injection characters: , ( ) [ ] { } : \
  return input
    .replace(/[,\(\)\[\]\{\}:\\\/'"]/g, ' ')
    .replace(/[%_]/g, '\\$&') // Escape SQL like wildcards
    .replace(/\s+/g, ' ')
    .trim();
}
