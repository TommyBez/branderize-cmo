import type { CaptureResult } from 'posthog-js'
import { describe, expect, it } from 'vitest'

import { sanitizeClientPostHogEvent } from './posthog.client'

const syntheticErrorEvent = (): CaptureResult => ({
  event: '$exception',
  properties: {
    distinct_id: 'service:app',
    error_code: 'CLIENT_RENDER_FAILURE',
    error_surface: 'client',
    retryable: true,
    service_name: 'app',
    token: 'phc_12345678',
  },
  timestamp: new Date('2026-08-17T00:00:00.000Z'),
  uuid: '0198b75e-5800-7000-8000-000000000000',
})

describe('sanitizeClientPostHogEvent', () => {
  it('rebuilds the synthetic exception from a closed allowlist', () => {
    const event = syntheticErrorEvent()
    event.properties.prompt = 'must not leave the browser'
    event.properties.response_body = { secret: 'must not leave the browser' }
    event.properties.$current_url = 'https://example.test/private'

    const sanitized = sanitizeClientPostHogEvent(event)

    expect(sanitized).not.toBeNull()
    expect(Object.keys(sanitized?.properties ?? {}).sort()).toEqual(
      [
        '$exception_fingerprint',
        '$exception_level',
        '$exception_list',
        '$process_person_profile',
        'distinct_id',
        'error_code',
        'error_surface',
        'retryable',
        'service_name',
        'token',
      ].sort()
    )
    expect(JSON.stringify(sanitized)).not.toContain('must not leave')
    expect(JSON.stringify(sanitized)).not.toContain('private')
  })

  it('drops every event outside the one synthetic client error', () => {
    expect(
      sanitizeClientPostHogEvent({
        ...syntheticErrorEvent(),
        event: '$pageview',
      })
    ).toBeNull()
    expect(
      sanitizeClientPostHogEvent({
        ...syntheticErrorEvent(),
        properties: {
          ...syntheticErrorEvent().properties,
          error_code: 'raw-error-message',
        },
      })
    ).toBeNull()
  })
})
