'use client'

import { useActionState } from 'react'
import { refineIntentAction } from '@/lib/actions'
import { initialFormState } from '@/lib/form-state'

import { FormFeedback, SubmitButton } from './form-feedback'

export const RefineIntentForm = ({
  acceptanceCriteria,
  brandId,
  constraints,
  intentId,
  requestId,
  revision,
}: {
  readonly acceptanceCriteria: string
  readonly brandId: string
  readonly constraints: string
  readonly intentId: string
  readonly requestId: string
  readonly revision: number
}) => {
  const [state, action] = useActionState(refineIntentAction, initialFormState)

  return (
    <form action={action} className="form-stack form-stack--compact">
      <input name="brandId" type="hidden" value={brandId} />
      <input name="intentId" type="hidden" value={intentId} />
      <input name="expectedRevision" type="hidden" value={revision} />
      <input name="requestId" type="hidden" value={requestId} />
      <label className="field">
        <span>Acceptance criteria</span>
        <textarea
          defaultValue={acceptanceCriteria}
          name="acceptanceCriteria"
          placeholder="One criterion per line"
          rows={5}
        />
      </label>
      <label className="field">
        <span>Constraints</span>
        <textarea
          defaultValue={constraints}
          name="constraints"
          placeholder="One constraint per line"
          rows={5}
        />
      </label>
      <FormFeedback state={state} />
      <SubmitButton idleLabel="Save revision" pendingLabel="Saving…" />
    </form>
  )
}
