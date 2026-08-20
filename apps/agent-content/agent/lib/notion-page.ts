import { notionPageReceiptSchema } from '@repo/agents/tasks'
import type { CommitmentOutcome } from '@repo/brain/tasks'
import {
  type ConnectResolution,
  type ConnectSdk,
  createConnectResolver,
  type ReadActiveBrandConnection,
} from '@repo/connections/connect'

export const PROVIDER_HTTP_TIMEOUT_MS = 90_000

export interface NotionPageCreateRequest {
  readonly reportObjectId: string
  readonly title: string
  readonly token: string
}

export type NotionPageCreateResponse =
  | {
      readonly kind: 'accepted'
      readonly pageId: string
      readonly pageUrl: string
    }
  | {
      readonly code: string
      readonly kind: 'rejected' | 'unknown'
      readonly message: string
    }

export type NotionPageCreateClient = (
  input: NotionPageCreateRequest,
  signal: AbortSignal
) => Promise<NotionPageCreateResponse>

export interface CreateNotionPageInput {
  readonly brandId: string
  readonly createPage: NotionPageCreateClient
  readonly payload: {
    readonly reportObjectId: string
    readonly title: string
  }
  readonly readActiveRow: ReadActiveBrandConnection
  readonly sdk: ConnectSdk
}

const NOTION_PAGES_URL = 'https://api.notion.com/v1/pages'

export const createScriptedNotionPageClient = (
  createPage: NotionPageCreateClient
): NotionPageCreateClient => createPage

export const createLiveNotionPageClient =
  (fetchImpl: typeof fetch = fetch): NotionPageCreateClient =>
  async (input, signal) => {
    try {
      const response = await fetchImpl(NOTION_PAGES_URL, {
        body: JSON.stringify({
          parent: { type: 'workspace', workspace: true },
          properties: {
            title: {
              title: [{ text: { content: input.title } }],
            },
          },
        }),
        headers: {
          authorization: `Bearer ${input.token}`,
          'content-type': 'application/json',
          'notion-version': '2022-06-28',
        },
        method: 'POST',
        signal,
      })
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) {
          return {
            code: `http_${response.status}`,
            kind: 'rejected',
            message: 'Notion rejected the page-create command',
          }
        }
        return {
          code: `http_${response.status}`,
          kind: 'unknown',
          message: 'Notion returned an ambiguous page-create response',
        }
      }
      const body: unknown = await response.json()
      if (
        typeof body !== 'object' ||
        body === null ||
        !('id' in body) ||
        typeof body.id !== 'string' ||
        !('url' in body) ||
        typeof body.url !== 'string'
      ) {
        return {
          code: 'malformed_receipt',
          kind: 'unknown',
          message: 'Notion accepted the command without a stable receipt',
        }
      }
      return {
        kind: 'accepted',
        pageId: body.id,
        pageUrl: body.url,
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          code: 'timeout',
          kind: 'unknown',
          message: 'The Notion page-create call timed out',
        }
      }
      return {
        code: 'transport_error',
        kind: 'unknown',
        message: 'The Notion page-create call did not return a usable receipt',
      }
    }
  }

const outcomeFromResolution = (
  resolution: ConnectResolution
): CommitmentOutcome | null => {
  if (resolution.kind === 'ready') {
    return null
  }
  return {
    code: 'connection_missing',
    message: 'The Notion connection was not active at execution time',
    outcome: 'unknown',
  }
}

export const executeNotionPageCreate = async ({
  brandId,
  createPage,
  payload,
  readActiveRow,
  sdk,
}: CreateNotionPageInput): Promise<CommitmentOutcome> => {
  const resolver = createConnectResolver({ readActiveRow, sdk })
  const resolution = await resolver.resolve({
    brandId,
    providerSlot: 'notion',
  })
  const missing = outcomeFromResolution(resolution)
  if (missing !== null) {
    return missing
  }
  if (resolution.kind !== 'ready') {
    return {
      code: 'connection_missing',
      message: 'The Notion connection was not active at execution time',
      outcome: 'unknown',
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort()
  }, PROVIDER_HTTP_TIMEOUT_MS)
  try {
    const response = await createPage(
      {
        reportObjectId: payload.reportObjectId,
        title: payload.title,
        token: resolution.token,
      },
      controller.signal
    )
    if (response.kind === 'accepted') {
      const receipt = notionPageReceiptSchema.parse({
        accountLabel: resolution.accountLabel,
        pageId: response.pageId,
        pageUrl: response.pageUrl,
      })
      return {
        outcome: 'accepted',
        receipt,
      }
    }
    return {
      code: response.code,
      message: response.message,
      outcome: response.kind,
    }
  } finally {
    clearTimeout(timeout)
  }
}
