import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { resolve } from 'node:path'

const POSTHOG_EU_CLI_HOST = 'https://eu.posthog.com'
const RELEASE_NAME = 'branderize-console'
const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/u
const PROJECT_TOKEN_PATTERN = /^phc_[A-Za-z0-9_-]{8,252}$/u

const run = (args, environment) =>
  new Promise((resolveRun, rejectRun) => {
    const executable =
      process.platform === 'win32' ? 'posthog-cli.cmd' : 'posthog-cli'
    const child = spawn(executable, args, {
      env: environment,
      stdio: 'inherit',
    })

    child.once('error', rejectRun)
    child.once('close', (code, signal) => {
      if (signal) {
        rejectRun(new Error(`posthog-cli stopped after receiving ${signal}`))
        return
      }
      if (code !== 0) {
        rejectRun(new Error(`posthog-cli exited with code ${code ?? 1}`))
        return
      }
      resolveRun()
    })
  })

if (process.env.VERCEL_ENV === 'production') {
  if (process.env.NODE_ENV !== 'production') {
    throw new Error('A production Vercel build must use NODE_ENV=production')
  }

  const apiKey = process.env.POSTHOG_CLI_API_KEY?.trim()
  const configuredCliHost = process.env.POSTHOG_CLI_HOST?.trim()
  const projectId = process.env.POSTHOG_CLI_PROJECT_ID?.trim()
  const projectToken = process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim()
  const releaseVersion = process.env.VERCEL_GIT_COMMIT_SHA?.trim()

  if (!(apiKey && projectId)) {
    throw new Error(
      'POSTHOG_CLI_API_KEY and POSTHOG_CLI_PROJECT_ID are required in production'
    )
  }
  if (configuredCliHost && configuredCliHost !== POSTHOG_EU_CLI_HOST) {
    throw new Error('POSTHOG_CLI_HOST must target PostHog EU Cloud')
  }
  if (!(projectToken && PROJECT_TOKEN_PATTERN.test(projectToken))) {
    throw new Error('NEXT_PUBLIC_POSTHOG_KEY must be a valid project token')
  }
  if (!(releaseVersion && GIT_SHA_PATTERN.test(releaseVersion))) {
    throw new Error('VERCEL_GIT_COMMIT_SHA must be a full lowercase Git SHA')
  }

  const assetsDirectory = resolve(process.cwd(), '.next', 'static')
  await access(assetsDirectory)

  const environment = {
    ...process.env,
    POSTHOG_CLI_API_KEY: apiKey,
    POSTHOG_CLI_HOST: POSTHOG_EU_CLI_HOST,
    POSTHOG_CLI_PROJECT_ID: projectId,
  }
  await run(
    [
      'sourcemap',
      'inject',
      '--directory',
      assetsDirectory,
      '--release-name',
      RELEASE_NAME,
      '--release-version',
      releaseVersion,
    ],
    environment
  )
  await run(
    [
      'sourcemap',
      'upload',
      '--delete-after',
      '--directory',
      assetsDirectory,
      '--release-name',
      RELEASE_NAME,
      '--release-version',
      releaseVersion,
    ],
    environment
  )
  process.stdout.write(
    `Uploaded ${RELEASE_NAME} source maps to PostHog EU Cloud\n`
  )
} else {
  process.stdout.write('PostHog source-map upload skipped outside production\n')
}
