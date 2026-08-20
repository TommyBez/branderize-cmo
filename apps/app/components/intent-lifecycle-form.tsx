'use client'

import { useActionState } from 'react'
import { abandonIntentAction, adoptIntentAction } from '@/lib/actions'
import { initialFormState } from '@/lib/form-state'

import { FormFeedback, SubmitButton } from './form-feedback'

export const AdoptIntentForm = ({
  brandId,
  intentId,
  requestId,
  revision,
}: {
  readonly brandId: string
  readonly intentId: string
  readonly requestId: string
  readonly revision: number
}) => {
  const [state, action] = useActionState(adoptIntentAction, initialFormState)

  return (
    <form action={action} className="form-stack form-stack--compact">
      <input name="brandId" type="hidden" value={brandId} />
      <input name="intentId" type="hidden" value={intentId} />
      <input name="expectedRevision" type="hidden" value={revision} />
      <input name="requestId" type="hidden" value={requestId} />
      <FormFeedback state={state} />
      <SubmitButton idleLabel="Adopt" pendingLabel="Adopting…" />
    </form>
  )
}

export const AbandonIntentForm = ({
  brandId,
  intentId,
  requestId,
  revision,
}: {
  readonly brandId: string
  readonly intentId: string
  readonly requestId: string
  readonly revision: number
}) => {
  const [state, action] = useActionState(abandonIntentAction, initialFormState)

  return (
    <form action={action} className="form-stack form-stack--compact">
      <input name="brandId" type="hidden" value={brandId} />
      <input name="intentId" type="hidden" value={intentId} />
      <input name="expectedRevision" type="hidden" value={revision} />
      <input name="requestId" type="hidden" value={requestId} />
      <FormFeedback state={state} />
      <SubmitButton
        idleLabel="Abandon"
        pendingLabel="Abandoning…"
        variant="quiet"
      />
    </form>
  )
}
