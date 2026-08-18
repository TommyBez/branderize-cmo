'use client'

import { createBranderizeAuthClient } from '@repo/auth/client'
import { type FormEvent, useEffect, useRef, useState } from 'react'

type SubmissionState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'sending' }
  | { readonly kind: 'send-error' }
  | { readonly email: string; readonly kind: 'awaiting-code' }
  | { readonly email: string; readonly kind: 'verifying' }
  | { readonly email: string; readonly kind: 'verify-error' }

export const SignInForm = ({
  localOtpBypass,
}: {
  readonly localOtpBypass: boolean
}) => {
  const [state, setState] = useState<SubmissionState>({ kind: 'idle' })
  const otpInput = useRef<HTMLInputElement>(null)
  const sending = state.kind === 'sending'
  const email = 'email' in state ? state.email : undefined

  useEffect(() => {
    if (email !== undefined) {
      otpInput.current?.focus()
    }
  }, [email])

  const requestCode = async (
    event: FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const emailValue = formData.get('email')
    if (typeof emailValue !== 'string' || emailValue.trim().length === 0) {
      setState({ kind: 'send-error' })
      return
    }

    const requestedEmail = emailValue.trim()
    setState({ kind: 'sending' })

    try {
      const client = createBranderizeAuthClient({
        environment: { NEXT_PUBLIC_APP_URL: window.location.origin },
      })
      const result = await client.emailOtp.sendVerificationOtp({
        email: requestedEmail,
        type: 'sign-in',
      })

      setState(
        result.error === null
          ? { email: requestedEmail, kind: 'awaiting-code' }
          : { kind: 'send-error' }
      )
    } catch {
      setState({ kind: 'send-error' })
    }
  }

  const resetEmail = (): void => setState({ kind: 'idle' })

  const verifyCode = async (
    event: FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault()
    if (email === undefined) {
      setState({ kind: 'idle' })
      return
    }

    const formData = new FormData(event.currentTarget)
    const otpValue = formData.get('otp')
    if (typeof otpValue !== 'string' || otpValue.trim().length === 0) {
      setState({ email, kind: 'verify-error' })
      return
    }

    setState({ email, kind: 'verifying' })

    try {
      const client = createBranderizeAuthClient({
        environment: { NEXT_PUBLIC_APP_URL: window.location.origin },
      })
      const result = await client.signIn.emailOtp({
        email,
        name: email,
        otp: otpValue.trim(),
      })

      if (result.error !== null) {
        setState({ email, kind: 'verify-error' })
        return
      }

      window.location.assign('/')
    } catch {
      setState({ email, kind: 'verify-error' })
    }
  }

  if (email !== undefined) {
    const verifying = state.kind === 'verifying'

    return (
      <form className="auth-action auth-email-form" onSubmit={verifyCode}>
        <p aria-live="polite" className="form-feedback" role="status">
          {localOtpBypass
            ? `Local development for ${email}: enter any code.`
            : `We sent a code to ${email}.`}
        </p>
        <label className="field" htmlFor="sign-in-otp">
          <span>Sign-in code</span>
          <input
            aria-describedby="sign-in-otp-help"
            autoCapitalize="none"
            autoComplete="one-time-code"
            disabled={verifying}
            id="sign-in-otp"
            inputMode="numeric"
            maxLength={6}
            name="otp"
            placeholder="123456"
            ref={otpInput}
            required
            spellCheck={false}
            type="text"
          />
        </label>
        <small id="sign-in-otp-help">
          {localOtpBypass
            ? 'The local runner does not send email.'
            : 'Expires in five minutes. One use only.'}
        </small>
        <button
          className="button button--wide"
          disabled={verifying}
          type="submit"
        >
          {verifying ? 'Signing in…' : 'Sign in'}
        </button>
        <button
          className="auth-text-button"
          disabled={verifying}
          onClick={resetEmail}
          type="button"
        >
          Use a different email
        </button>
        {state.kind === 'verify-error' ? (
          <p className="form-feedback form-feedback--error" role="alert">
            That code didn’t work. Check it and try again.
          </p>
        ) : null}
      </form>
    )
  }

  return (
    <form className="auth-action auth-email-form" onSubmit={requestCode}>
      <label className="field" htmlFor="sign-in-email">
        <span>Email</span>
        <input
          aria-describedby="sign-in-email-help"
          autoCapitalize="none"
          autoComplete="email"
          disabled={sending}
          id="sign-in-email"
          inputMode="email"
          name="email"
          placeholder="you@company.com"
          required
          spellCheck={false}
          type="email"
        />
      </label>
      <small id="sign-in-email-help">
        {localOtpBypass
          ? 'Locally you’ll go straight to the code. No email is sent.'
          : 'You’ll get a one-time code. No password.'}
      </small>
      <button className="button button--wide" disabled={sending} type="submit">
        {sending ? 'Sending…' : 'Email me a code'}
      </button>
      {state.kind === 'send-error' ? (
        <p className="form-feedback form-feedback--error" role="alert">
          We couldn’t send the code. Try again in a moment.
        </p>
      ) : null}
    </form>
  )
}
