import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import type { ApiClient } from '../api-client.js'
import { BaseHandler } from './base-handler.js'
import type { McpToolResponse } from '../types.js'
import { AddDocumentationHandler } from './add-documentation.js'
import { loadContentHashes, saveContentHashes, type ContentHashStore } from '../dedup.js'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

// Get current directory in ES modules
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const QUEUE_FILE = path.join(__dirname, '..', '..', 'queue.txt')
const HASHES_DIR = path.resolve(__dirname, '..', '..')

export class RunQueueHandler extends BaseHandler {
  private addDocHandler: AddDocumentationHandler

  constructor(server: Server, apiClient: ApiClient) {
    super(server, apiClient)
    this.addDocHandler = new AddDocumentationHandler(server, apiClient)
  }

  async handle(_args: any): Promise<McpToolResponse> {
    try {
      // Check if queue file exists
      try {
        await fs.access(QUEUE_FILE)
      } catch {
        return {
          content: [
            {
              type: 'text',
              text: 'Queue is empty (queue file does not exist)'
            }
          ]
        }
      }

      let processedCount = 0
      let failedCount = 0
      let skippedCount = 0
      const failedUrls: string[] = []

      const hashes: ContentHashStore = loadContentHashes(HASHES_DIR)

      while (true) {
        // Read current queue
        const content = await fs.readFile(QUEUE_FILE, 'utf-8')
        const urls = content.split('\n').filter((url) => url.trim() !== '')

        if (urls.length === 0) {
          break // Queue is empty
        }

        const currentUrl = urls[0] // Get first URL

        try {
          // Check content hash before full indexing (T011, T012)
          const storedEntry = hashes[currentUrl!]
          if (storedEntry) {
            const currentHash = await this.addDocHandler.computeContentHashForUrl(currentUrl!)
            if (currentHash !== null && currentHash === storedEntry.hash) {
              console.log('[RAGDocs] Skipped (unchanged):', currentUrl)
              skippedCount++
              // Remove from queue and continue
              const remainingUrls = urls.slice(1)
              await fs.writeFile(
                QUEUE_FILE,
                remainingUrls.join('\n') + (remainingUrls.length > 0 ? '\n' : '')
              )
              continue
            }
            // T013: hash differs → proceed with full re-index (falls through below)
          }

          // T018 [US3]: If content is unchanged (T011/T012 skip above), handle() is never called,
          // so orphan cleanup (called at the end of handle()) does NOT run for unchanged URLs.
          // Skip === no orphan cleanup — correct by construction.
          // Process the URL using add_documentation handler (T013)
          await this.addDocHandler.handle({ url: currentUrl })
          processedCount++
        } catch (error) {
          failedCount++
          failedUrls.push(currentUrl!)
          console.error(`Failed to process URL ${currentUrl}:`, error)
        }

        // Remove the processed URL from queue
        const remainingUrls = urls.slice(1)
        await fs.writeFile(
          QUEUE_FILE,
          remainingUrls.join('\n') + (remainingUrls.length > 0 ? '\n' : '')
        )
      }

      let resultText = `Queue processing complete.\nProcessed: ${processedCount} URLs\nSkipped (unchanged): ${skippedCount} URLs\nFailed: ${failedCount} URLs`
      if (failedUrls.length > 0) {
        resultText += `\n\nFailed URLs:\n${failedUrls.join('\n')}`
      }

      return {
        content: [
          {
            type: 'text',
            text: resultText
          }
        ]
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to process queue: ${error}`
          }
        ],
        isError: true
      }
    }
  }
}
