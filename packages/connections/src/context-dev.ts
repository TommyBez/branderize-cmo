import { z } from 'zod'

import {
  canonicalJson,
  compareCanonicalStrings,
  sha256CanonicalJson,
} from './canonical-json'

const API_ORIGIN = 'https://api.context.dev'
const BRAND_PATH = '/v1/brand/retrieve'
const CRAWL_PATH = '/v1/web/crawl'
const STYLEGUIDE_PATH = '/v1/web/styleguide'
const HEX_COLOR_PATTERN = /^[0-9a-f]{6}(?:[0-9a-f]{2})?$/
const LEADING_HASH_PATTERN = /^#/
const SHORT_HEX_COLOR_PATTERN = /^[0-9a-f]{3}$/
const TRAILING_DOT_PATTERN = /\.$/
const WWW_PREFIX_PATTERN = /^www\./

const optionalText = z.string().max(20_000).nullable().optional()
const optionalUrl = z.url().nullable().optional()

const keyMetadataSchema = z
  .object({
    credits_consumed: z.number().nonnegative().optional(),
    credits_remaining: z.number().nonnegative().optional(),
  })
  .strict()
  .optional()

const providerColorSchema = z
  .object({
    hex: z.string().max(32),
    name: optionalText,
  })
  .strict()

const providerResolutionSchema = z
  .object({
    aspect_ratio: z.number().positive().optional(),
    height: z.number().int().positive(),
    width: z.number().int().positive(),
  })
  .strict()

const providerAssetSchema = z
  .object({
    colors: z.array(providerColorSchema).max(32).optional(),
    resolution: providerResolutionSchema.nullable().optional(),
    url: z.url(),
  })
  .strict()

const providerSocialSchema = z
  .object({
    type: optionalText,
    url: z.url(),
  })
  .strict()

const providerAddressSchema = z
  .object({
    city: optionalText,
    country: optionalText,
    country_code: optionalText,
    postal_code: optionalText,
    state_code: optionalText,
    state_province: optionalText,
    street: optionalText,
  })
  .strict()

const providerStockSchema = z
  .object({
    exchange: optionalText,
    ticker: optionalText,
  })
  .strict()

const providerEmployeesSchema = z
  .object({
    exact: z.number().int().nonnegative().optional(),
  })
  .strict()

const providerIndustrySchema = z
  .object({
    industry: z.string().trim().min(1).max(256),
    subindustry: z.string().trim().min(1).max(256),
  })
  .strict()

const providerLinksSchema = z
  .object({
    blog: optionalUrl,
    careers: optionalUrl,
    contact: optionalUrl,
    pricing: optionalUrl,
    privacy: optionalUrl,
    terms: optionalUrl,
  })
  .strict()

export const contextDevBrandResponseSchema = z
  .object({
    brand: z
      .object({
        address: providerAddressSchema.nullable().optional(),
        backdrops: z.array(providerAssetSchema).max(32).optional(),
        colors: z.array(providerColorSchema).max(64).optional(),
        description: optionalText,
        domain: z.string().trim().min(3).max(253),
        email: optionalText,
        employees: providerEmployeesSchema.nullable().optional(),
        industries: z
          .object({ eic: z.array(providerIndustrySchema).max(32) })
          .strict()
          .nullable()
          .optional(),
        is_nsfw: z.boolean().nullable().optional(),
        links: providerLinksSchema.nullable().optional(),
        logos: z.array(providerAssetSchema).max(32).optional(),
        phone: optionalText,
        slogan: optionalText,
        socials: z.array(providerSocialSchema).max(32).optional(),
        stock: providerStockSchema.nullable().optional(),
        title: optionalText,
      })
      .strict(),
    code: z.number().int(),
    key_metadata: keyMetadataSchema,
    status: z.string().min(1).max(64),
  })
  .strict()

const providerTextStyleSchema = z
  .object({
    fontFallbacks: z.array(z.string().max(256)).max(32).optional(),
    fontFamily: optionalText,
    fontSize: optionalText,
    fontWeight: z.number().int().nonnegative().nullable().optional(),
    letterSpacing: optionalText,
    lineHeight: optionalText,
  })
  .strict()

