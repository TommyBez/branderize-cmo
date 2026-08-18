import { canonicalJson, compareCanonicalStrings } from './canonical-json'
import {
  assetCandidateSchema,
  type ContextDevAssetCandidate,
  type ContextDevBrandResponse,
  type ContextDevCrawlResponse,
  type ContextDevNormalizedBrandKit,
  type ContextDevNormalizedColor,
  type ContextDevNormalizedCrawl,
  type ContextDevNormalizedTextStyle,
  type ContextDevProviderAsset,
  type ContextDevProviderColor,
  type ContextDevProviderTextStyle,
  type ContextDevStyleguideResponse,
  normalizedBrandKitSchema,
  normalizedColorSchema,
  normalizedCrawlSchema,
  normalizedTextStyleSchema,
} from './context-dev-contracts'

const HEX_COLOR_PATTERN = /^[0-9a-f]{6}(?:[0-9a-f]{2})?$/
const LEADING_HASH_PATTERN = /^#/
const SHORT_HEX_COLOR_PATTERN = /^[0-9a-f]{3}$/
const TRAILING_DOT_PATTERN = /\.$/
const WWW_PREFIX_PATTERN = /^www\./

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

export const normalizeContextDevDomain = (value: string): string => {
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

const normalizeColors = (
  colors: readonly ContextDevProviderColor[] | undefined
): ContextDevNormalizedColor[] => {
  const unique = new Map<string, ContextDevNormalizedColor>()
  for (const color of colors ?? []) {
    const hex = normalizeHex(color.hex)
    if (hex === null) {
      continue
    }
    const normalized = normalizedColorSchema.parse({
      hex,
      name: normalizeText(color.name),
    })
    unique.set(canonicalJson(normalized), normalized)
  }
  return [...unique.values()].sort((left, right) =>
    compareCanonicalStrings(canonicalJson(left), canonicalJson(right))
  )
}

const normalizeAssets = (
  kind: 'backdrop' | 'logo',
  assets: readonly ContextDevProviderAsset[] | undefined
): ContextDevAssetCandidate[] => {
  const unique = new Map<string, ContextDevAssetCandidate>()
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
  role: ContextDevNormalizedTextStyle['role'],
  style: ContextDevProviderTextStyle | undefined
): ContextDevNormalizedTextStyle | null => {
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

export const normalizeContextDevBrandKit = (
  brandResponse: ContextDevBrandResponse,
  styleguideResponse: ContextDevStyleguideResponse
): ContextDevNormalizedBrandKit => {
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

export const normalizeContextDevCrawl = (
  response: ContextDevCrawlResponse
): ContextDevNormalizedCrawl => {
  const pages = new Map<string, ContextDevNormalizedCrawl['pages'][number]>()
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
