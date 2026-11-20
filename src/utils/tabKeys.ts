/**
 * Roving-tabindex keys for an automatic-activation tablist: ArrowRight and
 * ArrowLeft wrap through `count` tabs, Home and End jump to the ends. Returns
 * the index to select and focus, or null when `key` does not move the tablist.
 */
export function tabKeyTarget(key: string, index: number, count: number): number | null {
  switch (key) {
    case 'ArrowRight': return (index + 1) % count;
    case 'ArrowLeft': return (index - 1 + count) % count;
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return null;
  }
}
