import {
  type ContextDevAdapter as ContextDevAdapterContract,
  type ContextDevAdapterDependencies as ContextDevAdapterDependenciesContract,
  createContextDevAdapter as createAdapter,
} from './context-dev-adapter'
import {
  contextDevBrandResponseSchema as brandResponseSchema,
  type ContextDevSnapshot as ContextDevSnapshotContract,
  contextDevCrawlResponseSchema as crawlResponseSchema,
  contextDevSnapshotSchema as snapshotSchema,
  contextDevStyleguideResponseSchema as styleguideResponseSchema,
} from './context-dev-contracts'
import {
  ContextDevAdapterError as AdapterError,
  type ContextDevAdapterErrorCode as AdapterErrorCode,
  type ContextDevAdapterErrorOptions as AdapterErrorOptions,
} from './context-dev-transport'

export type ContextDevAdapter = ContextDevAdapterContract
export type ContextDevAdapterDependencies =
  ContextDevAdapterDependenciesContract
export type ContextDevSnapshot = ContextDevSnapshotContract
export type ContextDevAdapterErrorCode = AdapterErrorCode
export type ContextDevAdapterErrorOptions = AdapterErrorOptions
export type ContextDevAdapterError = InstanceType<typeof AdapterError>

export const createContextDevAdapter = createAdapter
export const contextDevBrandResponseSchema = brandResponseSchema
export const contextDevCrawlResponseSchema = crawlResponseSchema
export const contextDevSnapshotSchema = snapshotSchema
export const contextDevStyleguideResponseSchema = styleguideResponseSchema
export const ContextDevAdapterError = AdapterError
