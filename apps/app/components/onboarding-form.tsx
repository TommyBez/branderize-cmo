'use client'

import { useActionState } from 'react'
import { onboardBrandAction } from '@/lib/actions'
import type { OrganizationNavigationItem } from '@/lib/dal'
import { initialFormState } from '@/lib/form-state'

import { FormFeedback, SubmitButton } from './form-feedback'

export const OnboardingForm = ({
  organizations,
  requestId,
}: {
  readonly organizations: readonly OrganizationNavigationItem[]
  readonly requestId: string
}) => {
  const [state, action] = useActionState(onboardBrandAction, initialFormState)
  const hasOrganizations = organizations.length > 0

  return (
    <form action={action} className="form-stack">
      <input name="requestId" type="hidden" value={requestId} />

      {hasOrganizations ? (
        <label className="field">
          <span>Organizzazione</span>
          <select defaultValue={organizations[0]?.id} name="organizationId">
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
            <option value="">Crea una nuova organizzazione</option>
          </select>
        </label>
      ) : (
        <input name="organizationId" type="hidden" value="" />
      )}

      <div className="field-pair">
        <label className="field">
          <span>Nome organizzazione</span>
          <input
            autoComplete="organization"
            name="organizationName"
            placeholder="Atelier Aurora"
            required={!hasOrganizations}
          />
        </label>
        <label className="field">
          <span>Slug organizzazione</span>
          <input
            autoCapitalize="none"
            name="organizationSlug"
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            placeholder="atelier-aurora"
            required={!hasOrganizations}
          />
        </label>
      </div>

      <div className="rule" />

      <div className="field-pair">
        <label className="field">
          <span>Nome brand</span>
          <input name="brandName" placeholder="Aurora" required />
        </label>
        <label className="field">
          <span>Slug brand</span>
          <input
            autoCapitalize="none"
            name="brandSlug"
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            placeholder="aurora"
            required
          />
        </label>
      </div>

      <label className="field">
        <span>Sito canonico</span>
        <input
          inputMode="url"
          name="websiteUrl"
          placeholder="https://aurora.example"
          required
          type="url"
        />
        <small>Deve essere pubblico e raggiungibile via HTTPS.</small>
      </label>

      <label className="field">
        <span>Intent iniziale</span>
        <textarea
          name="intentStatement"
          placeholder="Definisci il risultato che il brand deve ottenere, non una lista di attività."
          required
          rows={5}
        />
      </label>

      <FormFeedback state={state} />
      <SubmitButton
        idleLabel="Crea brand e continua"
        pendingLabel="Creazione…"
      />
    </form>
  )
}
