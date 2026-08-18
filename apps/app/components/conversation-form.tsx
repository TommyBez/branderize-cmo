'use client'

import { useActionState } from 'react'
import { createConversationAction } from '@/lib/actions'
import { initialFormState } from '@/lib/form-state'

import { FormFeedback, SubmitButton } from './form-feedback'

export const ConversationForm = ({
  brandId,
  sourceTaskId,
}: {
  readonly brandId: string
  readonly sourceTaskId: string | null
}) => {
  const [state, action] = useActionState(
    createConversationAction,
    initialFormState
  )

  return (
    <form action={action} className="inline-form inline-form--title">
      <input name="brandId" type="hidden" value={brandId} />
      <input name="sourceTaskId" type="hidden" value={sourceTaskId ?? ''} />
      <label className="field field--grow">
        <span>New conversation</span>
        <input
          maxLength={160}
          name="title"
          placeholder="e.g. How do we position the new launch?"
        />
      </label>
      <SubmitButton idleLabel="Open" pendingLabel="Opening…" />
      <FormFeedback state={state} />
    </form>
  )
}
