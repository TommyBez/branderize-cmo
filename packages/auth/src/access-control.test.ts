import { MEMBER_ROLES } from '@repo/policy'
import { describe, expect, it } from 'vitest'
import { organizationPluginOptions, organizationRoles } from './access-control'

describe('organization roles', () => {
  it('matches the Policy role vocabulary', () => {
    expect(new Set(Object.keys(organizationRoles))).toEqual(
      new Set(MEMBER_ROLES)
    )
  })

  it('keeps viewer as a read-only organization member', () => {
    expect(
      organizationRoles.viewer.authorize({ organization: ['update'] }).success
    ).toBe(false)
    expect(organizationRoles.viewer.authorize({ ac: ['read'] }).success).toBe(
      true
    )
  })

  it('preserves the Better Auth owner and admin management split', () => {
    expect(
      organizationRoles.owner.authorize({ organization: ['delete'] }).success
    ).toBe(true)
    expect(
      organizationRoles.admin.authorize({ organization: ['delete'] }).success
    ).toBe(false)
  })
})

describe('organization plugin safety', () => {
  it('disables hard organization deletion, teams, and dynamic roles', () => {
    expect(organizationPluginOptions.disableOrganizationDeletion).toBe(true)
    expect(organizationPluginOptions.teams.enabled).toBe(false)
    expect(organizationPluginOptions.dynamicAccessControl.enabled).toBe(false)
  })
})
