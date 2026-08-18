import type { MemberRole } from '@repo/policy'
import {
  adminAc,
  defaultAc,
  memberAc,
  ownerAc,
} from 'better-auth/plugins/organization/access'

export const viewerRole = defaultAc.newRole(memberAc.statements)

export const organizationRoles = {
  admin: adminAc,
  member: memberAc,
  owner: ownerAc,
  viewer: viewerRole,
} satisfies Record<MemberRole, unknown>

export type OrganizationRoleName = keyof typeof organizationRoles

export const organizationPluginOptions = {
  allowUserToCreateOrganization: true,
  creatorRole: 'owner',
  disableOrganizationDeletion: true,
  dynamicAccessControl: { enabled: false },
  requireEmailVerificationOnInvitation: true,
  roles: organizationRoles,
  teams: { enabled: false },
} as const
