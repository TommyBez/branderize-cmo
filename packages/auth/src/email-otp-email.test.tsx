import { render } from 'react-email'
import { describe, expect, it, vi } from 'vitest'
import {
  createEmailOtpIdempotencyKey,
  type EmailOtpClient,
  EmailOtpEmail,
  sendEmailOtpEmail,
} from './email-otp-email'

const IDEMPOTENCY_KEY_PATTERN = /^sign-in-email-otp\/[0-9a-f]{64}$/u
const IDEMPOTENCY_SECRET = 'test-better-auth-secret-at-least-32-characters'
const IDEMPOTENCY_TEST_VECTOR =
  'sign-in-email-otp/c78488d84d3dc809d7e6c07a351e4005994bd1e9e1351abec25ddf211de89131'

describe('email OTP delivery', () => {
  it('renders the access code through React Email', async () => {
    const html = await render(<EmailOtpEmail otp="731204" />)
    const text = await render(<EmailOtpEmail otp="731204" />, {
      plainText: true,
    })

    expect(html).toContain('Your sign-in code')
    expect(html).toContain('731204')
    expect(text).toContain('731204')
    expect(text).toContain('5 minutes')
  })

  it('sends the React Email template through Resend', async () => {
    const send: EmailOtpClient['send'] = vi.fn(async () => ({
      data: { id: 'email_123' },
      error: null,
      headers: null,
    }))

    await sendEmailOtpEmail({
      client: { send },
      email: 'owner@example.test',
      fromEmail: 'access@example.test',
      idempotencySecret: IDEMPOTENCY_SECRET,
      otp: '731204',
    })

    expect(send).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Branderize <access@example.test>',
        react: expect.any(Object),
        subject: 'Your Branderize sign-in code',
        text: expect.stringContaining('731204'),
        to: 'owner@example.test',
      }),
      {
        idempotencyKey: IDEMPOTENCY_TEST_VECTOR,
      }
    )
  })

  it('derives an opaque, bounded HMAC idempotency key', () => {
    const key = createEmailOtpIdempotencyKey({
      email: 'owner@example.test',
      fromEmail: 'access@example.test',
      idempotencySecret: IDEMPOTENCY_SECRET,
      otp: '731204',
    })
    const keyForAnotherOtp = createEmailOtpIdempotencyKey({
      email: 'owner@example.test',
      fromEmail: 'access@example.test',
      idempotencySecret: IDEMPOTENCY_SECRET,
      otp: '019283',
    })

    expect(key).toBe(IDEMPOTENCY_TEST_VECTOR)
    expect(key).toMatch(IDEMPOTENCY_KEY_PATTERN)
    expect(key.length).toBeLessThanOrEqual(256)
    expect(key).not.toContain('owner@example.test')
    expect(key).not.toContain('access@example.test')
    expect(key).not.toContain('731204')
    expect(key).not.toContain(IDEMPOTENCY_SECRET)
    expect(keyForAnotherOtp).not.toBe(key)
  })

  it('does not expose provider details when delivery fails', async () => {
    const providerMessage = 'restricted key for owner@example.test'
    const providerFailure = {
      data: null,
      error: {
        message: providerMessage,
        name: 'restricted_api_key',
        statusCode: 401,
      },
      headers: null,
    } satisfies Awaited<ReturnType<EmailOtpClient['send']>>
    const send: EmailOtpClient['send'] = vi.fn(async () => providerFailure)

    const delivery = sendEmailOtpEmail({
      client: { send },
      email: 'owner@example.test',
      fromEmail: 'access@example.test',
      idempotencySecret: IDEMPOTENCY_SECRET,
      otp: '731204',
    })

    await expect(delivery).rejects.toThrow(
      'Resend could not deliver the access-code email'
    )
    await expect(delivery).rejects.not.toThrow(providerMessage)
  })
})
