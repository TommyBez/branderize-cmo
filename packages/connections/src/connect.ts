import { z } from 'zod'

export const PROVIDER_SLOTS = ['notion', 'typefully'] as const

export type ProviderSlot = (typeof PROVIDER_SLOTS)[number]

export const providerSlotSchema = z.enum(PROVIDER_SLOTS)

export const capabilityKeyForSlot = (
  providerSlot: ProviderSlot
): `connection:${ProviderSlot}` => `connection:${providerSlot}`

const nonBlankSchema = z.string().trim().min(1).max(512)

export const activeBrandConnectionSchema = z
  .object({
    accountLabel: nonBlankSchema.max(240),
    brandId: z.uuid(),
    connectorUid: nonBlankSchema,
    installationId: nonBlankSchema.nullable(),
    providerSlot: providerSlotSchema,
    scopes: z.array(nonBlankSchema.max(128)).max(64),
  })
  .strict()

export type ActiveBrandConnection = z.infer<typeof activeBrandConnectionSchema>

export type ReadActiveBrandConnection = (input: {
  readonly brandId: string
  readonly providerSlot: ProviderSlot
}) => Promise<ActiveBrandConnection | null>

export interface ConnectTokenParams {
  readonly installationId?: string
  readonly subject: { readonly type: 'app' }
}

export interface ConnectSdk {
  readonly getToken: (
    connectorUid: string,
    params: ConnectTokenParams
  ) => Promise<string>
}

export type ConnectResolution =
  | {
      readonly accountLabel: string
      readonly capability: {
        readonly capabilityKey: `connection:${ProviderSlot}`
        readonly kind: 'granted'
      }
      readonly connectorUid: string
      readonly installationId: string | null
      readonly kind: 'ready'
      readonly providerSlot: ProviderSlot
      readonly scopes: readonly string[]
      readonly token: string
    }
  | {
      readonly capability: {
        readonly capabilityKey: `connection:${ProviderSlot}`
        readonly kind: 'missing'
      }
      readonly kind: 'missing'
      readonly providerSlot: ProviderSlot
    }

const appSubject = { type: 'app' } as const

export const createConnectResolver = (dependencies: {
  readonly readActiveRow: ReadActiveBrandConnection
  readonly sdk: ConnectSdk
}) => ({
  resolve: async (input: {
    readonly brandId: string
    readonly providerSlot: ProviderSlot
  }): Promise<ConnectResolution> => {
    const providerSlot = providerSlotSchema.parse(input.providerSlot)
    const row = await dependencies.readActiveRow({
      brandId: z.uuid().parse(input.brandId),
      providerSlot,
    })
    if (row === null) {
      return {
        capability: {
          capabilityKey: capabilityKeyForSlot(providerSlot),
          kind: 'missing',
        },
        kind: 'missing',
        providerSlot,
      }
    }

    const activeRow = activeBrandConnectionSchema.parse(row)
    const params: ConnectTokenParams =
      activeRow.installationId === null
        ? { subject: appSubject }
        : {
            installationId: activeRow.installationId,
            subject: appSubject,
          }
    const token = await dependencies.sdk.getToken(
      activeRow.connectorUid,
      params
    )

    return {
      accountLabel: activeRow.accountLabel,
      capability: {
        capabilityKey: capabilityKeyForSlot(activeRow.providerSlot),
        kind: 'granted',
      },
      connectorUid: activeRow.connectorUid,
      installationId: activeRow.installationId,
      kind: 'ready',
      providerSlot: activeRow.providerSlot,
      scopes: activeRow.scopes,
      token,
    }
  },
})