const providerButtonStyleSchema = z
  .object({
    backgroundColor: optionalText,
    borderColor: optionalText,
    borderRadius: optionalText,
    borderStyle: optionalText,
    borderWidth: optionalText,
    boxShadow: optionalText,
    color: optionalText,
    css: optionalText,
    fontFallbacks: z.array(z.string().max(256)).max(32).optional(),
    fontFamily: optionalText,
    fontSize: optionalText,
    fontWeight: z.number().int().nonnegative().nullable().optional(),
    minHeight: optionalText,
    minWidth: optionalText,
    padding: optionalText,
    textDecoration: optionalText,
    textDecorationColor: optionalText,
  })
  .strict()

const providerCardStyleSchema = z
  .object({
    backgroundColor: optionalText,
    borderColor: optionalText,
    borderRadius: optionalText,
    borderStyle: optionalText,
    borderWidth: optionalText,
    boxShadow: optionalText,
    css: optionalText,
    padding: optionalText,
    textColor: optionalText,
  })
  .strict()

export const contextDevStyleguideResponseSchema = z
  .object({
    code: z.number().int(),
    domain: z.string().trim().min(3).max(253),
    key_metadata: keyMetadataSchema,
    status: z.string().min(1).max(64),
    styleguide: z
      .object({
        colors: z
          .object({
            accent: optionalText,
            background: optionalText,
            text: optionalText,
          })
          .strict()
          .optional(),
        components: z
          .object({
            button: z
              .object({
                link: providerButtonStyleSchema.optional(),
                primary: providerButtonStyleSchema.optional(),
                secondary: providerButtonStyleSchema.optional(),
              })
              .strict()
              .optional(),
            card: providerCardStyleSchema.optional(),
          })
          .strict()
          .optional(),
        elementSpacing: z
          .object({
            lg: optionalText,
            md: optionalText,
            sm: optionalText,
            xl: optionalText,
            xs: optionalText,
          })
          .strict()
          .optional(),
        fontLinks: z.record(z.string(), z.string()).optional(),
        shadows: z
          .object({
            inner: optionalText,
            lg: optionalText,
            md: optionalText,
            sm: optionalText,
            xl: optionalText,
          })
          .strict()
          .optional(),
        typography: z
          .object({
            headings: z
              .object({
                h1: providerTextStyleSchema.optional(),
                h2: providerTextStyleSchema.optional(),
                h3: providerTextStyleSchema.optional(),
                h4: providerTextStyleSchema.optional(),
              })
              .strict()
              .optional(),
            p: providerTextStyleSchema.optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
  })
  .strict()

const providerCrawlMetadataSchema = z
  .object({
    additionalMeta: z.record(z.string(), z.json()).optional(),
    alternates: z
      .array(
        z
          .object({
            href: optionalUrl,
            hreflang: optionalText,
            title: optionalText,
            type: optionalText,
          })
          .strict()
      )
      .max(128)
      .optional(),
    author: optionalText,
    canonicalUrl: optionalUrl,
    crawlDepth: z.number().int().nonnegative(),
    description: optionalText,
    favicon: optionalUrl,
    finalUrl: optionalUrl,
    headings: z
      .array(
        z
          .object({
            level: z.number().int().min(1).max(6),
            text: z.string().max(10_000),
          })
          .strict()
      )
      .max(2048)
      .optional(),
    image: optionalUrl,
    jsonLd: z.array(z.json()).max(256).optional(),
    keywords: z.array(z.string().max(256)).max(256).optional(),
    language: optionalText,
    modifiedTime: optionalText,
    openGraph: z.record(z.string(), z.json()).optional(),
    publishedTime: optionalText,
    robots: optionalText,
    siteName: optionalText,
    sourceUrl: optionalUrl,
    statusCode: z.number().int().min(100).max(599),
    success: z.boolean(),
    title: optionalText,
    twitter: z.record(z.string(), z.json()).optional(),
    url: optionalUrl,
  })
  .strict()

export const contextDevCrawlResponseSchema = z
  .object({
    key_metadata: keyMetadataSchema,
    metadata: z
      .object({
        maxCrawlDepth: z.number().int().nonnegative(),
        numFailed: z.number().int().nonnegative(),
        numSkipped: z.number().int().nonnegative().optional(),
        numSucceeded: z.number().int().nonnegative(),
        numUrls: z.number().int().nonnegative(),
      })
      .strict(),
    results: z
      .array(
        z
          .object({
            markdown: z.string().max(2_000_000),
            metadata: providerCrawlMetadataSchema,
          })
          .strict()
      )
      .max(100),
  })
  .strict()

const normalizedColorSchema = z
  .object({
    hex: z.string().regex(/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/),
    name: z.string().min(1).max(256).nullable(),
  })
  .strict()

const assetCandidateSchema = z
  .object({
    colors: z.array(normalizedColorSchema),
    height: z.number().int().positive().nullable(),
    kind: z.enum(['backdrop', 'logo']),
    sourceUrl: z.url(),
    width: z.number().int().positive().nullable(),
  })
  .strict()

const normalizedTextStyleSchema = z
  .object({
    fontFallbacks: z.array(z.string()),
    fontFamily: z.string().nullable(),
    fontSize: z.string().nullable(),
    fontWeight: z.number().int().nonnegative().nullable(),
    letterSpacing: z.string().nullable(),
    lineHeight: z.string().nullable(),
    role: z.enum(['body', 'h1', 'h2', 'h3', 'h4']),
  })
  .strict()

const normalizedBrandKitSchema = z
  .object({
    address: z
      .object({
        city: z.string().nullable(),
        country: z.string().nullable(),
        countryCode: z.string().nullable(),
        postalCode: z.string().nullable(),
        state: z.string().nullable(),
        street: z.string().nullable(),
      })
      .strict()
      .nullable(),
    assetCandidates: z.array(assetCandidateSchema),
    colors: z.array(normalizedColorSchema),
    description: z.string().nullable(),
    industries: z.array(
      z
        .object({
          industry: z.string(),
          subindustry: z.string(),
        })
        .strict()
    ),
    links: z.array(
      z
        .object({
          kind: z.enum([
            'blog',
            'careers',
            'contact',
            'pricing',
            'privacy',
            'terms',
          ]),
          url: z.url(),
        })
        .strict()
    ),
    name: z.string().nullable(),
    nsfw: z.boolean().nullable(),
    slogan: z.string().nullable(),
    socials: z.array(
      z
        .object({
          kind: z.string().nullable(),
          url: z.url(),
        })
        .strict()
    ),
    styleguide: z
      .object({
        colors: z.array(
          z
            .object({
              role: z.enum(['accent', 'background', 'text']),
              value: z.string(),
            })
            .strict()
        ),
        shadows: z.array(
          z
            .object({
              role: z.enum(['inner', 'lg', 'md', 'sm', 'xl']),
              value: z.string(),
            })
            .strict()
        ),
        spacing: z.array(
          z
            .object({
              role: z.enum(['lg', 'md', 'sm', 'xl', 'xs']),
              value: z.string(),
            })
            .strict()
        ),
        typography: z.array(normalizedTextStyleSchema),
      })
      .strict(),
  })
  .strict()

const normalizedCrawlSchema = z
  .object({
    pages: z
      .array(
        z
          .object({
            depth: z.number().int().nonnegative(),
            markdown: z.string().min(1),
            title: z.string().nullable(),
            url: z.url(),
          })
          .strict()
      )
      .min(1),
    reported: z
      .object({
        failed: z.number().int().nonnegative(),
        maxDepth: z.number().int().nonnegative(),
        skipped: z.number().int().nonnegative(),
        succeeded: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()

const snapshotContentSchema = z
  .object({
    brandKit: normalizedBrandKitSchema,
    crawl: normalizedCrawlSchema,
    normalizedDomain: z.string().min(3).max(253),
    version: z.literal(1),
    websiteUrl: z.url(),
  })
  .strict()

export const contextDevSnapshotSchema = snapshotContentSchema.extend({
  evidence: z
    .object({
      contentHash: z.string().regex(/^[0-9a-f]{64}$/),
      fetchedAt: z.iso.datetime({ offset: true }),
      provider: z.literal('context.dev'),
      requestHash: z.string().regex(/^[0-9a-f]{64}$/),
      sourceUrls: z.array(z.url()),
    })
    .strict(),
})

export type ContextDevSnapshot = z.infer<typeof contextDevSnapshotSchema>

const importInputSchema = z
  .object({ websiteUrl: z.url() })
  .strict()
  .transform(({ websiteUrl }) => {
    const url = new URL(websiteUrl)
    url.hash = ''
    url.hostname = url.hostname.toLowerCase().replace(TRAILING_DOT_PATTERN, '')
    url.searchParams.sort()
    return { websiteUrl: url.toString() }
  })
  .superRefine(({ websiteUrl }, context) => {
    const url = new URL(websiteUrl)
    if (url.protocol !== 'https:') {
      context.addIssue({ code: 'custom', message: 'HTTPS is required' })
    }
    if (url.username !== '' || url.password !== '') {
      context.addIssue({ code: 'custom', message: 'Credentials are forbidden' })
    }
  })

const adapterConfigurationSchema = z
  .object({
    crawl: z
      .object({
        maxDepth: z.number().int().min(0).max(3),
        maxPages: z.number().int().min(1).max(25),
        stopAfterMs: z.number().int().min(10_000).max(110_000),
      })
      .strict(),
    tags: z.array(z.string().trim().min(1).max(50)).max(20),
    timeoutMs: z.number().int().min(11_000).max(120_000),
  })
  .strict()
  .superRefine((configuration, context) => {
    if (configuration.crawl.stopAfterMs >= configuration.timeoutMs) {
      context.addIssue({
        code: 'custom',
        message: 'Crawl soft deadline must precede the adapter deadline',
        path: ['crawl', 'stopAfterMs'],
      })
    }
  })

export type ContextDevAdapterErrorCode =
  | 'invalid_input'
  | 'invalid_response'
  | 'network_error'
  | 'provider_error'
  | 'timeout'

export interface ContextDevAdapterErrorOptions extends ErrorOptions {
  readonly code: ContextDevAdapterErrorCode
  readonly statusCode?: number | null
}

export class ContextDevAdapterError extends Error {
  readonly code: ContextDevAdapterErrorCode
  readonly statusCode: number | null

  constructor(message: string, options: ContextDevAdapterErrorOptions) {
    super(message, options)
    this.name = 'ContextDevAdapterError'
    this.code = options.code
    this.statusCode = options.statusCode ?? null
  }
}

export interface ContextDevAdapter {
  readonly importWebsite: (input: unknown) => Promise<ContextDevSnapshot>
}

export interface ContextDevAdapterDependencies {
  readonly apiKey: string
  readonly configuration: z.input<typeof adapterConfigurationSchema>
  readonly fetch?: typeof globalThis.fetch
  readonly now?: () => Date
}

const normalizeText = (value: string | null | undefined): string | null => {
  const normalized = value?.trim().replace(/\s+/g, ' ')
  return normalized === undefined || normalized.length === 0 ? null : normalized
}

const normalizeMarkdown = (value: string): string =>
  value.replace(/\r\n?/g, '\n').trim()

const normalizeUrl = (value: string): string => {
  const url = new URL(value)
  url.hash = ''
  url.hostname = url.hostname.toLowerCase().replace(TRAILING_DOT_PATTERN, '')
  url.searchParams.sort()
  return url.toString()
}

const normalizeDomain = (value: string): string => {
  const hostname = value.includes('://')
    ? new URL(value).hostname
    : new URL(`https://${value}`).hostname
  return hostname
    .toLowerCase()
    .replace(TRAILING_DOT_PATTERN, '')
    .replace(WWW_PREFIX_PATTERN, '')
}

const normalizeHex = (value: string): string | null => {
  const compact = value.trim().toLowerCase().replace(LEADING_HASH_PATTERN, '')
  if (SHORT_HEX_COLOR_PATTERN.test(compact)) {
    return `#${[...compact].map((character) => character.repeat(2)).join('')}`
  }
  return HEX_COLOR_PATTERN.test(compact) ? `#${compact}` : null
}

type ProviderColor = z.infer<typeof providerColorSchema>

const normalizeColors = (
  colors: readonly ProviderColor[] | undefined
): z.infer<typeof normalizedColorSchema>[] => {
  const unique = new Map<string, z.infer<typeof normalizedColorSchema>>()
  for (const color of colors ?? []) {
    const hex = normalizeHex(color.hex)
    if (hex === null) {
      continue
    }
    const normalized = { hex, name: normalizeText(color.name) }
    unique.set(canonicalJson(normalized), normalized)
  }
  return [...unique.values()].sort((left, right) =>
    compareCanonicalStrings(canonicalJson(left), canonicalJson(right))
  )
}

type ProviderAsset = z.infer<typeof providerAssetSchema>

const normalizeAssets = (
  kind: 'backdrop' | 'logo',
  assets: readonly ProviderAsset[] | undefined
): z.infer<typeof assetCandidateSchema>[] => {
  const unique = new Map<string, z.infer<typeof assetCandidateSchema>>()
  for (const asset of assets ?? []) {
    const normalized = assetCandidateSchema.parse({
      colors: normalizeColors(asset.colors),
      height: asset.resolution?.height ?? null,
      kind,
      sourceUrl: normalizeUrl(asset.url),
      width: asset.resolution?.width ?? null,
    })
    unique.set(normalized.sourceUrl, normalized)
  }
  return [...unique.values()].sort((left, right) =>
    compareCanonicalStrings(left.sourceUrl, right.sourceUrl)
  )
}

const normalizeTextStyle = (
  role: z.infer<typeof normalizedTextStyleSchema>['role'],
  style: z.infer<typeof providerTextStyleSchema> | undefined
): z.infer<typeof normalizedTextStyleSchema> | null => {
  if (style === undefined) {
    return null
  }
  const fallbackSet = new Set(
    (style.fontFallbacks ?? [])
      .map((fallback) => normalizeText(fallback))
      .filter((fallback) => fallback !== null)
  )
  return normalizedTextStyleSchema.parse({
    fontFallbacks: [...fallbackSet].sort(),
    fontFamily: normalizeText(style.fontFamily),
    fontSize: normalizeText(style.fontSize),
    fontWeight: style.fontWeight ?? null,
    letterSpacing: normalizeText(style.letterSpacing),
    lineHeight: normalizeText(style.lineHeight),
    role,
  })
}

const normalizeRoleValues = <Role extends string>(
  source:
    | Readonly<Partial<Record<Role, string | null | undefined>>>
    | undefined,
  roles: readonly Role[]
): { readonly role: Role; readonly value: string }[] => {
  const values: { role: Role; value: string }[] = []
  for (const role of roles) {
    const value = normalizeText(source?.[role])
    if (value !== null) {
      values.push({ role, value })
    }
  }
  return values
}

type BrandResponse = z.infer<typeof contextDevBrandResponseSchema>
type StyleguideResponse = z.infer<typeof contextDevStyleguideResponseSchema>
type CrawlResponse = z.infer<typeof contextDevCrawlResponseSchema>

const normalizeBrandKit = (
  brandResponse: BrandResponse,
  styleguideResponse: StyleguideResponse
): z.infer<typeof normalizedBrandKitSchema> => {
  const { brand } = brandResponse
  const { styleguide } = styleguideResponse
  const textStyles = [
    normalizeTextStyle('h1', styleguide.typography?.headings?.h1),
    normalizeTextStyle('h2', styleguide.typography?.headings?.h2),
    normalizeTextStyle('h3', styleguide.typography?.headings?.h3),
    normalizeTextStyle('h4', styleguide.typography?.headings?.h4),
    normalizeTextStyle('body', styleguide.typography?.p),
  ].filter((style) => style !== null)

  const links: { kind: keyof NonNullable<typeof brand.links>; url: string }[] =
    []
  const linkKinds = [
    'blog',
    'careers',
    'contact',
    'pricing',
    'privacy',
    'terms',
  ] as const
  for (const kind of linkKinds) {
    const url = brand.links?.[kind]
    if (url !== null && url !== undefined) {
      links.push({ kind, url: normalizeUrl(url) })
    }
  }

  const socials = (brand.socials ?? [])
    .map((social) => ({
      kind: normalizeText(social.type),
      url: normalizeUrl(social.url),
    }))
    .sort((left, right) =>
      compareCanonicalStrings(canonicalJson(left), canonicalJson(right))
    )

  return normalizedBrandKitSchema.parse({
    address:
      brand.address === null || brand.address === undefined
        ? null
        : {
            city: normalizeText(brand.address.city),
            country: normalizeText(brand.address.country),
            countryCode: normalizeText(brand.address.country_code),
            postalCode: normalizeText(brand.address.postal_code),
            state: normalizeText(
              brand.address.state_province ?? brand.address.state_code
            ),
            street: normalizeText(brand.address.street),
          },
    assetCandidates: [
      ...normalizeAssets('logo', brand.logos),
      ...normalizeAssets('backdrop', brand.backdrops),
    ].sort((left, right) =>
      compareCanonicalStrings(canonicalJson(left), canonicalJson(right))
    ),
    colors: normalizeColors(brand.colors),
    description: normalizeText(brand.description),
    industries: [...(brand.industries?.eic ?? [])].sort((left, right) =>
      compareCanonicalStrings(canonicalJson(left), canonicalJson(right))
    ),
    links,
    name: normalizeText(brand.title),
    nsfw: brand.is_nsfw ?? null,
    slogan: normalizeText(brand.slogan),
    socials,
    styleguide: {
      colors: normalizeRoleValues(styleguide.colors, [
        'accent',
        'background',
        'text',
      ]),
      shadows: normalizeRoleValues(styleguide.shadows, [
        'inner',
        'lg',
        'md',
        'sm',
        'xl',
      ]),
      spacing: normalizeRoleValues(styleguide.elementSpacing, [
        'lg',
        'md',
        'sm',
        'xl',
        'xs',
      ]),
      typography: textStyles,
    },
  })
}

const normalizeCrawl = (
  response: CrawlResponse
): z.infer<typeof normalizedCrawlSchema> => {
  const pages = new Map<
    string,
    z.infer<typeof normalizedCrawlSchema>['pages'][number]
  >()
  for (const result of response.results) {
    const successfulStatus =
      result.metadata.success &&
      result.metadata.statusCode >= 200 &&
      result.metadata.statusCode < 300
    const candidateUrl =
      result.metadata.finalUrl ??
      result.metadata.url ??
      result.metadata.sourceUrl
    const markdown = normalizeMarkdown(result.markdown)
    if (!(successfulStatus && candidateUrl && markdown.length > 0)) {
      continue
    }

    const page = {
      depth: result.metadata.crawlDepth,
      markdown,
      title: normalizeText(result.metadata.title),
      url: normalizeUrl(candidateUrl),
    }
    const previous = pages.get(page.url)
    if (
      previous === undefined ||
      compareCanonicalStrings(canonicalJson(page), canonicalJson(previous)) < 0
    ) {
      pages.set(page.url, page)
    }
  }

  return normalizedCrawlSchema.parse({
    pages: [...pages.values()].sort((left, right) =>
      compareCanonicalStrings(left.url, right.url)
    ),
    reported: {
      failed: response.metadata.numFailed,
      maxDepth: response.metadata.maxCrawlDepth,
      skipped: response.metadata.numSkipped ?? 0,
      succeeded: response.metadata.numSucceeded,
      total: response.metadata.numUrls,
    },
  })
}

const buildRequestContract = ({
  configuration,
  normalizedDomain,
  websiteUrl,
}: {
  readonly configuration: z.infer<typeof adapterConfigurationSchema>
  readonly normalizedDomain: string
  readonly websiteUrl: string
}) => {
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

const requestJson = async ({
  apiKey,
  body,
  fetchTransport,
  method,
  path,
  signal,
}: {
  readonly apiKey: string
  readonly body?: unknown
  readonly fetchTransport: typeof globalThis.fetch
  readonly method: 'GET' | 'POST'
  readonly path: string
  readonly signal: AbortSignal
}): Promise<unknown> => {
  const response = await fetchTransport(`${API_ORIGIN}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${apiKey}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    method,
    signal,
  })

  if (!response.ok) {
    await response.body?.cancel()
    throw new ContextDevAdapterError(
      `Context.dev returned HTTP ${response.status}`,
      { code: 'provider_error', statusCode: response.status }
    )
  }

  const contentType = response.headers.get('content-type')?.toLowerCase()
  if (contentType?.includes('application/json') !== true) {
    await response.body?.cancel()
    throw new ContextDevAdapterError(
      'Context.dev returned a non-JSON response',
      { code: 'invalid_response' }
    )
  }

  try {
    return await response.json()
  } catch (error) {
    throw new ContextDevAdapterError('Context.dev returned malformed JSON', {
      cause: error,
      code: 'invalid_response',
    })
  }
}

const styleguidePath = (request: {
  readonly colorScheme: string
  readonly domain: string
  readonly tags: readonly string[]
  readonly timeoutMS: number
}): string => {
  const parameters = new URLSearchParams({
    colorScheme: request.colorScheme,
    domain: request.domain,
    tags: request.tags.join(','),
    timeoutMS: String(request.timeoutMS),
  })
  parameters.sort()
  return `${STYLEGUIDE_PATH}?${parameters}`
}

const throwContextDevImportError = (
  error: unknown,
  timedOut: boolean
): never => {
  if (timedOut) {
    throw new ContextDevAdapterError('Context.dev import timed out', {
      cause: error,
      code: 'timeout',
    })
  }
  if (error instanceof ContextDevAdapterError) {
    throw error
  }
  if (error instanceof z.ZodError) {
    throw new ContextDevAdapterError(
      'Context.dev response failed schema validation',
      { cause: error, code: 'invalid_response' }
    )
  }
  throw new ContextDevAdapterError('Context.dev import failed', {
    cause: error,
    code: 'network_error',
  })
}

export const createContextDevAdapter = (
  dependencies: ContextDevAdapterDependencies
): ContextDevAdapter => {
  const apiKey = z.string().trim().min(1).max(4096).parse(dependencies.apiKey)
  const configuration = adapterConfigurationSchema.parse(
    dependencies.configuration
  )
  const fetchTransport = dependencies.fetch ?? globalThis.fetch
  const now = dependencies.now ?? (() => new Date())

  return {
    importWebsite: async (input) => {
      const parsedInput = importInputSchema.safeParse(input)
      if (!parsedInput.success) {
        throw new ContextDevAdapterError(
          'Context.dev import input is invalid',
          { code: 'invalid_input' }
        )
      }

      const normalizedDomain = normalizeDomain(parsedInput.data.websiteUrl)
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
        const [brandPayload, styleguidePayload, crawlPayload] =
          await Promise.race([
            Promise.all([
              requestJson({
                apiKey,
                body: requestContract.brand,
                fetchTransport,
                method: 'POST',
                path: BRAND_PATH,
                signal: controller.signal,
              }),
              requestJson({
                apiKey,
                fetchTransport,
                method: 'GET',
                path: styleguidePath(requestContract.styleguide),
                signal: controller.signal,
              }),
              requestJson({
                apiKey,
                body: requestContract.crawl,
                fetchTransport,
                method: 'POST',
                path: CRAWL_PATH,
                signal: controller.signal,
              }),
            ]),
            deadline,
          ])

        const brand = contextDevBrandResponseSchema.parse(brandPayload)
        const styleguide =
          contextDevStyleguideResponseSchema.parse(styleguidePayload)
        const crawl = contextDevCrawlResponseSchema.parse(crawlPayload)
        if (
          normalizeDomain(brand.brand.domain) !== normalizedDomain ||
          normalizeDomain(styleguide.domain) !== normalizedDomain
        ) {
          throw new ContextDevAdapterError(
            'Context.dev returned data for a different domain',
            { code: 'invalid_response' }
          )
        }

        const content = snapshotContentSchema.parse({
          brandKit: normalizeBrandKit(brand, styleguide),
          crawl: normalizeCrawl(crawl),
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
