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
        <span>Nuova conversazione</span>
        <input
          maxLength={160}
          name="title"
          placeholder="Es. Come posizioniamo il nuovo lancio?"
        />
      </label>
      <SubmitButton idleLabel="Apri" pendingLabel="Apertura…" />
      <FormFeedback state={state} />
    </form>
  )
}
