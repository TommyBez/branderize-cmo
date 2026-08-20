'use client'

import { useActionState } from 'react'
import {
  approveTaskAction,
  cancelTaskAction,
  dismissTaskAction,
  reopenTaskAction,
} from '@/lib/actions'
import { initialFormState } from '@/lib/form-state'

import { FormFeedback, SubmitButton } from './form-feedback'

const HiddenTaskFields = ({
  brandId,
  expectedRevision,
  requestId,
  taskId,
}: {
  readonly brandId: string
  readonly expectedRevision?: number
  readonly requestId: string
  readonly taskId: string
}) => (
  <>
    <input name="brandId" type="hidden" value={brandId} />
    <input name="taskId" type="hidden" value={taskId} />
    <input name="requestId" type="hidden" value={requestId} />
    {expectedRevision === undefined ? null : (
      <input name="expectedRevision" type="hidden" value={expectedRevision} />
    )}
  </>
)

export const ApproveCommitmentForm = ({
  brandId,
  idleLabel,
  requestId,
  revision,
  taskId,
}: {
  readonly brandId: string
  readonly idleLabel: string
  readonly requestId: string
  readonly revision: number
  readonly taskId: string
}) => {
  const [state, action] = useActionState(approveTaskAction, initialFormState)

  return (
    <form action={action} className="form-stack form-stack--compact">
      <HiddenTaskFields
        brandId={brandId}
        expectedRevision={revision}
        requestId={requestId}
        taskId={taskId}
      />
      <FormFeedback state={state} />
      <SubmitButton idleLabel={idleLabel} pendingLabel="Approving…" />
    </form>
  )
}

export const DismissCommitmentForm = ({
  brandId,
  requestId,
  taskId,
}: {
  readonly brandId: string
  readonly requestId: string
  readonly taskId: string
}) => {
  const [state, action] = useActionState(dismissTaskAction, initialFormState)

  return (
    <form action={action} className="form-stack form-stack--compact">
      <HiddenTaskFields
        brandId={brandId}
        requestId={requestId}
        taskId={taskId}
      />
      <FormFeedback state={state} />
      <SubmitButton
        idleLabel="Dismiss"
        pendingLabel="Dismissing…"
        variant="quiet"
      />
    </form>
  )
}

export const ReopenCommitmentForm = ({
  brandId,
  requestId,
  taskId,
}: {
  readonly brandId: string
  readonly requestId: string
  readonly taskId: string
}) => {
  const [state, action] = useActionState(reopenTaskAction, initialFormState)

  return (
    <form action={action} className="form-stack form-stack--compact">
      <HiddenTaskFields
        brandId={brandId}
        requestId={requestId}
        taskId={taskId}
      />
      <FormFeedback state={state} />
      <SubmitButton idleLabel="Reopen" pendingLabel="Reopening…" />
    </form>
  )
}

export const CancelCommitmentForm = ({
  brandId,
  requestId,
  taskId,
}: {
  readonly brandId: string
  readonly requestId: string
  readonly taskId: string
}) => {
  const [state, action] = useActionState(cancelTaskAction, initialFormState)

  return (
    <form action={action} className="form-stack form-stack--compact">
      <HiddenTaskFields
        brandId={brandId}
        requestId={requestId}
        taskId={taskId}
      />
      <FormFeedback state={state} />
      <SubmitButton
        idleLabel="Cancel"
        pendingLabel="Cancelling…"
        variant="quiet"
      />
    </form>
  )
}
