import { createHash } from 'node:crypto';

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/**
 * Validate repository-owned reviewed text whose pin predates Git EOL rules.
 * Keep the reviewed byte hash and permit only uniform LF/CRLF conversion.
 * Never use this fallback for downloaded sources or binary evidence.
 */
export function matchesReviewedTextSha256(bytes: Uint8Array, expected: string): boolean {
  if (sha256(bytes) === expected) return true;
  const buffer = Buffer.from(bytes);
  const text = buffer.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(buffer) || text.includes('\0')) return false;
  const lfText = text.replace(/\r\n/g, '\n');
  if (lfText.includes('\r')) return false;
  // A mixture is a separate edit, not a normal Git checkout conversion.
  if (text.includes('\r\n') && text.replace(/\r\n/g, '').includes('\n')) return false;
  return sha256(Buffer.from(lfText, 'utf8')) === expected
    || sha256(Buffer.from(lfText.replace(/\n/g, '\r\n'), 'utf8')) === expected;
}
