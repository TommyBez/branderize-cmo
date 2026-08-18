'use client'

import { useActionState } from 'react'
import { retryContextImportAction } from '@/lib/actions'
import { initialFormState } from '@/lib/form-state'

import { FormFeedback, SubmitButton } from './form-feedback'

export const ContextImportForm = ({
  brandId,
}: {
  readonly brandId: string
}) => {
  const [state, action] = useActionState(
    retryContextImportAction,
    initialFormState
  )

  return (
    <form action={action} className="inline-form">
      <input name="brandId" type="hidden" value={brandId} />
      <SubmitButton idleLabel="Start import" pendingLabel="Importing…" />
      <FormFeedback state={state} />
    </form>
  )
}
