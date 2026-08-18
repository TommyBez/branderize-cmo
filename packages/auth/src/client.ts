import type { ClientEnvironment } from '@repo/env/client'
import { createAuthClient } from 'better-auth/client'
import { organizationClient } from 'better-auth/client/plugins'
import { organizationPluginOptions, organizationRoles } from './access-control'

type AuthClientEnvironment = Pick<ClientEnvironment, 'NEXT_PUBLIC_APP_URL'>

export type CreateBranderizeAuthClientOptions = Readonly<{
  environment: AuthClientEnvironment
}>

export const createBranderizeAuthClient = ({
  environment,
}: CreateBranderizeAuthClientOptions) =>
  createAuthClient({
    baseURL: environment.NEXT_PUBLIC_APP_URL,
    plugins: [
      organizationClient({
        dynamicAccessControl: organizationPluginOptions.dynamicAccessControl,
        roles: organizationRoles,
        teams: organizationPluginOptions.teams,
      }),
    ],
  })
