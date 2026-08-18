import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  type ContextDevAdapterError,
  createContextDevAdapter,
} from './context-dev'

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/

const brandResponse = {
  brand: {
    address: {
      city: ' San Francisco ',
      country: 'United States',
      country_code: 'US',
      postal_code: '94105',
      state_code: 'CA',
      state_province: 'California',
      street: '140 2nd Street',
    },
    backdrops: [],
    colors: [
      { hex: '#ABC', name: 'Light' },
      { hex: '#000000', name: 'Black' },
    ],
    description: '  A useful   product. ',
    domain: 'www.example.com',
    industries: {
      eic: [{ industry: 'Technology', subindustry: 'Software (B2B)' }],
    },
    is_nsfw: false,
    links: {
      blog: 'https://example.com/blog',
      careers: null,
      contact: null,
      pricing: 'https://example.com/pricing',
      privacy: null,
      terms: null,
    },
    logos: [
      {
        colors: [{ hex: '#000', name: 'Black' }],
        resolution: { aspect_ratio: 2, height: 64, width: 128 },
        url: 'https://cdn.example.com/logo.png#old',
      },
    ],
    slogan: ' Build better ',
    socials: [
      { type: 'linkedin', url: 'https://linkedin.com/company/example' },
      { type: 'x', url: 'https://x.com/example' },
    ],
    title: ' Example ',
  },
  code: 200,
  status: 'ok',
}

const styleguideResponse = {
  code: 200,
  domain: 'example.com',
  status: 'ok',
  styleguide: {
    colors: {
      accent: '#ff0000',
      background: '#ffffff',
      text: '#000000',
    },
    elementSpacing: { md: '16px' },
    shadows: { sm: '0 1px 2px #0002' },
    typography: {
      headings: {
        h1: {
          fontFallbacks: ['sans-serif', 'Arial', 'Arial'],
          fontFamily: 'Inter',
          fontSize: '48px',
          fontWeight: 700,
          letterSpacing: '-0.02em',
          lineHeight: '1.1',
        },
      },
      p: {
        fontFallbacks: ['sans-serif'],
        fontFamily: 'Inter',
        fontSize: '16px',
        fontWeight: 400,
        lineHeight: '1.5',
      },
    },
  },
}

const crawlResults = [
  {
    markdown: '# Pricing\r\n\r\nSimple plans. ',
    metadata: {
      crawlDepth: 1,
      finalUrl: 'https://example.com/pricing?b=2&a=1#plans',
      statusCode: 200,
      success: true,
      title: ' Pricing ',
    },
  },
  {
    markdown: '# Home\n\nWelcome.',
    metadata: {
      crawlDepth: 0,
      statusCode: 200,
      success: true,
      title: 'Home',
      url: 'https://example.com/',
    },
  },
]

const crawlResponse = (results: readonly unknown[] = crawlResults) => ({
  metadata: {
    maxCrawlDepth: 1,
    numFailed: 0,
    numSkipped: 0,
    numSucceeded: results.length,
    numUrls: results.length,
  },
  results,
})

const configuration = {
  crawl: { maxDepth: 1, maxPages: 10, stopAfterMs: 10_000 },
  tags: ['phase-0', 'test'],
  timeoutMs: 11_000,
}

