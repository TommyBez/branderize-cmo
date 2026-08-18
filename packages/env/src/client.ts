import { clientEnvironmentSchema, type EnvironmentSource } from './schema'

export type ClientEnvironment = ReturnType<typeof clientEnvironmentSchema.parse>

export const parseClientEnvironment = (
  source: EnvironmentSource
): ClientEnvironment =>
  clientEnvironmentSchema.parse({
    NEXT_PUBLIC_APP_URL: source.NEXT_PUBLIC_APP_URL,
  })
