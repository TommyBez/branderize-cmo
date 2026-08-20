import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'

import {
  type ActiveBrandConnection,
  type ConnectSdk,
  createConnectResolver,
  providerSlotSchema,
} from './connect'

const BRAND_ID = '018f47a6-72d3-7a93-b49a-d91f50dd1771'
const NOTION_INSTALLATION_ID = 'inst_test_notion_workspace'
const TYPEFULLY_INSTALLATION_ID = 'inst_test_typefully_account'
const TOKEN_COLUMN_PATTERN = /access_token|refresh_token|api_key/u

const notionRow: ActiveBrandConnection = {
  accountLabel: 'Acme Notion workspace',
  brandId: BRAND_ID,
  connectorUid: 'notion/branderize-test',
  installationId: NOTION_INSTALLATION_ID,
  providerSlot: 'notion',
  scopes: ['read', 'write'],
}

const typefullyRow: ActiveBrandConnection = {
  accountLabel: 'Acme Typefully account',
  brandId: BRAND_ID,
  connectorUid: 'typefully/branderize-test',
  installationId: TYPEFULLY_INSTALLATION_ID,
  providerSlot: 'typefully',
  scopes: ['drafts'],
}

const createSdk = (): ConnectSdk & {
  readonly getToken: ReturnType<typeof vi.fn<ConnectSdk['getToken']>>
} => ({
  getToken: vi.fn<ConnectSdk['getToken']>(async () => 'fake-connect-token'),
})

describe('trusted Vercel Connect factory', () => {
  it('resolves an active row through the injected reader and app subject', async () => {
    const sdk = createSdk()
    const readActiveRow = vi.fn(async () => notionRow)
    const resolver = createConnectResolver({ readActiveRow, sdk })

    const resolution = await resolver.resolve({
      brandId: BRAND_ID,
      providerSlot: 'notion',
    })

    expect(readActiveRow).toHaveBeenCalledWith({
      brandId: BRAND_ID,
      providerSlot: 'notion',
    })
    expect(sdk.getToken).toHaveBeenCalledWith('notion/branderize-test', {
      installationId: NOTION_INSTALLATION_ID,
      subject: { type: 'app' },
    })
    expect(resolution).toMatchObject({
      accountLabel: 'Acme Notion workspace',
      capability: {
        capabilityKey: 'connection:notion',
        kind: 'granted',
      },
      connectorUid: 'notion/branderize-test',
      installationId: NOTION_INSTALLATION_ID,
      kind: 'ready',
      providerSlot: 'notion',
    })
    expect(resolution.kind === 'ready' ? resolution.token : null).toBe(
      'fake-connect-token'
    )
  })

  it('omits installation id when the active row has none', async () => {
    const sdk = createSdk()
    const resolver = createConnectResolver({
      readActiveRow: async () => ({
        ...typefullyRow,
        installationId: null,
      }),
      sdk,
    })

    await resolver.resolve({
      brandId: BRAND_ID,
      providerSlot: 'typefully',
    })

    expect(sdk.getToken).toHaveBeenCalledWith('typefully/branderize-test', {
      subject: { type: 'app' },
    })
  })

  it('returns a missing capability without throwing or calling the SDK', async () => {
    const sdk = createSdk()
    const resolver = createConnectResolver({
      readActiveRow: async () => null,
      sdk,
    })

    await expect(
      resolver.resolve({
        brandId: BRAND_ID,
        providerSlot: 'typefully',
      })
    ).resolves.toEqual({
      capability: {
        capabilityKey: 'connection:typefully',
        kind: 'missing',
      },
      kind: 'missing',
      providerSlot: 'typefully',
    })
    expect(sdk.getToken).not.toHaveBeenCalled()
  })

  it('never reads process.env while resolving a connection', async () => {
    const envReads: string[] = []
    const originalEnv = process.env
    process.env = new Proxy(originalEnv, {
      get(target, property, receiver) {
        if (typeof property === 'string') {
          envReads.push(property)
        }
        return Reflect.get(target, property, receiver)
      },
      ownKeys(target) {
        envReads.push('[[ownKeys]]')
        return Reflect.ownKeys(target)
      },
    })

    try {
      const resolver = createConnectResolver({
        readActiveRow: async () => notionRow,
        sdk: createSdk(),
      })
      await resolver.resolve({
        brandId: BRAND_ID,
        providerSlot: providerSlotSchema.parse('notion'),
      })
    } finally {
      process.env = originalEnv
    }

    expect(envReads).toEqual([])
  })

  it('keeps the connect module free of env reads and token-column names', async () => {
    const source = await readFile(
      new URL('./connect.ts', import.meta.url),
      'utf8'
    )

    expect(source).not.toContain('process.env')
    expect(source).not.toMatch(TOKEN_COLUMN_PATTERN)
  })
})
