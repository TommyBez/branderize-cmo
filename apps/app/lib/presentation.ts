export const formatDateTime = (value: Date): string =>
  new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value)

export const formatBytes = (value: number): string =>
  new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 1,
    style: 'unit',
    unit: value >= 1_000_000 ? 'megabyte' : 'kilobyte',
    unitDisplay: 'short',
  }).format(value >= 1_000_000 ? value / 1_000_000 : value / 1000)

export const stringList = (value: unknown): readonly string[] => {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item): item is string => typeof item === 'string')
}

export const lines = (value: unknown): string => stringList(value).join('\n')

const TASK_KIND_LABELS: Readonly<Record<string, string>> = {
  'content.brief.v1': 'Content',
  'content.notion-page.v1': 'Notion page',
  'distribution.channel-plan.v1': 'Distribution',
  'product-marketer.brand-context.v1': 'Product Marketer',
  'seo-discovery.opportunity.v1': 'SEO',
}

const CONNECTION_SLOT_LABELS = {
  notion: 'Notion',
  typefully: 'Typefully',
} as const

export const taskKindLabel = (kind: string): string =>
  TASK_KIND_LABELS[kind] ?? kind

export const connectionSlotLabel = (slot: 'notion' | 'typefully'): string =>
  CONNECTION_SLOT_LABELS[slot]

export const statusLabel = (status: string): string =>
  status.replaceAll('_', ' ')

export const canMutateRole = (role: string): boolean => role !== 'viewer'

export const isActiveWorkStatus = (status: string): boolean =>
  status === 'queued' || status === 'running'

export const readableValue = (value: unknown): string => {
  if (typeof value === 'string') {
    return value
  }
  if (value === null) {
    return '—'
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return 'Value cannot be displayed'
  }
}
