import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const HASHES_FILE = 'content_hashes.json';
const TMP_SUFFIX = '.tmp';

export interface ContentHashEntry {
  hash: string;
  indexed_at: string;
}

export interface ContentHashStore {
  [url: string]: ContentHashEntry;
}

/** Deterministic UUID v8 from SHA256 of url + chunk_index */
export function deterministicPointId(url: string, chunkIndex: number): string {
  const hash = createHash('sha256')
    .update(url + '\0' + chunkIndex)
    .digest('hex');
  // Take first 16 bytes (32 hex chars), format as UUID v8
  return hash.slice(0, 8) + '-' + hash.slice(8, 12) + '-8' + hash.slice(13, 16) + '-' + formatUUIDGroup(hash.slice(16, 20)) + '-' + hash.slice(20, 32);
}

function formatUUIDGroup(hex: string): string {
  // Set variant bits (10xx) for RFC 9562 UUID
  const firstChar = hex.charAt(0);
  const nibble = parseInt(firstChar, 16);
  const variant = (nibble & 0x3) | 0x8; // 10xx
  return variant.toString(16) + hex.slice(1);
}

/** SHA256 hash of normalized text */
export function contentHash(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(normalized).digest('hex');
}

/** Load content hashes from JSON file */
export function loadContentHashes(dir: string = process.cwd()): ContentHashStore {
  const filePath = join(dir, HASHES_FILE);
  if (!existsSync(filePath)) return {};
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as ContentHashStore;
  } catch {
    return {};
  }
}

/** Save content hashes to JSON file (atomic write) */
export function saveContentHashes(store: ContentHashStore, dir: string = process.cwd()): void {
  const filePath = join(dir, HASHES_FILE);
  const tmpPath = filePath + TMP_SUFFIX;
  writeFileSync(tmpPath, JSON.stringify(store, null, 2));
  renameSync(tmpPath, filePath);
}
