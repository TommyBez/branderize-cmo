import { withRelatedProject } from '@vercel/related-projects'
import { CONSOLE_RELATED_PROJECT_NAME } from './related-console'
import { clientEnvironmentSchema, type EnvironmentSource } from './schema'

export type ClientEnvironment = ReturnType<typeof clientEnvironmentSchema.parse>

export const parseClientEnvironment = (
  source: EnvironmentSource
): ClientEnvironment => {
  const defaultHost = source.NEXT_PUBLIC_APP_URL ?? ''
  const relatedHost = withRelatedProject({
    defaultHost,
    projectName: CONSOLE_RELATED_PROJECT_NAME,
  })

  return clientEnvironmentSchema.parse({
    NEXT_PUBLIC_APP_URL: relatedHost === '' ? undefined : relatedHost,
  })
}
