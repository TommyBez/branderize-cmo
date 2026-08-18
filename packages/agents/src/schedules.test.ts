import { describe, expect, it } from 'vitest'

import { scheduleTemplates, validateScheduleTemplates } from './schedules'

const retiredTemplate = {
  displayLabel: 'Legacy daily brief',
  frozenBinding: {
    fixedPayloadDigest: 'a'.repeat(64),
    taskKind: 'daily-brief.v0',
    workerKey: 'cmo',
  },
  lifecycle: 'retired',
  scheduleKey: 'daily-brief.v0',
} as const

describe('schedule template registry', () => {
  it('has no executable cadence before Phase 2', () => {
    expect(validateScheduleTemplates(scheduleTemplates)).toEqual([])
  })

  it('accepts retained tombstones and rejects key reuse', () => {
    expect(validateScheduleTemplates([retiredTemplate])).toHaveLength(1)
    expect(() =>
      validateScheduleTemplates([retiredTemplate, retiredTemplate])
    ).toThrow('Duplicate schedule template key')
  })

  it('enforces the cadence calendar shape', () => {
    expect(() =>
      validateScheduleTemplates([
        {
          defaultCadence: 'weekly',
          defaultEnabled: false,
          defaultLocalTime: '09:00:00',
          fixedPayload: {},
          lifecycle: 'active',
          scheduleKey: 'weekly-audit.v1',
          taskKind: 'weekly-audit.v1',
        },
      ])
    ).toThrow('Weekly templates require a weekday')
  })
})
