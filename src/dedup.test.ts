import { expect } from 'chai';
import { deterministicPointId, contentHash, loadContentHashes, saveContentHashes } from './dedup.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

describe('dedup.ts', () => {
  describe('deterministicPointId', () => {
    it('should produce same ID for same inputs', () => {
      const id1 = deterministicPointId('https://example.com', 0);
      const id2 = deterministicPointId('https://example.com', 0);
      expect(id1).to.equal(id2);
    });

    it('should produce different IDs for different URLs', () => {
      const id1 = deterministicPointId('https://a.com', 0);
      const id2 = deterministicPointId('https://b.com', 0);
      expect(id1).to.not.equal(id2);
    });

    it('should produce different IDs for different chunk indices', () => {
      const id1 = deterministicPointId('https://example.com', 0);
      const id2 = deterministicPointId('https://example.com', 1);
      expect(id1).to.not.equal(id2);
    });

    it('should produce valid UUID v8 format', () => {
      const id = deterministicPointId('https://example.com', 5);
      expect(id).to.match(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });
  });

  describe('contentHash', () => {
    it('should produce consistent hash for same text', () => {
      expect(contentHash('hello world')).to.equal(contentHash('hello world'));
    });

    it('should produce different hash for different text', () => {
      expect(contentHash('hello')).to.not.equal(contentHash('world'));
    });

    it('should normalize whitespace', () => {
      const h1 = contentHash('hello   world');
      const h2 = contentHash('hello world');
      expect(h1).to.equal(h2);
    });

    it('should handle empty string', () => {
      const hash = contentHash('');
      expect(hash).to.match(/^[0-9a-f]{64}$/);
    });
  });

  describe('loadContentHashes / saveContentHashes', () => {
    it('should round-trip data', () => {
      const dir = mkdtempSync('/tmp/dedup-test-');
      const store = {
        'https://example.com': { hash: 'abc123', indexed_at: '2024-01-01T00:00:00Z' }
      };
      saveContentHashes(store, dir);
      const loaded = loadContentHashes(dir);
      expect(loaded).to.deep.equal(store);
      rmSync(dir, { recursive: true });
    });

    it('should return empty object on cold start', () => {
      const dir = mkdtempSync('/tmp/dedup-test-');
      const loaded = loadContentHashes(dir);
      expect(loaded).to.deep.equal({});
      rmSync(dir, { recursive: true });
    });
  });
});
