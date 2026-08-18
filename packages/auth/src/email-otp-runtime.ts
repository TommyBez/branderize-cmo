import type { AppServerEnvironment } from '@repo/env/app-server'
import { isGuardedLocalEmailOtpEnvironment } from '@repo/env/local-email-otp'
import type { EmailOTPOptions } from 'better-auth/plugins/email-otp'
import { Resend } from 'resend'
import { type EmailOtpClient, sendEmailOtpEmail } from './email-otp-email'

const LOCAL_OTP_HASH = 'branderize-local-email-otp-bypass'
const EMAIL_OTP_POLICY = {
  allowedAttempts: 3,
  expiresIn: 300,
  otpLength: 6,
} as const

export type EmailOtpEnvironment = Pick<
  AppServerEnvironment,
  | 'AUTH_LOCAL_OTP_BYPASS'
  | 'BETTER_AUTH_SECRET'
  | 'BETTER_AUTH_URL'
  | 'NODE_ENV'
  | 'RESEND_API_KEY'
  | 'RESEND_FROM_EMAIL'
  | 'VERCEL_ENV'
>

const requireResendConfiguration = (
  environment: EmailOtpEnvironment
): Readonly<{
  apiKey: string
  fromEmail: string
  idempotencySecret: string
}> => {
  if (
    environment.RESEND_API_KEY === undefined ||
    environment.RESEND_FROM_EMAIL === undefined
  ) {
    throw new Error(
      'Resend credentials are required when local OTP bypass is disabled'
    )
  }

  return {
    apiKey: environment.RESEND_API_KEY,
    fromEmail: environment.RESEND_FROM_EMAIL,
    idempotencySecret: environment.BETTER_AUTH_SECRET,
  }
}

export const createSignInEmailOtpSender =
  ({
    client,
    fromEmail,
    idempotencySecret,
  }: {
    readonly client: EmailOtpClient
    readonly fromEmail: string
    readonly idempotencySecret: string
  }): EmailOTPOptions['sendVerificationOTP'] =>
  async ({ email, otp, type }): Promise<void> => {
    if (type !== 'sign-in') {
      return
    }

    await sendEmailOtpEmail({
      client,
      email,
      fromEmail,
      idempotencySecret,
      otp,
    })
  }

export const createEmailOtpRuntime = (environment: EmailOtpEnvironment) => {
  if (
    environment.AUTH_LOCAL_OTP_BYPASS === '1' &&
    !isGuardedLocalEmailOtpEnvironment(environment)
  ) {
    throw new Error('Local OTP bypass is not valid in this environment')
  }

  if (isGuardedLocalEmailOtpEnvironment(environment)) {
    return {
      kind: 'local-bypass',
      options: {
        ...EMAIL_OTP_POLICY,
        sendVerificationOTP: async (): Promise<void> => {
          // Local development deliberately performs no delivery.
        },
        storeOTP: {
          hash: async (_otp: string): Promise<string> => LOCAL_OTP_HASH,
        },
      },
    } as const
  }

  const resendConfiguration = requireResendConfiguration(environment)
  const resend = new Resend(resendConfiguration.apiKey)

  return {
    kind: 'resend',
    options: {
      ...EMAIL_OTP_POLICY,
      sendVerificationOTP: createSignInEmailOtpSender({
        client: resend.emails,
        fromEmail: resendConfiguration.fromEmail,
        idempotencySecret: resendConfiguration.idempotencySecret,
      }),
      storeOTP: 'hashed',
    },
  } as const
}
