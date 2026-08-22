import { describe, expect, it, vi } from 'vitest'
import type { EmailOtpClient } from './email-otp-email'
import {
  createEmailOtpRuntime,
  createSignInEmailOtpSender,
  type EmailOtpEnvironment,
} from './email-otp-runtime'

const BETTER_AUTH_SECRET = 'test-better-auth-secret-at-least-32-characters'

const productionEnvironment = {
  BETTER_AUTH_SECRET,
  BETTER_AUTH_URL: 'https://app.example.test',
  NODE_ENV: 'production',
  RESEND_API_KEY: 're_production_key',
  RESEND_FROM_EMAIL: 'access@example.test',
  VERCEL_ENV: 'production',
} satisfies EmailOtpEnvironment

describe('email OTP runtime', () => {
  it('uses hashed OTP storage with Resend outside local development', () => {
    const runtime = createEmailOtpRuntime(productionEnvironment)

    expect(runtime.kind).toBe('resend')
    expect(runtime.options).toMatchObject({
      allowedAttempts: 3,
      expiresIn: 300,
      otpLength: 6,
    })
    expect(runtime.options.storeOTP).toBe('hashed')
  })

  it('accepts every submitted OTP on a Portless local origin', () => {
    const runtime = createEmailOtpRuntime({
      AUTH_LOCAL_OTP_BYPASS: '1',
      BETTER_AUTH_SECRET,
      BETTER_AUTH_URL: 'http://app.localhost:1355',
      NODE_ENV: 'development',
      VERCEL_ENV: 'development',
    })
    if (runtime.kind !== 'local-bypass') {
      throw new Error('Expected the local OTP runtime')
    }

    expect(runtime.kind).toBe('local-bypass')
  })

  it('accepts every submitted OTP only in the guarded local runtime', async () => {
    const runtime = createEmailOtpRuntime({
      AUTH_LOCAL_OTP_BYPASS: '1',
      BETTER_AUTH_SECRET,
      BETTER_AUTH_URL: 'http://localhost:3001',
      NODE_ENV: 'development',
      VERCEL_ENV: 'development',
    })
    if (runtime.kind !== 'local-bypass') {
      throw new Error('Expected the local OTP runtime')
    }

    const generatedHash = await runtime.options.storeOTP.hash('731204')
    const arbitraryHash = await runtime.options.storeOTP.hash('any-code')

    expect(arbitraryHash).toBe(generatedHash)
    expect(runtime.options).toMatchObject({
      allowedAttempts: 3,
      expiresIn: 300,
      otpLength: 6,
    })
    await expect(runtime.options.sendVerificationOTP()).resolves.toBeUndefined()
  })

  it('refuses to start email delivery without Resend credentials', () => {
    expect(() =>
      createEmailOtpRuntime({
        BETTER_AUTH_SECRET,
        BETTER_AUTH_URL: 'http://localhost:3001',
        NODE_ENV: 'test',
        VERCEL_ENV: 'development',
      })
    ).toThrow(
      'Resend credentials are required when local OTP bypass is disabled'
    )
  })

  it('rejects a bypass marker in automatic tests', () => {
    expect(() =>
      createEmailOtpRuntime({
        AUTH_LOCAL_OTP_BYPASS: '1',
        BETTER_AUTH_SECRET,
        BETTER_AUTH_URL: 'http://localhost:3001',
        NODE_ENV: 'test',
        VERCEL_ENV: 'development',
      })
    ).toThrow('Local OTP bypass is not valid in this environment')
  })

  it('delivers only sign-in OTPs as a defence-in-depth allowlist', async () => {
    const send: EmailOtpClient['send'] = vi.fn(async () => ({
      data: { id: 'email_123' },
      error: null,
      headers: null,
    }))
    const sendVerificationOTP = createSignInEmailOtpSender({
      client: { send },
      fromEmail: 'access@example.test',
      idempotencySecret: BETTER_AUTH_SECRET,
    })

    await Promise.all(
      (['email-verification', 'forget-password', 'change-email'] as const).map(
        (type) =>
          sendVerificationOTP({
            email: 'owner@example.test',
            otp: '731204',
            type,
          })
      )
    )

    expect(send).not.toHaveBeenCalled()

    await sendVerificationOTP({
      email: 'owner@example.test',
      otp: '731204',
      type: 'sign-in',
    })

    expect(send).toHaveBeenCalledOnce()
  })
})
