export const DISPATCH_POKE_TIMEOUT_MS = 2000

export interface DispatchPokeConfiguration {
  readonly endpoint: string
  readonly secret: string
}

export type DispatchPokeResult =
  | { readonly outcome: 'accepted' }
  | {
      readonly outcome: 'deferred'
      readonly reason:
        | 'configuration_unavailable'
        | 'request_failed'
        | 'unexpected_status'
    }

export type DispatchFetch = (
  url: string,
  init: RequestInit
) => Promise<Response>

export const postAgentDispatchPoke = async (
  configuration: DispatchPokeConfiguration,
  dependencies: { readonly fetch: DispatchFetch } = {
    fetch: globalThis.fetch,
  }
): Promise<DispatchPokeResult> => {
  try {
    const response = await dependencies.fetch(
      `${configuration.endpoint}/internal/dispatch`,
      {
        cache: 'no-store',
        headers: {
          authorization: `Bearer ${configuration.secret}`,
        },
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(DISPATCH_POKE_TIMEOUT_MS),
      }
    )
    await response.body?.cancel()
    if (response.status !== 202) {
      return { outcome: 'deferred', reason: 'unexpected_status' }
    }
    return { outcome: 'accepted' }
  } catch {
    return { outcome: 'deferred', reason: 'request_failed' }
  }
}
