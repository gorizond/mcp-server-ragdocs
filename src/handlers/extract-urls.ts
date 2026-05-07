import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js'
import { BaseHandler } from './base-handler.js'
import type { McpToolResponse } from '../types.js'
import * as cheerio from 'cheerio'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { existsSync, readFileSync } from 'node:fs'

// Get current directory in ES modules
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const QUEUE_FILE = path.join(__dirname, '..', '..', 'queue.txt')

export class ExtractUrlsHandler extends BaseHandler {
  async handle(args: any): Promise<McpToolResponse> {
    if (!args.url || typeof args.url !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'URL is required')
    }

    await this.apiClient.initBrowser()
    const page = await this.apiClient.browser.newPage()

    try {
      const baseUrl = new URL(args.url)
      const basePath = baseUrl.pathname.split('/').slice(0, 3).join('/') // Get the base path (e.g., /3/ for Python docs)

      await page.goto(args.url, { waitUntil: 'networkidle' })
      const content = await page.content()
      const $ = cheerio.load(content)
      const urls = new Set<string>()

      $('a[href]').each((_, element) => {
        const href = $(element).attr('href')
        if (href) {
          try {
            const url = new URL(href, args.url)
            // Only include URLs from the same documentation section
            if (
              url.hostname === baseUrl.hostname &&
              url.pathname.startsWith(basePath) &&
              !url.hash &&
              !url.href.endsWith('#')
            ) {
              urls.add(url.href)
            }
          } catch (e) {
            // Ignore invalid URLs
          }
        }
      })

      const urlArray = Array.from(urls)

      if (args.add_to_queue) {
        try {
          // Ensure queue file exists
          try {
            await fs.access(QUEUE_FILE)
          } catch {
            await fs.writeFile(QUEUE_FILE, '')
          }

          // Phase 6 — Queue Dedup (T019): load existing queue to filter duplicates
          const existingQueue = existsSync(QUEUE_FILE)
            ? readFileSync(QUEUE_FILE, 'utf-8').split('\n').filter(u => u.trim())
            : []
          const existingSet = new Set(existingQueue)

          // T020: Filter duplicates before append
          const newUrls = urlArray.filter(u => !existingSet.has(u))
          if (newUrls.length > 0) {
            const urlsToAdd = newUrls.join('\n') + '\n'
            await fs.appendFile(QUEUE_FILE, urlsToAdd)

            // T021: Log skipped duplicates for debugging
            if (newUrls.length < urlArray.length) {
              console.log(`[RAGDocs] Queue dedup: skipped ${urlArray.length - newUrls.length} duplicate URLs`)
            }

            return {
              content: [
                {
                  type: 'text',
                  text: `Added ${newUrls.length} URLs to queue (${urlArray.length - newUrls.length} duplicates skipped)`
                }
              ]
            }
          } else {
            return {
              content: [
                {
                  type: 'text',
                  text: 'All URLs already in queue, nothing added'
                }
              ]
            }
          }
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: `Failed to add URLs to queue: ${error}`
              }
            ],
            isError: true
          }
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: urlArray.join('\n') || 'No URLs found on this page.'
          }
        ]
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to extract URLs: ${error}`
          }
        ],
        isError: true
      }
    } finally {
      await page.close()
    }
  }
}
