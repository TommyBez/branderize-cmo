import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import {
  brandConnectionCapabilitySnapshotSchema,
  connectBrandConnectionInputSchema,
  connectBrandConnectionReceiptSchema,
  disconnectBrandConnectionInputSchema,
  disconnectBrandConnectionReceiptSchema,
} from './connections'

const CONNECTION_ID = '018f47a6-72d3-7a93-b49a-d91f50dd1772'
const ACTION_ID = '018f47a6-72d3-7a93-b49a-d91f50dd1773'
const NOTION_INSTALLATION_ID = 'inst_test_notion_workspace'
const TYPEFULLY_INSTALLATION_ID = 'inst_test_typefully_account'

const TOKEN_LIKE_PATTERN =
  /(?:access|refresh|id)_token|api[_-]?key|client_secret|bearer\s+[a-z0-9]|sk_live|re_[A-Za-z0-9]{16,}/iu

const notionReceipt = {
  accountLabel: 'Acme Notion workspace',
  actionId: ACTION_ID,
  connectionId: CONNECTION_ID,
  connectorUid: 'notion/branderize-test',
  installationId: NOTION_INSTALLATION_ID,
  outcome: 'connection_connected' as const,
  providerSlot: 'notion' as const,
  scopes: ['read'],
}

describe('brand connection contracts', () => {
  it('accepts Notion and Typefully reference payloads without token fields', () => {
    expect(
      connectBrandConnectionInputSchema.parse({
        accountLabel: 'Acme Notion workspace',
        connectorUid: 'notion/branderize-test',
        installationId: NOTION_INSTALLATION_ID,
        providerSlot: 'notion',
        requestId: 'connect-notion-1',
        scopes: ['read'],
      })
    ).toEqual({
      accountLabel: 'Acme Notion workspace',
      connectorUid: 'notion/branderize-test',
      installationId: NOTION_INSTALLATION_ID,
      providerSlot: 'notion',
      requestId: 'connect-notion-1',
      scopes: ['read'],
    })
    expect(
      connectBrandConnectionInputSchema.parse({
        accountLabel: 'Acme Typefully account',
        connectorUid: 'typefully/branderize-test',
        installationId: TYPEFULLY_INSTALLATION_ID,
        providerSlot: 'typefully',
        requestId: 'connect-typefully-1',
      })
    ).toMatchObject({
      installationId: TYPEFULLY_INSTALLATION_ID,
      providerSlot: 'typefully',
      scopes: [],
    })
    expect(() =>
      connectBrandConnectionInputSchema.parse({
        accountLabel: 'Acme Notion workspace',
        connectorUid: 'notion/branderize-test',
        installationId: NOTION_INSTALLATION_ID,
        providerSlot: 'notion',
        requestId: 'connect-notion-2',
        token: 'fake-connect-token',
      })
    ).toThrow()
  })

  it('keeps connect and disconnect receipts on installation ids and labels', () => {
    expect(connectBrandConnectionReceiptSchema.parse(notionReceipt)).toEqual(
      notionReceipt
    )
    expect(
      disconnectBrandConnectionReceiptSchema.parse({
        ...notionReceipt,
        outcome: 'connection_disconnected',
      })
    ).toMatchObject({
      installationId: NOTION_INSTALLATION_ID,
      outcome: 'connection_disconnected',
      providerSlot: 'notion',
    })
    expect(() =>
      connectBrandConnectionReceiptSchema.parse({
        ...notionReceipt,
        accessToken: 'fake-connect-token',
      })
    ).toThrow()
  })

  it('requires an exact slot on disconnect and rejects extra fields', () => {
    expect(
      disconnectBrandConnectionInputSchema.parse({
        providerSlot: 'typefully',
        requestId: 'disconnect-1',
      })
    ).toEqual({
      providerSlot: 'typefully',
      requestId: 'disconnect-1',
    })
    expect(() =>
      disconnectBrandConnectionInputSchema.parse({
        connectionId: CONNECTION_ID,
        providerSlot: 'typefully',
        requestId: 'disconnect-2',
      })
    ).toThrow()
  })

  it('lets a capability snapshot mark a disconnected slot as missing', () => {
    expect(
      brandConnectionCapabilitySnapshotSchema.parse({
        notion: {
          capabilityKey: 'connection:notion',
          kind: 'missing',
        },
        typefully: {
          accountLabel: 'Acme Typefully account',
          capabilityKey: 'connection:typefully',
          connectionId: CONNECTION_ID,
          connectorUid: 'typefully/branderize-test',
          installationId: TYPEFULLY_INSTALLATION_ID,
          kind: 'granted',
          providerSlot: 'typefully',
          scopes: ['drafts'],
        },
      })
    ).toMatchObject({
      notion: { kind: 'missing' },
      typefully: {
        installationId: TYPEFULLY_INSTALLATION_ID,
        kind: 'granted',
      },
    })
  })

  it('keeps graph contracts free of real secrets and token columns', async () => {
    const source = await readFile(
      new URL('./connections.ts', import.meta.url),
      'utf8'
    )
    expect(source).not.toMatch(TOKEN_LIKE_PATTERN)
    expect(source).not.toContain('process.env')
    expect(source).not.toContain('verificationPoll')
    expect(JSON.stringify(notionReceipt)).not.toMatch(TOKEN_LIKE_PATTERN)
  })
})
