import { describe, expect, it } from 'vitest'

import {
  callCurrentTurnBoundaryCheck,
  createDefaultMessageReducer,
  findPrimaryInstalledEve,
  importPublicEveModule,
  readEventId,
  readEventType,
  readFixture,
  readFixtureEvents,
  readRecord,
} from './installed-eve'

const EVENT_ID_PATTERN = /^evt_[0-9A-HJKMNP-TV-Z]{26}$/u

describe('persisted Eve stream compatibility', () => {
  it('replays the approved root task projection with defaultMessageReducer', async () => {
    const installed = await findPrimaryInstalledEve()
    const client = await importPublicEveModule(installed, 'eve/client')
    const reducer = createDefaultMessageReducer(client)
    const events = await readFixtureEvents('root-task-stream.json')
    let projection = reducer.initial()

    for (const event of events) {
      projection = reducer.reduce(projection, event)
    }

    expect(projection).toEqual(await readFixture('root-task-projection.json'))
  })

  it('keeps the task result before the authoritative terminal boundary', async () => {
    const installed = await findPrimaryInstalledEve()
    const client = await importPublicEveModule(installed, 'eve/client')
    const events = await readFixtureEvents('root-task-stream.json')
    const eventTypes = events.map(readEventType)
    const resultIndex = eventTypes.indexOf('result.completed')
    const turnCompletionIndex = eventTypes.indexOf('turn.completed')
    const terminalSessionIndex = eventTypes.indexOf('session.completed')

    expect(resultIndex).toBeGreaterThan(-1)
    expect(turnCompletionIndex).toBeGreaterThan(resultIndex)
    expect(terminalSessionIndex).toBeGreaterThan(turnCompletionIndex)
    expect(eventTypes).not.toContain('session.waiting')
    expect(callCurrentTurnBoundaryCheck(client, events[resultIndex])).toBe(
      false
    )
    expect(
      callCurrentTurnBoundaryCheck(client, events[turnCompletionIndex])
    ).toBe(false)
    expect(
      callCurrentTurnBoundaryCheck(client, events[terminalSessionIndex])
    ).toBe(true)
  })

  it('treats meta.id as persisted delivery identity only', async () => {
    const fixture = readRecord(
      await readFixture('event-id-semantics.json'),
      'event id fixture'
    )
    const rewind = readRecord(fixture.rewind, 'rewind case')
    const retryEvents = fixture.interruptedStepAttempts

    expect(readEventId(rewind.original)).toBe(readEventId(rewind.replayed))
    expect(rewind.original).toEqual(rewind.replayed)
    expect(Array.isArray(retryEvents)).toBe(true)
    if (!Array.isArray(retryEvents)) {
      throw new Error('Expected retry events to be an array')
    }

    const normalizedRetryEvents: unknown[] = []
    for (const event of retryEvents) {
      normalizedRetryEvents.push(event)
    }
    expect(readEventType(normalizedRetryEvents.at(-1))).toBe(
      'session.completed'
    )
    const stepEvents = normalizedRetryEvents.filter(
      (event) => readEventType(event) === 'step.completed'
    )
    expect(stepEvents).toHaveLength(2)
    const [firstStepEvent, secondStepEvent] = stepEvents
    if (firstStepEvent === undefined || secondStepEvent === undefined) {
      throw new Error('Expected two completed retry steps')
    }
    expect(readEventId(firstStepEvent)).not.toBe(readEventId(secondStepEvent))

    const firstData = readRecord(
      readRecord(firstStepEvent, 'first retry event').data,
      'first retry data'
    )
    const secondData = readRecord(
      readRecord(secondStepEvent, 'second retry event').data,
      'second retry data'
    )
    expect({
      sequence: firstData.sequence,
      stepIndex: firstData.stepIndex,
      turnId: firstData.turnId,
    }).toEqual({
      sequence: secondData.sequence,
      stepIndex: secondData.stepIndex,
      turnId: secondData.turnId,
    })
    expect(firstData).not.toHaveProperty('winner')
    expect(secondData).not.toHaveProperty('winner')
  })

  it('keeps every persisted event envelope valid for hook ingestion', async () => {
    const events = await readFixtureEvents('root-task-stream.json')
    const ids = new Set<string>()

    for (const event of events) {
      const eventRecord = readRecord(event, 'stream event')
      const meta = readRecord(eventRecord.meta, 'event meta')
      const id = readEventId(event)

      expect(id).toMatch(EVENT_ID_PATTERN)
      expect(typeof meta.at).toBe('string')
      expect(ids.has(id)).toBe(false)
      ids.add(id)
    }
  })
})
