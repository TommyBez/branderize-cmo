import { createAuthMiddleware } from 'better-auth/api'

const EMAIL_OTP_PATH_PREFIX = '/email-otp/'
const LEGACY_FORGET_PASSWORD_PATH = '/forget-password/email-otp'
const SEND_VERIFICATION_OTP_PATH = '/email-otp/send-verification-otp'
const SIGN_IN_EMAIL_OTP_PATH = '/sign-in/email-otp'

const readOtpType = (body: unknown): unknown => {
  if (typeof body !== 'object' || body === null || !('type' in body)) {
    return
  }

  return body.type
}

const isEmailOtpPath = (path: string | undefined): boolean =>
  path?.startsWith(EMAIL_OTP_PATH_PREFIX) === true ||
  path === LEGACY_FORGET_PASSWORD_PATH

export const emailOtpSignInOnlyGuard = createAuthMiddleware(
  (context): Promise<Response | undefined> => {
    if (context.path === SIGN_IN_EMAIL_OTP_PATH) {
      return Promise.resolve(undefined)
    }

    const isSignInOtpRequest =
      context.path === SEND_VERIFICATION_OTP_PATH &&
      readOtpType(context.body) === 'sign-in'

    if (isSignInOtpRequest || !isEmailOtpPath(context.path)) {
      return Promise.resolve(undefined)
    }

    return Promise.resolve(new Response('Not Found', { status: 404 }))
  }
)
