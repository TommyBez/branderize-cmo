import { describe, expect, it } from 'vitest'

import type { BrainError } from './errors'
import {
  listBrandIntentsInputSchema,
  listBrandObjectsInputSchema,
  listTaskQuestionBundlesInputSchema,
  projectBrandImportStatus,
} from './projections'

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

  it('keeps filtering and pagination on closed server-side fields', () => {
    expect(listBrandIntentsInputSchema.parse({})).toEqual({
      cursor: null,
      limit: 25,
      status: null,
    })
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
