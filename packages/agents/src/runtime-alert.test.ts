import { describe, expect, it, vi } from 'vitest'

import { reportSessionEventIngestionFailure } from './runtime-alert'

const CORRELATION_ID = '00000000-0000-4000-8000-000000000201'
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('runtime alert', () => {
  it.each(['agent-cmo', 'agent-product-marketer'] as const)(
    'writes one closed JSON alert for %s',
    (service) => {
      const write = vi.fn()

      reportSessionEventIngestionFailure(service, {
        createCorrelationId: () => CORRELATION_ID,
        write,
      })

      expect(write).toHaveBeenCalledTimes(1)
      const [call] = write.mock.calls
      const record = call?.[0]
      const serializedAlert = record?.trim()
      expect(typeof serializedAlert).toBe('string')
      if (typeof serializedAlert !== 'string') {
        throw new Error('Expected one serialized runtime alert')
      }
      const alert = JSON.parse(serializedAlert) as unknown
      expect(alert).toEqual({
        code: 'SESSION_EVENT_INGESTION_FAILED',
        correlationId: CORRELATION_ID,
        kind: 'runtime_alert',
        service,
      })
      expect(alert).toMatchObject({
        correlationId: expect.stringMatching(UUID_PATTERN),
      })
      expect(Object.keys(alert as Record<string, unknown>).sort()).toEqual([
        'code',
        'correlationId',
        'kind',
        'service',
      ])
    }
  )

  it('cannot throw when stderr rejects the alert', () => {
    expect(() =>
      reportSessionEventIngestionFailure('agent-cmo', {
        createCorrelationId: () => CORRELATION_ID,
        write: () => {
          throw new Error('stderr unavailable')
        },
      })
    ).not.toThrow()
  })
})
