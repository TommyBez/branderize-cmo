import { notionPagePayloadSchema } from '@repo/agents/tasks'
import { createActiveBrandConnectionReader } from '@repo/brain/connections'
import { db } from '@repo/db'
import { defineSpecialistDispatchChannel } from '@repo/specialist-runtime'

import {
  createLiveNotionPageClient,
  createScriptedNotionPageClient,
  executeNotionPageCreate,
} from '../lib/notion-page'
import { ROOT_RUNTIME_CONTRACT } from '../lib/root-contract'

const isScriptedProvider = process.env.E2E_PROVIDER_MODE === 'scripted'

const scriptedPageClient = createScriptedNotionPageClient((input) =>
  Promise.resolve({
    kind: 'accepted',
    pageId: `page_${input.reportObjectId.slice(0, 8)}`,
    pageUrl: `https://notion.example/page/${input.reportObjectId.slice(0, 8)}`,
  })
)

const scriptedConnectToken = (): Promise<string> => {
  if (isScriptedProvider) {
    return Promise.resolve('scripted-connect-credential')
  }
  return Promise.reject(
    new Error('Vercel Connect is not configured for this Content deployment')
  )
}

export default defineSpecialistDispatchChannel(ROOT_RUNTIME_CONTRACT, {
  handler: async ({ claim }) => {
    if (claim.kind !== 'content.notion-page.v1') {
      return {
        code: 'unsupported_kind',
        message: 'This Content drain only executes Notion page commitments',
        outcome: 'unknown',
      }
    }
    const payload = notionPagePayloadSchema.parse(claim.payload)
    return await executeNotionPageCreate({
      brandId: claim.brandId,
      createPage: isScriptedProvider
        ? scriptedPageClient
        : createLiveNotionPageClient(),
      payload,
      readActiveRow: createActiveBrandConnectionReader(db),
      sdk: {
        getToken: scriptedConnectToken,
      },
    })
  },
})
