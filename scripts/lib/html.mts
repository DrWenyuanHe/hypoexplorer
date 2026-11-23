// Text escaping for the build-time HTML documents. A leaf module: it imports
// nothing, so the guide documents can escape their prose without importing the
// page renderer that consumes them.

/** Escape a value for HTML text and double- or single-quoted attributes. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}
