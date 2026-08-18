'use client'

import { useFormStatus } from 'react-dom'

import type { FormState } from '@/lib/form-state'

export const SubmitButton = ({
  idleLabel,
  pendingLabel,
  variant = 'primary',
}: {
  readonly idleLabel: string
  readonly pendingLabel: string
  readonly variant?: 'primary' | 'quiet'
}) => {
  const { pending } = useFormStatus()
  const label = pending ? pendingLabel : idleLabel

  return (
    <button
      className={variant === 'primary' ? 'button' : 'button button--quiet'}
      disabled={pending}
      type="submit"
    >
      <span>{label}</span>
    </button>
  )
}

export const FormFeedback = ({ state }: { readonly state: FormState }) => {
  if (state.kind === 'idle') {
    return null
  }

  return (
    <p
      className={`form-feedback form-feedback--${state.kind}`}
      role={state.kind === 'error' ? 'alert' : 'status'}
    >
      {state.message}
    </p>
  )
}
