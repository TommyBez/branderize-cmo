import { z } from 'zod'

const TRAILING_DOT_PATTERN = /\.$/

const optionalText = z.string().max(20_000).nullable().optional()
const optionalUrl = z.url().nullable().optional()

const keyMetadataSchema = z
  .object({
    credits_consumed: z.number().nonnegative().optional(),
    credits_remaining: z.number().nonnegative().optional(),
  })
  .strict()
  .optional()

export const providerColorSchema = z
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

export const providerAssetSchema = z
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

export const providerTextStyleSchema = z
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

export const normalizedColorSchema = z
  .object({
    hex: z.string().regex(/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/),
    name: z.string().min(1).max(256).nullable(),
  })
  .strict()

export const assetCandidateSchema = z
  .object({
    colors: z.array(normalizedColorSchema),
    height: z.number().int().positive().nullable(),
    kind: z.enum(['backdrop', 'logo']),
    sourceUrl: z.url(),
    width: z.number().int().positive().nullable(),
  })
  .strict()

export const normalizedTextStyleSchema = z
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

export const normalizedBrandKitSchema = z
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

export const normalizedCrawlSchema = z
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

export const snapshotContentSchema = z
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

export const contextDevImportInputSchema = z
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

export const contextDevAdapterConfigurationSchema = z
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

export type ContextDevSnapshot = z.infer<typeof contextDevSnapshotSchema>
export type ContextDevSnapshotContent = z.infer<typeof snapshotContentSchema>
export type ContextDevAdapterConfiguration = z.infer<
  typeof contextDevAdapterConfigurationSchema
>
export type ContextDevAdapterConfigurationInput = z.input<
  typeof contextDevAdapterConfigurationSchema
>
export type ContextDevBrandResponse = z.infer<
  typeof contextDevBrandResponseSchema
>
export type ContextDevStyleguideResponse = z.infer<
  typeof contextDevStyleguideResponseSchema
>
export type ContextDevCrawlResponse = z.infer<
  typeof contextDevCrawlResponseSchema
>
export type ContextDevNormalizedBrandKit = z.infer<
  typeof normalizedBrandKitSchema
>
export type ContextDevNormalizedCrawl = z.infer<typeof normalizedCrawlSchema>
export type ContextDevNormalizedColor = z.infer<typeof normalizedColorSchema>
export type ContextDevNormalizedTextStyle = z.infer<
  typeof normalizedTextStyleSchema
>
export type ContextDevAssetCandidate = z.infer<typeof assetCandidateSchema>
export type ContextDevProviderColor = z.infer<typeof providerColorSchema>
export type ContextDevProviderAsset = z.infer<typeof providerAssetSchema>
export type ContextDevProviderTextStyle = z.infer<
  typeof providerTextStyleSchema
>

export interface ContextDevRequestContract {
  readonly brand: {
    readonly domain: string
    readonly tags: readonly string[]
    readonly timeoutMS: number
    readonly type: 'by_domain'
  }
  readonly crawl: {
    readonly followSubdomains: false
    readonly includeImages: false
    readonly includeLinks: false
    readonly maxDepth: number
    readonly maxPages: number
    readonly stopAfterMs: number
    readonly tags: readonly string[]
    readonly timeoutMS: number
    readonly url: string
    readonly useMainContentOnly: true
  }
  readonly styleguide: {
    readonly colorScheme: 'light'
    readonly domain: string
    readonly tags: readonly string[]
    readonly timeoutMS: number
  }
}
