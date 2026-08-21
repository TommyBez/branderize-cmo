import { CONTENT_NOTION_PAGE_TASK_KIND } from '@repo/agents/tasks'
import { describe, expect, it } from 'vitest'

import {
  BRAND_TASK_STATUSES,
  isActiveWorkStatus,
  projectApprovalReview,
} from './task-projections'

const TOKEN_LIKE =
  /(?:access|refresh|id)_token|api[_-]?key|client_secret|sk_live|re_[A-Za-z0-9]{16,}/iu

describe('generic work and approval projections', () => {
  it('keeps all eleven task statuses and treats only queued or running as active work', () => {
    expect(BRAND_TASK_STATUSES).toEqual([
      'awaiting_approval',
      'queued',
      'running',
      'succeeded',
      'failed',
      'cancelled',
      'superseded',
      'outcome_unknown',
      'expired',
      'needs_regeneration',
      'dismissed',
    ])
    expect(isActiveWorkStatus('queued')).toBe(true)
    expect(isActiveWorkStatus('running')).toBe(true)
    expect(isActiveWorkStatus('awaiting_approval')).toBe(false)
    expect(isActiveWorkStatus('dismissed')).toBe(false)
    expect(isActiveWorkStatus('succeeded')).toBe(false)
  })

  it('projects a Notion page-create review without exposing token-shaped fields', () => {
    const reportObjectId = '11111111-1111-4111-8111-111111111111'
    const review = projectApprovalReview({
      kind: CONTENT_NOTION_PAGE_TASK_KIND,
      payload: {
        reportObjectId,
        title: 'Launch page',
      },
    })
    expect(review).toEqual({
      kind: CONTENT_NOTION_PAGE_TASK_KIND,
      reportObjectId,
      title: 'Launch page',
    })
    expect(JSON.stringify(review)).not.toMatch(TOKEN_LIKE)
  })

  it('falls back to a generic label when the payload is not a Notion page-create', () => {
    expect(
      projectApprovalReview({
        kind: 'content.brief.v1',
        payload: { purpose: 'draft_brief' },
      })
    ).toEqual({
      kind: 'generic',
      label: 'content.brief.v1',
    })
  })
})
