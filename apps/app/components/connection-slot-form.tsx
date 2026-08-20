'use client'

import { useActionState } from 'react'
import {
  connectBrandConnectionAction,
  disconnectBrandConnectionAction,
} from '@/lib/connection-actions'
import { initialFormState } from '@/lib/form-state'
import { connectionSlotLabel } from '@/lib/presentation'

import { FormFeedback, SubmitButton } from './form-feedback'

export const ConnectConnectionForm = ({
  brandId,
  providerSlot,
  requestId,
}: {
  readonly brandId: string
  readonly providerSlot: 'notion' | 'typefully'
  readonly requestId: string
}) => {
  const [state, action] = useActionState(
    connectBrandConnectionAction,
    initialFormState
  )
  const slotLabel = connectionSlotLabel(providerSlot)

  return (
    <form action={action} className="form-stack form-stack--compact">
      <input name="brandId" type="hidden" value={brandId} />
      <input name="providerSlot" type="hidden" value={providerSlot} />
      <input name="requestId" type="hidden" value={requestId} />
      <label className="field">
        <span>Account label</span>
        <input
          autoComplete="off"
          name="accountLabel"
          placeholder={`${slotLabel} workspace`}
          required
          type="text"
        />
      </label>
      <label className="field">
        <span>Connector</span>
        <input
          autoComplete="off"
          name="connectorUid"
          placeholder={`${providerSlot}/workspace`}
          required
          type="text"
        />
      </label>
      <label className="field">
        <span>Installation id</span>
        <input autoComplete="off" name="installationId" type="text" />
      </label>
      <label className="field">
        <span>Scopes</span>
        <textarea name="scopes" placeholder="One scope per line" rows={3} />
      </label>
      <FormFeedback state={state} />
      <SubmitButton
        idleLabel={`Connect ${slotLabel}`}
        pendingLabel="Connecting…"
      />
    </form>
  )
}

export const DisconnectConnectionForm = ({
  brandId,
  providerSlot,
  requestId,
}: {
  readonly brandId: string
  readonly providerSlot: 'notion' | 'typefully'
  readonly requestId: string
}) => {
  const [state, action] = useActionState(
    disconnectBrandConnectionAction,
    initialFormState
  )

  return (
    <form action={action} className="form-stack form-stack--compact">
      <input name="brandId" type="hidden" value={brandId} />
      <input name="providerSlot" type="hidden" value={providerSlot} />
      <input name="requestId" type="hidden" value={requestId} />
      <FormFeedback state={state} />
      <SubmitButton
        idleLabel={`Disconnect ${connectionSlotLabel(providerSlot)}`}
        pendingLabel="Disconnecting…"
        variant="quiet"
      />
    </form>
  )
}
