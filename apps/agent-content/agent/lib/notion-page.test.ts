import { describe, expect, it, vi } from 'vitest'

import {
  createScriptedNotionPageClient,
  executeNotionPageCreate,
  PROVIDER_HTTP_TIMEOUT_MS,
} from './notion-page'

const BRAND_ID = '018f47a6-72d3-7a93-b49a-d91f50dd1771'
const REPORT_OBJECT_ID = '018f47a6-72d3-7a93-b49a-d91f50dd1882'
const TOKEN_LIKE_PATTERN =
  /(?:access|refresh|id)_token|api[_-]?key|client_secret|sk_live|re_[A-Za-z0-9]{16,}/iu

describe('Content Notion page handler', () => {
  it('performs exactly one provider call and returns graph-safe receipt fields', async () => {
    const createPage = vi.fn(() =>
      Promise.resolve({
        kind: 'accepted' as const,
        pageId: 'page_scripted_01',
        pageUrl: 'https://notion.example/page_scripted_01',
      })
    )
    const outcome = await executeNotionPageCreate({
      brandId: BRAND_ID,
      createPage: createScriptedNotionPageClient(createPage),
      payload: { reportObjectId: REPORT_OBJECT_ID, title: 'Launch page' },
      readActiveRow: async () => ({
        accountLabel: 'Acme Notion workspace',
        brandId: BRAND_ID,
        connectorUid: 'notion/branderize-test',
        installationId: 'inst_test_notion_workspace',
        providerSlot: 'notion',
        scopes: ['write'],
      }),
      sdk: {
        getToken: () => Promise.resolve('scripted-connect-credential'),
      },
    })

    expect(createPage).toHaveBeenCalledTimes(1)
    expect(outcome).toEqual({
      outcome: 'accepted',
      receipt: {
        accountLabel: 'Acme Notion workspace',
        pageId: 'page_scripted_01',
        pageUrl: 'https://notion.example/page_scripted_01',
      },
    })
    expect(JSON.stringify(outcome)).not.toMatch(TOKEN_LIKE_PATTERN)
    expect(PROVIDER_HTTP_TIMEOUT_MS).toBe(90_000)
  })

  it('makes no provider call when the Notion slot is disconnected', async () => {
    const createPage = vi.fn(() =>
      Promise.resolve({
        kind: 'accepted' as const,
        pageId: 'page_unused',
        pageUrl: 'https://notion.example/unused',
      })
    )
    const outcome = await executeNotionPageCreate({
      brandId: BRAND_ID,
      createPage,
      payload: { reportObjectId: REPORT_OBJECT_ID, title: 'Launch page' },
      readActiveRow: async () => null,
      sdk: {
        getToken: () => {
          throw new Error('getToken must not run without a connection')
        },
      },
    })
    expect(createPage).not.toHaveBeenCalled()
    expect(outcome).toMatchObject({
      code: 'connection_missing',
      outcome: 'unknown',
    })
  })
})