const responseForPath = (
  url: string,
  brand: unknown = brandResponse,
  crawl: unknown = crawlResponse()
): Response => {
  const { pathname } = new URL(url)
  if (pathname === '/v1/brand/retrieve') {
    return Response.json(brand)
  }
  if (pathname === '/v1/web/styleguide') {
    return Response.json(styleguideResponse)
  }
  if (pathname === '/v1/web/crawl') {
    return Response.json(crawl)
  }
  return new Response(null, { status: 404 })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('Context.dev adapter', () => {
  it('normalizes brand kit and crawl deterministically behind one request hash', async () => {
    const firstFetch: typeof globalThis.fetch = vi.fn(async (input) =>
      responseForPath(input.toString())
    )
    const secondFetch: typeof globalThis.fetch = vi.fn(async (input) =>
      responseForPath(
        input.toString(),
        {
          ...brandResponse,
          brand: {
            ...brandResponse.brand,
            colors: [...brandResponse.brand.colors].reverse(),
            socials: [...brandResponse.brand.socials].reverse(),
          },
        },
        crawlResponse([...crawlResults].reverse())
      )
    )
    const createAdapter = (fetchTransport: typeof globalThis.fetch) =>
      createContextDevAdapter({
        apiKey: 'server-secret',
        configuration,
        fetch: fetchTransport,
        now: () => new Date('2026-08-17T12:00:00.000Z'),
      })

    const first = await createAdapter(firstFetch).importWebsite({
      websiteUrl: 'https://WWW.EXAMPLE.COM?z=2&a=1#hero',
    })
    const second = await createAdapter(secondFetch).importWebsite({
      websiteUrl: 'https://www.example.com?a=1&z=2',
    })

    expect(first).toEqual(second)
    expect(first.normalizedDomain).toBe('example.com')
    expect(first.brandKit.colors).toEqual([
      { hex: '#000000', name: 'Black' },
      { hex: '#aabbcc', name: 'Light' },
    ])
    expect(first.crawl.pages.map(({ url }) => url)).toEqual([
      'https://example.com/',
      'https://example.com/pricing?a=1&b=2',
    ])
    expect(first.brandKit.assetCandidates[0]).not.toHaveProperty('blobKey')
    expect(first.evidence.requestHash).toMatch(SHA256_HEX_PATTERN)
    expect(first.evidence.contentHash).toMatch(SHA256_HEX_PATTERN)
    expect(firstFetch).toHaveBeenCalledTimes(3)
    expect(firstFetch).toHaveBeenNthCalledWith(
      1,
      'https://api.context.dev/v1/brand/retrieve',
      expect.objectContaining({ method: 'POST' })
    )
    expect(firstFetch).toHaveBeenNthCalledWith(
      2,
      'https://api.context.dev/v1/web/styleguide?colorScheme=light&domain=example.com&tags=phase-0%2Ctest&timeoutMS=11000',
      expect.objectContaining({ method: 'GET' })
    )
    expect(firstFetch).toHaveBeenNthCalledWith(
      3,
      'https://api.context.dev/v1/web/crawl',
      expect.objectContaining({ method: 'POST' })
    )
    for (const call of vi.mocked(firstFetch).mock.calls) {
      expect(call[1]?.headers).toMatchObject({
        authorization: 'Bearer server-secret',
      })
    }
  })

  it('rejects unknown provider fields through closed response schemas', async () => {
    const fetchTransport: typeof globalThis.fetch = async (input) =>
      responseForPath(input.toString(), {
        ...brandResponse,
        unexpected: true,
      })
    const adapter = createContextDevAdapter({
      apiKey: 'server-secret',
      configuration,
      fetch: fetchTransport,
    })

    await expect(
      adapter.importWebsite({ websiteUrl: 'https://example.com' })
    ).rejects.toMatchObject({
      code: 'invalid_response',
    } satisfies Partial<ContextDevAdapterError>)
  })

  it('maps malformed provider JSON to an invalid response', async () => {
    const fetchTransport: typeof globalThis.fetch = (input) => {
      const { pathname } = new URL(input.toString())
      if (pathname === '/v1/brand/retrieve') {
        return Promise.resolve(
          new Response('{', {
            headers: { 'content-type': 'application/json' },
          })
        )
      }
      return Promise.resolve(responseForPath(input.toString()))
    }
    const adapter = createContextDevAdapter({
      apiKey: 'server-secret',
      configuration,
      fetch: fetchTransport,
    })

    await expect(
      adapter.importWebsite({ websiteUrl: 'https://example.com' })
    ).rejects.toMatchObject({
      code: 'invalid_response',
    } satisfies Partial<ContextDevAdapterError>)
  })

  it('rejects a crawl with no validated successful page', async () => {
    const failedCrawl = crawlResponse([
      {
        markdown: '',
        metadata: {
          crawlDepth: 0,
          statusCode: 500,
          success: false,
          url: 'https://example.com/',
        },
      },
    ])
    const fetchTransport: typeof globalThis.fetch = async (input) =>
      responseForPath(input.toString(), brandResponse, failedCrawl)
    const adapter = createContextDevAdapter({
      apiKey: 'server-secret',
      configuration,
      fetch: fetchTransport,
    })

    await expect(
      adapter.importWebsite({ websiteUrl: 'https://example.com' })
    ).rejects.toMatchObject({
      code: 'invalid_response',
    } satisfies Partial<ContextDevAdapterError>)
  })

  it('enforces the local deadline independently of provider timeout fields', async () => {
    vi.useFakeTimers()
    const fetchTransport: typeof globalThis.fetch = () =>
      new Promise<Response>(() => undefined)
    const adapter = createContextDevAdapter({
      apiKey: 'server-secret',
      configuration,
      fetch: fetchTransport,
    })

    const importPromise = adapter.importWebsite({
      websiteUrl: 'https://example.com',
    })
    const rejection = expect(importPromise).rejects.toMatchObject({
      code: 'timeout',
    } satisfies Partial<ContextDevAdapterError>)
    await vi.advanceTimersByTimeAsync(configuration.timeoutMs)

    await rejection
  })

  it('rejects extra browser input without reaching Context.dev', async () => {
    const fetchTransport: typeof globalThis.fetch = vi.fn()
    const adapter = createContextDevAdapter({
      apiKey: 'server-secret',
      configuration,
      fetch: fetchTransport,
    })

    await expect(
      adapter.importWebsite({
        brandId: 'caller-controlled',
        websiteUrl: 'https://example.com',
      })
    ).rejects.toMatchObject({ code: 'invalid_input' })
    expect(fetchTransport).not.toHaveBeenCalled()
  })
})
