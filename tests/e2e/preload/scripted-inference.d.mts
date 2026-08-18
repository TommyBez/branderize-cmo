export interface ScriptedInferenceRequest {
  readonly init?: RequestInit
  readonly input: RequestInfo | URL
  readonly url: URL
}

export interface ScriptedInferenceProviderOptions {
  readonly providerStateDirectory: string
  readonly rootAgent?:
    | 'content'
    | 'distribution'
    | 'growth'
    | 'lifecycle'
    | 'seo-discovery'
    | null
}

export type ScriptedInferenceProvider = (
  request: ScriptedInferenceRequest
) => Promise<Response | null>

export declare const ROOT_SMOKE_PROMPT: string

export declare const createScriptedInferenceProvider: (
  options: ScriptedInferenceProviderOptions
) => ScriptedInferenceProvider
