import { access, readdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPOSITORY_ROOT = dirname(
  dirname(dirname(fileURLToPath(import.meta.url)))
)
const APPS_DIRECTORY = join(REPOSITORY_ROOT, 'apps')

type JsonRecord = Readonly<Record<string, unknown>>

export interface InstalledEve {
  readonly dependencySpecifier: string
  readonly entryPath: string
  readonly owner: string
  readonly ownerManifestPath: string
  readonly resolutionManifestPath: string
  readonly version: string
}

export interface UnknownReducer {
  initial: () => unknown
  reduce: (data: unknown, event: unknown) => unknown
}

const isJsonRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const parseJsonRecord = (contents: string, source: string): JsonRecord => {
  const parsed: unknown = JSON.parse(contents)
  if (!isJsonRecord(parsed)) {
    throw new Error(`Expected ${source} to contain a JSON object`)
  }
  return parsed
}

const readJsonRecord = async (path: string): Promise<JsonRecord> =>
  parseJsonRecord(await readFile(path, 'utf8'), path)

const readStringProperty = (record: JsonRecord, key: string): string => {
  const value = record[key]
  if (typeof value !== 'string') {
    throw new Error(`Expected ${key} to be a string`)
  }
  return value
}

const readEveDependency = (manifest: JsonRecord): string | null => {
  const { dependencies } = manifest
  if (!isJsonRecord(dependencies)) {
    return null
  }
  const { eve } = dependencies
  return typeof eve === 'string' ? eve : null
}

const readPackageVersion = async (entryPath: string): Promise<string> => {
  const manifestUrl = new URL('../../package.json', pathToFileURL(entryPath))
  const manifest = await readJsonRecord(fileURLToPath(manifestUrl))
  return readStringProperty(manifest, 'version')
}

const resolveInstalledEve = (
  ownerManifestPath: string
): Readonly<{ entryPath: string; resolutionManifestPath: string }> => {
  const requireFromOwner = createRequire(ownerManifestPath)
  return {
    entryPath: requireFromOwner.resolve('eve'),
    resolutionManifestPath: ownerManifestPath,
  }
}

export const findInstalledEvePackages = async (): Promise<InstalledEve[]> => {
  const appEntries = await readdir(APPS_DIRECTORY, { withFileTypes: true })
  const candidates = await Promise.all(
    appEntries
      .filter((appEntry) => appEntry.isDirectory())
      .map(async (appEntry): Promise<InstalledEve | null> => {
        const ownerManifestPath = join(
          APPS_DIRECTORY,
          appEntry.name,
          'package.json'
        )
        try {
          await access(ownerManifestPath)
        } catch {
          return null
        }
        const manifest = await readJsonRecord(ownerManifestPath)
        const dependencySpecifier = readEveDependency(manifest)
        if (dependencySpecifier === null) {
          return null
        }

        const { entryPath, resolutionManifestPath } =
          resolveInstalledEve(ownerManifestPath)
        return {
          dependencySpecifier,
          entryPath,
          owner: readStringProperty(manifest, 'name'),
          ownerManifestPath,
          resolutionManifestPath,
          version: await readPackageVersion(entryPath),
        }
      })
  )
  const installed = candidates.filter(
    (candidate): candidate is InstalledEve => candidate !== null
  )

  return installed.sort((left, right) => left.owner.localeCompare(right.owner))
}

export const findPrimaryInstalledEve = async (): Promise<InstalledEve> => {
  const installed = await findInstalledEvePackages()
  const primary =
    installed.find(({ owner }) => owner === 'agent-cmo') ?? installed.at(0)

  if (primary === undefined) {
    throw new Error('Expected at least one app to depend on eve')
  }
  return primary
}

const importModule = async (moduleUrl: string): Promise<JsonRecord> => {
  const imported: unknown = await import(moduleUrl)
  if (!isJsonRecord(imported)) {
    throw new Error(`Expected ${moduleUrl} to export a module namespace`)
  }
  return imported
}

export const importPublicEveModule = (
  installed: InstalledEve,
  specifier: 'eve' | 'eve/client' | 'eve/evals' | 'eve/hooks'
): Promise<JsonRecord> => {
  const requireFromOwner = createRequire(installed.resolutionManifestPath)
  const modulePath = requireFromOwner.resolve(specifier)
  return importModule(pathToFileURL(modulePath).href)
}

export const importSourcePinnedEveModule = (
  installed: InstalledEve,
  relativePath: string
): Promise<JsonRecord> => {
  const moduleUrl = new URL(relativePath, pathToFileURL(installed.entryPath))
  return importModule(moduleUrl.href)
}

export const callDefinitionHelper = (
  moduleNamespace: JsonRecord,
  exportName: 'defineAgent' | 'defineDynamic' | 'defineHook',
  definition: unknown
): unknown => {
  const helper = moduleNamespace[exportName]
  if (typeof helper !== 'function') {
    throw new Error(`Expected eve to export ${exportName}`)
  }
  const result: unknown = helper(definition)
  return result
}

export const callCurrentTurnBoundaryCheck = (
  clientModule: JsonRecord,
  event: unknown
): boolean => {
  const { isCurrentTurnBoundaryEvent } = clientModule
  if (typeof isCurrentTurnBoundaryEvent !== 'function') {
    throw new Error('Expected the public Eve turn-boundary helper')
  }

  const result: unknown = isCurrentTurnBoundaryEvent(event)
  if (typeof result !== 'boolean') {
    throw new Error('Expected the Eve turn-boundary helper to return a boolean')
  }
  return result
}

export const createDefaultMessageReducer = (
  clientModule: JsonRecord
): UnknownReducer => {
  const factory = clientModule.defaultMessageReducer
  if (typeof factory !== 'function') {
    throw new Error('Expected eve/client to export defaultMessageReducer')
  }

  const reducer: unknown = factory()
  if (!isJsonRecord(reducer)) {
    throw new Error('Expected defaultMessageReducer to return an object')
  }

  const { initial, reduce } = reducer
  if (typeof initial !== 'function' || typeof reduce !== 'function') {
    throw new Error('Expected an eve reducer with initial and reduce functions')
  }

  return {
    initial: (): unknown => initial(),
    reduce: (data: unknown, event: unknown): unknown => reduce(data, event),
  }
}

export const callCreateCompactionConfig = (
  sourceModule: JsonRecord,
  contextWindowTokens: number
): JsonRecord => {
  const { createCompactionConfig } = sourceModule
  if (typeof createCompactionConfig !== 'function') {
    throw new Error('Expected the source-pinned compaction factory')
  }

  const config: unknown = createCompactionConfig({ contextWindowTokens })
  if (!isJsonRecord(config)) {
    throw new Error('Expected an eve compaction configuration')
  }
  return config
}

export const readFixture = async (relativePath: string): Promise<unknown> => {
  const path = join(REPOSITORY_ROOT, 'fixtures', 'eve', relativePath)
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
  return parsed
}

export const readFixtureEvents = async (
  relativePath: string
): Promise<readonly unknown[]> => {
  const fixture = await readFixture(relativePath)
  if (!Array.isArray(fixture)) {
    throw new Error(`Expected ${relativePath} to contain an event array`)
  }
  const events: unknown[] = []
  for (const event of fixture) {
    events.push(event)
  }
  return events
}

export const readRecord = (value: unknown, label: string): JsonRecord => {
  if (!isJsonRecord(value)) {
    throw new Error(`Expected ${label} to be an object`)
  }
  return value
}

export const readEventType = (event: unknown): string => {
  const { type } = readRecord(event, 'event')
  if (typeof type !== 'string') {
    throw new Error('Expected event.type to be a string')
  }
  return type
}

export const readEventId = (event: unknown): string => {
  const meta = readRecord(readRecord(event, 'event').meta, 'event.meta')
  const { id } = meta
  if (typeof id !== 'string') {
    throw new Error('Expected event.meta.id to be a string')
  }
  return id
}
