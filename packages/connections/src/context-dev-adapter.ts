import { z } from 'zod'

import { sha256CanonicalJson } from './canonical-json'
import {
  type ContextDevAdapterConfiguration,
  type ContextDevAdapterConfigurationInput,
  type ContextDevRequestContract,
  type ContextDevSnapshot,
  contextDevAdapterConfigurationSchema,
  contextDevBrandResponseSchema,
  contextDevCrawlResponseSchema,
  contextDevImportInputSchema,
  contextDevSnapshotSchema,
  contextDevStyleguideResponseSchema,
  snapshotContentSchema,
} from './context-dev-contracts'
import {
  normalizeContextDevBrandKit,
  normalizeContextDevCrawl,
  normalizeContextDevDomain,
} from './context-dev-normalization'
import {
  ContextDevAdapterError,
  requestContextDevPayloads,
  throwContextDevImportError,
} from './context-dev-transport'

export interface ContextDevAdapter {
  readonly importWebsite: (input: unknown) => Promise<ContextDevSnapshot>
}

export interface ContextDevAdapterDependencies {
  readonly apiKey: string
  readonly configuration: ContextDevAdapterConfigurationInput
  readonly fetch?: typeof globalThis.fetch
  readonly now?: () => Date
}

const buildRequestContract = ({
  configuration,
  normalizedDomain,
  websiteUrl,
}: {
  readonly configuration: ContextDevAdapterConfiguration
  readonly normalizedDomain: string
  readonly websiteUrl: string
}): ContextDevRequestContract => {
  const tags = [...new Set(configuration.tags)].sort()
  return {
    brand: {
      domain: normalizedDomain,
      tags,
      timeoutMS: configuration.timeoutMs,
      type: 'by_domain',
    },
    crawl: {
      followSubdomains: false,
      includeImages: false,
      includeLinks: false,
      maxDepth: configuration.crawl.maxDepth,
      maxPages: configuration.crawl.maxPages,
      stopAfterMs: configuration.crawl.stopAfterMs,
      tags,
      timeoutMS: configuration.timeoutMs,
      url: websiteUrl,
      useMainContentOnly: true,
    },
    styleguide: {
      colorScheme: 'light',
      domain: normalizedDomain,
      tags,
      timeoutMS: configuration.timeoutMs,
    },
  }
}

export const createContextDevAdapter = (
  dependencies: ContextDevAdapterDependencies
): ContextDevAdapter => {
  const apiKey = z.string().trim().min(1).max(4096).parse(dependencies.apiKey)
  const configuration = contextDevAdapterConfigurationSchema.parse(
    dependencies.configuration
  )
  const fetchTransport = dependencies.fetch ?? globalThis.fetch
  const now = dependencies.now ?? (() => new Date())

  return {
    importWebsite: async (input) => {
      const parsedInput = contextDevImportInputSchema.safeParse(input)
      if (!parsedInput.success) {
        throw new ContextDevAdapterError(
          'Context.dev import input is invalid',
          { code: 'invalid_input' }
        )
      }

      const normalizedDomain = normalizeContextDevDomain(
        parsedInput.data.websiteUrl
      )
      const requestContract = buildRequestContract({
        configuration,
        normalizedDomain,
        websiteUrl: parsedInput.data.websiteUrl,
      })
      const controller = new AbortController()
      let timedOut = false
      let rejectDeadline: ((reason: Error) => void) | undefined
      const deadline = new Promise<never>((_resolve, reject) => {
        rejectDeadline = reject
      })
      const timeout = setTimeout(() => {
        timedOut = true
        controller.abort()
        rejectDeadline?.(new Error('Context.dev adapter deadline elapsed'))
      }, configuration.timeoutMs)

      try {
        const {
          brand: brandPayload,
          crawl: crawlPayload,
          styleguide: styleguidePayload,
        } = await Promise.race([
          requestContextDevPayloads({
            apiKey,
            fetchTransport,
            requestContract,
            signal: controller.signal,
          }),
          deadline,
        ])

        const brand = contextDevBrandResponseSchema.parse(brandPayload)
        const styleguide =
          contextDevStyleguideResponseSchema.parse(styleguidePayload)
        const crawl = contextDevCrawlResponseSchema.parse(crawlPayload)
        if (
          normalizeContextDevDomain(brand.brand.domain) !== normalizedDomain ||
          normalizeContextDevDomain(styleguide.domain) !== normalizedDomain
        ) {
          throw new ContextDevAdapterError(
            'Context.dev returned data for a different domain',
            { code: 'invalid_response' }
          )
        }

        const content = snapshotContentSchema.parse({
          brandKit: normalizeContextDevBrandKit(brand, styleguide),
          crawl: normalizeContextDevCrawl(crawl),
          normalizedDomain,
          version: 1,
          websiteUrl: parsedInput.data.websiteUrl,
        })
        const sourceUrls = new Set<string>()
        sourceUrls.add(content.websiteUrl)
        for (const asset of content.brandKit.assetCandidates) {
          sourceUrls.add(asset.sourceUrl)
        }
        for (const page of content.crawl.pages) {
          sourceUrls.add(page.url)
        }

        return contextDevSnapshotSchema.parse({
          ...content,
          evidence: {
            contentHash: sha256CanonicalJson(content),
            fetchedAt: now().toISOString(),
            provider: 'context.dev',
            requestHash: sha256CanonicalJson(requestContract),
            sourceUrls: [...sourceUrls].sort(),
          },
        })
      } catch (error) {
        controller.abort()
        return throwContextDevImportError(error, timedOut)
      } finally {
        clearTimeout(timeout)
      }
    },
  }
}
