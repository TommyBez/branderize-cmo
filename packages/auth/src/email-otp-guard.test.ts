import { betterAuth } from 'better-auth'
import { type MemoryDB, memoryAdapter } from 'better-auth/adapters/memory'
import { type EmailOTPOptions, emailOTP } from 'better-auth/plugins/email-otp'
import { describe, expect, it, vi } from 'vitest'
import { emailOtpSignInOnlyGuard } from './email-otp-guard'

const AUTH_BASE_URL = 'http://localhost:3001'
const AUTH_SECRET = 'email-otp-guard-test-secret-at-least-thirty-two-bytes'
const EXISTING_EMAIL = 'existing@example.test'
const MISSING_EMAIL = 'missing@example.test'
const SIX_DIGIT_OTP_PATTERN = /^\d{6}$/u

const createGuardedTestAuth = () => {
  const database: MemoryDB = {
    account: [],
    session: [],
    user: [
      {
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        email: EXISTING_EMAIL,
        emailVerified: true,
        id: 'user_existing',
        name: 'Existing user',
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ],
    verification: [],
  }
  const sendVerificationOTP = vi.fn<EmailOTPOptions['sendVerificationOTP']>(
    async () => {
      // The mock records whether delivery was attempted.
    }
  )
  const auth = betterAuth({
    baseURL: AUTH_BASE_URL,
    database: memoryAdapter(database),
    emailAndPassword: { enabled: false },
    hooks: { before: emailOtpSignInOnlyGuard },
    plugins: [
      emailOTP({
        allowedAttempts: 3,
        expiresIn: 300,
        otpLength: 6,
        sendVerificationOTP,
        storeOTP: 'hashed',
      }),
    ],
    rateLimit: { enabled: false },
    secret: AUTH_SECRET,
  })

  return { auth, database, sendVerificationOTP }
}

const postAuthJson = async ({
  body,
  handler,
  path,
}: {
  readonly body: Readonly<Record<string, string>>
  readonly handler: (request: Request) => Promise<Response>
  readonly path: string
}): Promise<Readonly<{ body: string; status: number }>> => {
  const response = await handler(
    new Request(`${AUTH_BASE_URL}/api/auth${path}`, {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
        origin: AUTH_BASE_URL,
      },
      method: 'POST',
    })
  )

  return { body: await response.text(), status: response.status }
}

describe('sign-in-only email OTP route guard', () => {
  it('blocks unsupported types identically before existing-user lookup', async () => {
    const { auth, database, sendVerificationOTP } = createGuardedTestAuth()
    const results = await Promise.all(
      [EXISTING_EMAIL, MISSING_EMAIL].map((email) =>
        postAuthJson({
          body: { email, type: 'forget-password' },
          handler: auth.handler,
          path: '/email-otp/send-verification-otp',
        })
      )
    )

    expect(results).toEqual([
      { body: 'Not Found', status: 404 },
      { body: 'Not Found', status: 404 },
    ])
    expect(sendVerificationOTP).not.toHaveBeenCalled()
    expect(database.verification).toEqual([])
  })

  it('blocks unused password-reset delivery before existing-user lookup', async () => {
    const { auth, database, sendVerificationOTP } = createGuardedTestAuth()
    const results = await Promise.all(
      [EXISTING_EMAIL, MISSING_EMAIL].map((email) =>
        postAuthJson({
          body: { email },
          handler: auth.handler,
          path: '/email-otp/request-password-reset',
        })
      )
    )

    expect(results).toEqual([
      { body: 'Not Found', status: 404 },
      { body: 'Not Found', status: 404 },
    ])
    expect(sendVerificationOTP).not.toHaveBeenCalled()
    expect(database.verification).toEqual([])
  })

  it('allows the sign-in delivery endpoint', async () => {
    const { auth, database, sendVerificationOTP } = createGuardedTestAuth()

    const result = await postAuthJson({
      body: { email: MISSING_EMAIL, type: 'sign-in' },
      handler: auth.handler,
      path: '/email-otp/send-verification-otp',
    })

    expect(result).toEqual({ body: '{"success":true}', status: 200 })
    expect(sendVerificationOTP).toHaveBeenCalledOnce()
    expect(sendVerificationOTP).toHaveBeenCalledWith(
      {
        email: MISSING_EMAIL,
        otp: expect.stringMatching(SIX_DIGIT_OTP_PATTERN),
        type: 'sign-in',
      },
      expect.any(Object)
    )
    expect(database.verification).toHaveLength(1)
  })
})
