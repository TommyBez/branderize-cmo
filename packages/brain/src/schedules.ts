import { agentRegistry } from '@repo/agents'
import {
  type ScheduleTemplate,
  scheduleTemplates,
  validateScheduleTemplates,
} from '@repo/agents/schedules'
import { schedules } from '@repo/db/schema/domain'
import { and, eq } from 'drizzle-orm'

import { requestHash } from './canonical'
import { fail } from './errors'
import type { BrainTransaction } from './internal'

export interface ScheduleReconciliationResult {
  readonly inserted: number
  readonly retained: number
  readonly retired: number
}

const workerForTaskKind = (taskKind: string): string => {
  for (const agent of Object.values(agentRegistry)) {
    if (agent.taskKinds.some((registered) => registered.kind === taskKind)) {
      return agent.key
    }
  }
  return fail(
    'invalid_operation',
    `Schedule template references an unregistered task kind: ${taskKind}`
  )
}

const reconcileActiveTemplate = async ({
  brandId,
  template,
  transaction,
}: {
  readonly brandId: string
  readonly template: Extract<ScheduleTemplate, { lifecycle: 'active' }>
  readonly transaction: BrainTransaction
}): Promise<'inserted' | 'retained'> => {
  const workerKey = workerForTaskKind(template.taskKind)
  const payloadDigest = requestHash(template.fixedPayload)
  const [existing] = await transaction
    .select({
      fixedPayload: schedules.fixedPayload,
      kind: schedules.kind,
      payloadDigest: schedules.payloadDigest,
      workerKey: schedules.workerKey,
    })
    .from(schedules)
    .where(
      and(
        eq(schedules.brandId, brandId),
        eq(schedules.scheduleKey, template.scheduleKey)
      )
    )
    .for('update')
    .limit(1)

  if (existing !== undefined) {
    const bindingMatches =
      existing.kind === template.taskKind &&
      existing.workerKey === workerKey &&
      existing.payloadDigest === payloadDigest &&
      requestHash(existing.fixedPayload) === payloadDigest
    if (!bindingMatches) {
      fail(
        'operation_conflict',
        `Schedule key was already bound to different semantics: ${template.scheduleKey}`
      )
    }
    return 'retained'
  }

  await transaction.insert(schedules).values({
    brandId,
    cadence: template.defaultCadence,
    enabled: false,
    fixedPayload: template.fixedPayload,
    kind: template.taskKind,
    localTime: template.defaultLocalTime,
    localWeekday: template.defaultLocalWeekday ?? null,
    nextScheduledFor: null,
    payloadDigest,
    scheduleKey: template.scheduleKey,
    timeZone: null,
    workerKey,
  })
  return 'inserted'
}

const reconcileRetiredTemplate = async ({
  brandId,
  template,
  transaction,
}: {
  readonly brandId: string
  readonly template: Extract<ScheduleTemplate, { lifecycle: 'retired' }>
  readonly transaction: BrainTransaction
}): Promise<'retained' | 'retired'> => {
  const [existing] = await transaction
    .select({
      enabled: schedules.enabled,
      kind: schedules.kind,
      payloadDigest: schedules.payloadDigest,
      workerKey: schedules.workerKey,
    })
    .from(schedules)
    .where(
      and(
        eq(schedules.brandId, brandId),
        eq(schedules.scheduleKey, template.scheduleKey)
      )
    )
    .for('update')
    .limit(1)

  if (existing === undefined) {
    return 'retained'
  }

  const frozenBindingMatches =
    existing.kind === template.frozenBinding.taskKind &&
    existing.workerKey === template.frozenBinding.workerKey &&
    existing.payloadDigest === template.frozenBinding.fixedPayloadDigest
  if (!frozenBindingMatches) {
    fail(
      'operation_conflict',
      `Retired schedule tombstone does not match its stored binding: ${template.scheduleKey}`
    )
  }

  if (!existing.enabled) {
    return 'retained'
  }

  await transaction
    .update(schedules)
    .set({ enabled: false, nextScheduledFor: null })
    .where(
      and(
        eq(schedules.brandId, brandId),
        eq(schedules.scheduleKey, template.scheduleKey)
      )
    )
  return 'retired'
}

export const reconcileBrandSchedules = async ({
  brandId,
  transaction,
}: {
  readonly brandId: string
  readonly transaction: BrainTransaction
}): Promise<ScheduleReconciliationResult> => {
  const templates = validateScheduleTemplates(scheduleTemplates)
  const results = await Promise.all(
    templates.map((template) =>
      template.lifecycle === 'active'
        ? reconcileActiveTemplate({ brandId, template, transaction })
        : reconcileRetiredTemplate({ brandId, template, transaction })
    )
  )
  let inserted = 0
  let retained = 0
  let retired = 0

  for (const result of results) {
    if (result === 'inserted') {
      inserted += 1
    } else if (result === 'retired') {
      retired += 1
    } else {
      retained += 1
    }
  }

  return { inserted, retained, retired }
}
