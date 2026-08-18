import type { EventMessage } from 'posthog-node'
import { describe, expect, it } from 'vitest'
import { sanitizePostHogEvent } from './posthog-node'

const distinctId = 'subject_0123456789abcdef0123456789abcdef'
const brandIdHash = 'brand_0123456789abcdef0123456789abcdef'
const correlationIdHash = 'correlation_0123456789abcdef0123456789abcdef'

describe('PostHog pre-export sanitizer', () => {
  it('keeps only the property allowlist and strips flag context', () => {
    const input: EventMessage = {
      distinctId,
      event: 'brand_created',
      groups: { organization: 'sensitive-group' },
      properties: {
        brand_id_hash: brandIdHash,
        correlation_id_hash: correlationIdHash,
        organization_id_hash: 'organization_0123456789abcdef0123456789abcdef',
        prompt: 'private prompt',
        request_body: { password: 'secret' },
        response: 'private model output',
        service_name: 'app',
        token: 'phc_secret',
        transcript: 'private CMO transcript',
      },
      sendFeatureFlags: true,
    }

    const sanitized = sanitizePostHogEvent(input)

    expect(sanitized).toEqual({
      disableGeoip: true,
      distinctId,
      event: 'brand_created',
      properties: {
        brand_id_hash: brandIdHash,
        organization_id_hash: 'organization_0123456789abcdef0123456789abcdef',
        service_name: 'app',
      },
      timestamp: undefined,
      uuid: undefined,
    })
    expect(JSON.stringify(sanitized)).not.toContain('private')
    expect(JSON.stringify(sanitized)).not.toContain('secret')
    expect(JSON.stringify(sanitized)).not.toContain('sensitive-group')
  })

  it('rebuilds handled exceptions from closed synthetic fields', () => {
    const input: EventMessage = {
      distinctId,
      event: '$exception',
      properties: {
        $exception_list: [
          {
            stacktrace: 'private original stack',
            value: 'secret original Error message',
          },
        ],
        brand_id_hash: brandIdHash,
        correlation_id_hash: correlationIdHash,
        error_code: 'DEPENDENCY_UNAVAILABLE',
        error_surface: 'client',
        operation: 'brand_context_import',
        prompt: 'private prompt',
        retryable: true,
        service_name: 'app',
      },
    }

    const sanitized = sanitizePostHogEvent(input)
    const serialized = JSON.stringify(sanitized)

    expect(sanitized?.event).toBe('$exception')
    expect(serialized).toContain('BranderizeHandledClientError')
    expect(serialized).toContain(
      'DEPENDENCY_UNAVAILABLE during brand_context_import'
    )
    expect(serialized).toContain(correlationIdHash)
    expect(serialized).not.toContain('private')
    expect(serialized).not.toContain('secret')
    expect(serialized).not.toContain('stacktrace')
  })

  it('drops unknown events and raw distinct identifiers', () => {
    expect(
      sanitizePostHogEvent({
        distinctId,
        event: 'arbitrary_event',
        properties: { payload: 'private' },
      })
    ).toBeNull()
    expect(
      sanitizePostHogEvent({
        distinctId: 'customer@example.test',
        event: 'brand_created',
        properties: {
          brand_id_hash: brandIdHash,
          organization_id_hash: 'organization_0123456789abcdef0123456789abcdef',
          service_name: 'app',
        },
      })
    ).toBeNull()
  })
})
