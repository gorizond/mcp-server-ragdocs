import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js'
import { BaseHandler } from './base-handler.js'
import type { ApiClient } from '../api-client.js'
import type { DocumentChunk, McpToolResponse } from '../types.js'
import * as cheerio from 'cheerio'
import crypto from 'crypto'
import {
  deterministicPointId,
  contentHash,
  loadContentHashes,
  saveContentHashes
} from '../dedup.js'

/**
 * Clean orphan chunks for a given URL — chunks that exist in Qdrant
 * but were NOT part of the latest re-index. Uses scroll-based pagination
 * to handle arbitrary numbers of chunks.
 */
export async function cleanOrphanChunks(apiClient: ApiClient, url: string, activeChunkIds: Set<string>): Promise<number> {
  const orphans: string[] = []
  let offset: string | number | null | undefined = null

  do {
    const scroll: Awaited<ReturnType<typeof apiClient.qdrantClient.scroll>> = await apiClient.qdrantClient.scroll('documentation', {
      filter: {
        must: [{ key: 'source_url', match: { value: url } }],
      },
      limit: 100,
      offset,
    })

    for (const point of scroll.points) {
      if (!activeChunkIds.has(point.id as string)) {
        orphans.push(point.id as string)
      }
    }
    offset = scroll.next_page_offset as string | number | null | undefined
  } while (offset)

  if (orphans.length > 0) {
    await apiClient.qdrantClient.delete('documentation', {
      wait: true,
      points: orphans,
    })
    console.log(`[RAGDocs] Cleaned ${orphans.length} orphan chunks for:`, url)
  }
  return orphans.length
}

const COLLECTION_NAME = 'documentation'

export class AddDocumentationHandler extends BaseHandler {
  async handle(args: any): Promise<McpToolResponse> {
    if (!args.url || typeof args.url !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'URL is required')
    }

    try {
      const chunks = await this.fetchAndProcessUrl(args.url)

      // Compute overall content hash from concatenated chunk texts
      const fullText = chunks.map((c) => c.text).join('\n')
      const overallContentHash = contentHash(fullText)

      // Batch process chunks for better performance
      const batchSize = 100
      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize)
        const points = await Promise.all(
          batch.map(async (chunk, chunkIndex) => {
            const embedding = await this.apiClient.getEmbeddings(chunk.text)
            return {
              id: deterministicPointId(args.url, chunkIndex),
              vector: embedding,
              payload: {
                ...chunk,
                source_url: args.url,
                chunk_index: chunkIndex,
                content_hash: overallContentHash,
                _type: 'DocumentChunk' as const
              } as Record<string, unknown>
            }
          })
        )

        try {
          await this.apiClient.qdrantClient.upsert(COLLECTION_NAME, {
            wait: true,
            points
          })
        } catch (error) {
          if (error instanceof Error) {
            if (error.message.includes('unauthorized')) {
              throw new McpError(
                ErrorCode.InvalidRequest,
                'Failed to authenticate with Qdrant cloud while adding documents'
              )
            } else if (
              error.message.includes('ECONNREFUSED') ||
              error.message.includes('ETIMEDOUT')
            ) {
              throw new McpError(
                ErrorCode.InternalError,
                'Connection to Qdrant cloud failed while adding documents'
              )
            }
          }
          throw error
        }
      }

      // Save content hash after successful indexing
      const store = loadContentHashes()
      store[args.url] = {
        hash: overallContentHash,
        indexed_at: new Date().toISOString()
      }
      saveContentHashes(store)

      // Phase 5 — US3 Orphan Cleanup: remove stale chunks that no longer
      // belong to the latest re-index. Build a Set of all actively indexed
      // chunk IDs and clean any Qdrant points outside that set.
      const activeChunkIds = new Set(
        chunks.map((_, i) => deterministicPointId(args.url, i))
      )
      await cleanOrphanChunks(this.apiClient, args.url, activeChunkIds)

      return {
        content: [
          {
            type: 'text',
            text: `Successfully added documentation from ${args.url} (${chunks.length} chunks processed in ${Math.ceil(chunks.length / batchSize)} batches)`
          }
        ]
      }
    } catch (error) {
      if (error instanceof McpError) {
        throw error
      }
      return {
        content: [
          {
            type: 'text',
            text: `Failed to add documentation: ${error}`
          }
        ],
        isError: true
      }
    }
  }

  /**
   * Fetch a URL and extract the main text content (no chunking, no embedding).
   * Used by both full indexing and content-hash check.
   */
  private async fetchAndExtractText(url: string): Promise<{ title: string; text: string }> {
    await this.apiClient.initBrowser()
    const page = await this.apiClient.browser.newPage()

    try {
      await page.goto(url, { waitUntil: 'networkidle' })
      const content = await page.content()
      const $ = cheerio.load(content)

      // Remove script tags, style tags, and comments
      $('script').remove()
      $('style').remove()
      $('noscript').remove()

      const title = $('title').text() || url
      const text = $('main, article, .content, .documentation, body').text()

      return { title, text }
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to fetch URL ${url}: ${error}`
      )
    } finally {
      await page.close()
    }
  }

  /**
   * Compute the content hash for a URL without performing full indexing.
   * Returns the SHA256 hash of the normalized text, or null on failure.
   */
  async computeContentHashForUrl(url: string): Promise<string | null> {
    try {
      const { text } = await this.fetchAndExtractText(url)
      return contentHash(text)
    } catch (error) {
      console.error('[RAGDocs] Failed to compute content hash for', url, error)
      return null
    }
  }

  private async fetchAndProcessUrl(url: string): Promise<DocumentChunk[]> {
    const { title, text } = await this.fetchAndExtractText(url)

    // Split content into chunks
    const chunks = this.chunkText(text, 1000)

    return chunks.map((chunk) => ({
      text: chunk,
      url,
      title,
      timestamp: new Date().toISOString()
    }))
  }

  private chunkText(text: string, maxChunkSize: number): string[] {
    const words = text.split(/\s+/)
    const chunks: string[] = []
    let currentChunk: string[] = []

    for (const word of words) {
      currentChunk.push(word)
      const currentLength = currentChunk.join(' ').length

      if (currentLength >= maxChunkSize) {
        chunks.push(currentChunk.join(' '))
        currentChunk = []
      }
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join(' '))
    }

    return chunks
  }

  /**
   * @deprecated Use deterministicPointId() from ../dedup.js instead.
   * Will be removed in a future version.
   */
  private generatePointId(): string {
    return crypto.randomBytes(16).toString('hex')
  }
}
