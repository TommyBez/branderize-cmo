import { describe, expect, it } from 'vitest'

import {
  callDefinitionHelper,
  findPrimaryInstalledEve,
  importPublicEveModule,
  readFixture,
  readRecord,
} from './installed-eve'

const isRootSession = (session: Readonly<Record<string, unknown>>): boolean =>
  !Object.hasOwn(session, 'parent')

describe('root-only Eve lineage input', () => {
  it('guards on the absence of ctx.session.parent', async () => {
    const lineage = readRecord(
      await readFixture('session-lineage.json'),
      'lineage fixture'
    )
    const rootSession = readRecord(lineage.root, 'root session')
    const childSession = readRecord(lineage.child, 'child session')

    expect(isRootSession(rootSession)).toBe(true)
    expect(isRootSession(childSession)).toBe(false)
    expect(readRecord(childSession.parent, 'child parent')).toEqual({
      callId: 'call_fixture_01',
      rootSessionId: 'session_root_fixture_01',
      sessionId: 'session_root_fixture_01',
      turn: {
        id: 'turn_root_fixture_01',
        sequence: 0,
      },
    })
  })

  it('preserves stamped event envelopes in an authored hook definition', async () => {
    const installed = await findPrimaryInstalledEve()
    const hooks = await importPublicEveModule(installed, 'eve/hooks')
    const observedIds: string[] = []
    const onEvent = (event: unknown): void => {
      const meta = readRecord(readRecord(event, 'hook event').meta, 'hook meta')
      if (typeof meta.id !== 'string') {
        throw new Error('Expected a stamped hook event id')
      }
      observedIds.push(meta.id)
    }
    const definition = callDefinitionHelper(hooks, 'defineHook', {
      events: { '*': onEvent },
    })
    const { events } = readRecord(definition, 'hook definition')
    const wildcard = readRecord(events, 'hook events')['*']
    if (typeof wildcard !== 'function') {
      throw new Error('Expected the wildcard hook handler')
    }

    const stream = await readFixture('root-task-stream.json')
    if (!Array.isArray(stream)) {
      throw new Error('Expected the root task stream fixture')
    }
    const firstEvent: unknown = stream[0]
    if (firstEvent === undefined) {
      throw new Error('Expected a non-empty root task stream fixture')
    }
    wildcard(firstEvent)

    expect(observedIds).toEqual([
      readRecord(readRecord(firstEvent, 'first event').meta, 'first meta').id,
    ])
  })
})
