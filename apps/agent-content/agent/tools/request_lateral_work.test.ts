import { readdirSync, readFileSync } from 'node:fs'

import type { ClaimedTask } from '@repo/brain/tasks'
import { taskGenerationOf } from '@repo/brain/tasks'
import { parseAgentServerEnvironment } from '@repo/env/agent-server'
import {
  createTaskSessionAuth,
  requireRootTaskSession,
} from '@repo/specialist-runtime/testing'
import type { ToolContext } from 'eve/tools'
import { describe, expect, it } from 'vitest'

import requestLateralWorkTool, {
  requestLateralWorkToolInputSchema,
} from './request_lateral_work'

const SOURCE_REPORT_OBJECT_ID = '00000000-0000-4000-8000-000000000202'
const validInput = {
  kind: 'distribution.channel-plan.v1' as const,
  payload: {
    purpose: 'draft_channel_plan' as const,
    sourceReportObjectId: SOURCE_REPORT_OBJECT_ID,
  },
  rationale: 'Turn the Content report into a channel plan.',
}

const contentClaim: ClaimedTask = {
  agentActorId: '00000000-0000-0000-0000-000000000103',
  agentActorKey: 'agent:content',
  brandId: '00000000-0000-0000-0000-000000000201',
  claimContext: {
    brandContextContent: { summary: 'Current context' },
    brandContextObjectId: '00000000-0000-0000-0000-000000000208',
  },
  intentSnapshot: {
    acceptance_criteria: [{ metric: 'qualified demand' }],
    brand_id: '00000000-0000-0000-0000-000000000201',
    constraints: null,
    intent_id: '00000000-0000-0000-0000-000000000203',
    intent_revision: 1,
    preauthorizations: [],
    statement: 'Publish the homepage brief',
  },
  kind: 'content.brief.v1',
  payload: { purpose: 'draft_content_brief' },
  startedAt: taskGenerationOf(new Date('2026-08-20T10:00:00.000Z')),
  taskId: '00000000-0000-4000-8000-000000000301',
  workerKey: 'content',
}

const rootContext = () => {
  const auth = createTaskSessionAuth(contentClaim)
  return {
    session: {
      auth: { current: auth, initiator: auth },
      id: 'session-content-root',
      turn: { id: 'turn-content', sequence: 0 },
    },
  }
}

describe('request_lateral_work tool', () => {
  it('accepts the closed Distribution kind and a source report Object id', () => {
    expect(requestLateralWorkToolInputSchema.parse(validInput)).toEqual(
      validInput
    )
  })

  it.each([
    { ...validInput, brandId: '00000000-0000-0000-0000-000000000201' },
    { ...validInput, intentId: '00000000-0000-0000-0000-000000000203' },
    { ...validInput, parentTaskId: '00000000-0000-4000-8000-000000000301' },
    { ...validInput, workerKey: 'distribution' },
    {
      ...validInput,
      endpoint: 'https://distribution.example.test',
    },
    {
      kind: 'seo-discovery.opportunity.v1',
      payload: validInput.payload,
      rationale: validInput.rationale,
    },
    {
      kind: 'distribution.channel-plan.v1',
      payload: { purpose: 'draft_channel_plan' },
      rationale: validInput.rationale,
    },
  ])('rejects a model-facing selector %#', (input) => {
    expect(requestLateralWorkToolInputSchema.safeParse(input).success).toBe(
      false
    )
  })

  it('fails closed on a child session before calling the brain', async () => {
    const root = rootContext()
    const childContext = {
      session: {
        ...root.session,
        id: 'session-content-child',
        parent: {
          callId: 'call-content-child',
          rootSessionId: root.session.id,
          sessionId: root.session.id,
          turn: root.session.turn,
        },
      },
    }
    expect(() => requireRootTaskSession(root)).not.toThrow()
    await expect(
      requestLateralWorkTool.execute(validInput, childContext as ToolContext)
    ).rejects.toThrow('FINISH_TASK_ROOT_ONLY')
  })

  it('documents cron claim latency and does not poke a sibling URL', () => {
    const source = readFileSync(
      new URL('./request_lateral_work.ts', import.meta.url),
      'utf8'
    )
    expect(source).toContain('cron cycle')
    expect(source).not.toContain('dispatch-poke')
    expect(source).not.toContain('AGENT_DISTRIBUTION_URL')
    expect(source).not.toContain('AGENT_LIFECYCLE_URL')
    expect(source).not.toContain('AGENT_GROWTH_URL')
    expect(readdirSync(new URL('../', import.meta.url))).not.toContain(
      'subagents'
    )
  })

  it('keeps Content on the specialist env without sibling URLs', () => {
    const environment = parseAgentServerEnvironment({
      AGENT_DISTRIBUTION_URL: 'https://distribution.example.test',
      AGENT_GROWTH_URL: 'https://growth.example.test',
      AGENT_LIFECYCLE_URL: 'https://lifecycle.example.test',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/branderize',
      DISPATCH_SECRET: 'dispatch-secret-at-least-32-characters',
      NODE_ENV: 'test',
    })
    expect('AGENT_DISTRIBUTION_URL' in environment).toBe(false)
    expect('AGENT_GROWTH_URL' in environment).toBe(false)
    expect('AGENT_LIFECYCLE_URL' in environment).toBe(false)
  })
})
