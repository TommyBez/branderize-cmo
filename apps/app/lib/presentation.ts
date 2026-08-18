export const formatDateTime = (value: Date): string =>
  new Intl.DateTimeFormat('it-IT', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value)

export const formatBytes = (value: number): string =>
  new Intl.NumberFormat('it-IT', {
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
    return 'Valore non rappresentabile'
  }
}
