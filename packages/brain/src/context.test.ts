import { MEMBER_ROLES } from '@repo/policy'
import { describe, expect, it } from 'vitest'
import {
  canMutate,
  memberRoleSchema,
  trustedCmoTurnAccessSchema,
  trustedTaskExecutionSchema,
} from './context'

describe('trusted brain context', () => {
  it('derives its member-role schema from Policy', () => {
    expect(memberRoleSchema.options).toEqual(MEMBER_ROLES)
    expect(memberRoleSchema.safeParse('billing-admin').success).toBe(false)
  })

  it('keeps viewers read-only', () => {
    expect(canMutate('viewer')).toBe(false)
    expect(canMutate('member')).toBe(true)
  })

  it('rejects caller-authored fields outside the trusted CMO envelope', () => {
    expect(
      trustedCmoTurnAccessSchema.safeParse({
        brandId: 'brand',
        callId: 'call',
        cmoActorId: 'actor',
        cmoActorKey: 'agent:cmo',
        conversationId: 'conversation',
        endpoint: 'https://attacker.example',
        humanActorId: 'human',
        humanActorKey: 'human:user',
        organizationId: 'organization',
        role: 'member',
        rootSessionId: 'session',
        sessionId: 'session',
        turnId: 'turn',
        userId: 'user',
      }).success
    ).toBe(false)
  })

  it('requires a persisted task execution generation', () => {
    const execution = {
      agentActorId: 'agent-id',
      agentActorKey: 'agent:product-marketer',
      brandId: 'brand-id',
      rootSessionId: 'session-id',
      sessionId: 'session-id',
      taskId: 'task-id',
      workerKey: 'product-marketer',
    }

    expect(trustedTaskExecutionSchema.safeParse(execution).success).toBe(false)
    expect(
      trustedTaskExecutionSchema.safeParse({
        ...execution,
        startedAt: new Date('2026-08-17T12:00:00.000Z'),
      }).success
    ).toBe(true)
  })
})
