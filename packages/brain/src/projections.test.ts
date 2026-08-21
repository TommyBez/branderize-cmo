import type { RegisteredTaskKind } from '@repo/agents'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import type { BrainError } from './errors'
import {
  listBrandIntentProposalsInputSchema,
  listBrandIntentsInputSchema,
  listBrandObjectsInputSchema,
  listTaskQuestionBundlesInputSchema,
  projectBrandImportStatus,
  projectRegisteredTaskQuestionBundle,
} from './projections'

const syntheticQuestionCompletionSchema = z
  .object({
    openQuestions: z.array(z.string().min(1)).min(1),
    outputObjectIds: z.array(z.string()),
    reason: z.string().min(1),
    result: z.object({ outcome: z.literal('needs_input') }).strict(),
    status: z.literal('partial'),
    summary: z.string().min(1),
  })
  .strict()

const syntheticQuestionTaskKind = {
  acceptsPlanRouteOrigin: false,
  activation: 'automatic',
  briefSchema: z.object({ topic: z.string().min(1) }).strict(),
  budgetClass: 'standard',
  buildTaskPrompt: () => 'synthetic question task',
  claimContextSchema: z.unknown(),
  completionResultSchema: z
    .object({ outcome: z.literal('needs_input') })
    .strict(),
  completionSchema: syntheticQuestionCompletionSchema,
  effectPhase: 'graph-internal',
  executionMode: 'agent',
  intentAcceptance: 'ineligible',
  kind: 'content.questions.v1',
  outputContract: [],
  questionPolicy: {
    hasOpenQuestions: (completion: unknown) =>
      syntheticQuestionCompletionSchema.parse(completion).openQuestions.length >
      0,
    projectOpenQuestions: (completion: unknown) => {
      const parsed = syntheticQuestionCompletionSchema.parse(completion)
      return {
        questions: parsed.openQuestions,
        reason: parsed.reason,
        status: parsed.status,
        summary: parsed.summary,
      }
    },
  },
  requiredOutputObjectIds: () => [],
  requires: [],
  schedulableBy: ['agent'],
  subjectKey: (payload: unknown) => {
    const parsed = z.object({ topic: z.string().min(1) }).parse(payload)
    return `content:${parsed.topic}`
  },
  workerKey: 'content',
} as const satisfies RegisteredTaskKind<
  'content.questions.v1',
  { readonly topic: string },
  { readonly outcome: 'needs_input' },
  z.output<typeof syntheticQuestionCompletionSchema>
>

describe('tenant-safe projection contracts', () => {
  it('models only import state that the Phase 0 schema can prove', () => {
    expect(
      projectBrandImportStatus({
        activeBrandContextObjectIds: [],
        contextImportClaimExpired: false,
        onboardingStatus: 'incomplete',
      })
    ).toEqual({
      currentBrandContextObjectId: null,
      kind: 'incomplete',
      retryAvailable: true,
    })
    expect(
      projectBrandImportStatus({
        activeBrandContextObjectIds: ['context-current'],
        contextImportClaimExpired: false,
        onboardingStatus: 'importing',
      })
    ).toEqual({
      currentBrandContextObjectId: 'context-current',
      kind: 'importing',
      retryAvailable: false,
    })
    expect(
      projectBrandImportStatus({
        activeBrandContextObjectIds: [],
        contextImportClaimExpired: true,
        onboardingStatus: 'importing',
      })
    ).toEqual({
      currentBrandContextObjectId: null,
      kind: 'importing',
      retryAvailable: true,
    })
    expect(
      projectBrandImportStatus({
        activeBrandContextObjectIds: ['context-current'],
        contextImportClaimExpired: false,
        onboardingStatus: 'ready',
      })
    ).toEqual({
      currentBrandContextObjectId: 'context-current',
      kind: 'ready',
      retryAvailable: false,
    })
  })

  it('fails closed for an impossible ready or ambiguous context head', () => {
    expect(() =>
      projectBrandImportStatus({
        activeBrandContextObjectIds: [],
        contextImportClaimExpired: false,
        onboardingStatus: 'ready',
      })
    ).toThrow(
      expect.objectContaining<Partial<BrainError>>({ code: 'invalid_output' })
    )
    expect(() =>
      projectBrandImportStatus({
        activeBrandContextObjectIds: ['context-a', 'context-b'],
        contextImportClaimExpired: false,
        onboardingStatus: 'ready',
      })
    ).toThrow(
      expect.objectContaining<Partial<BrainError>>({ code: 'invalid_output' })
    )
  })

  it('projects a registry-provided question kind without Product Marketer knowledge', () => {
    const createdAt = new Date('2026-08-18T10:00:00.000Z')
    const task = {
      activation: 'automatic',
      brandId: 'brand-a',
      completion: {
        openQuestions: ['Which proof should the content cite?'],
        outputObjectIds: [],
        reason: 'missing_source',
        result: { outcome: 'needs_input' },
        status: 'partial',
        summary: 'A source is still required.',
      },
      createdAt,
      executionMode: 'agent',
      intentId: 'intent-a',
      kind: 'content.questions.v1',
      payload: { topic: 'launch' },
      resolutionActionId: null,
      resolvedAt: null,
      status: 'succeeded',
      subjectKey: 'content:launch',
      taskId: 'task-a',
      workerKey: 'content',
    }

    expect(
      projectRegisteredTaskQuestionBundle({
        task,
        taskKind: syntheticQuestionTaskKind,
      })
    ).toEqual({
      brandId: 'brand-a',
      createdAt,
      intentId: 'intent-a',
      questions: ['Which proof should the content cite?'],
      reason: 'missing_source',
      resolution: { kind: 'open' },
      status: 'partial',
      summary: 'A source is still required.',
      taskId: 'task-a',
    })
    expect(() =>
      projectRegisteredTaskQuestionBundle({
        task: { ...task, workerKey: 'growth' },
        taskKind: syntheticQuestionTaskKind,
      })
    ).toThrow(
      expect.objectContaining<Partial<BrainError>>({ code: 'invalid_task' })
    )
  })

  it('keeps filtering and pagination on closed server-side fields', () => {
    expect(listBrandIntentsInputSchema.parse({})).toEqual({
      cursor: null,
      limit: 25,
      status: null,
    })
    expect(listBrandIntentProposalsInputSchema.parse({})).toEqual({
      cursor: null,
      limit: 25,
    })
    expect(
      listBrandIntentProposalsInputSchema.safeParse({ status: 'draft' }).success
    ).toBe(false)
    expect(listBrandObjectsInputSchema.parse({})).toEqual({
      cursor: null,
      limit: 25,
      status: null,
      type: null,
    })
    expect(listTaskQuestionBundlesInputSchema.parse({})).toEqual({
      cursor: null,
      limit: 25,
      state: 'open',
    })

    expect(
      listBrandObjectsInputSchema.safeParse({
        orderBy: 'created_at; DROP TABLE objects',
      }).success
    ).toBe(false)
    expect(
      listTaskQuestionBundlesInputSchema.safeParse({ state: 'hidden' }).success
    ).toBe(false)
  })
})
