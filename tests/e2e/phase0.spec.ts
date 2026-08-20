import { createHmac, randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import AxeBuilder from '@axe-core/playwright'
import { instant } from '@next/playwright'
import {
  type BrowserContext,
  expect,
  type Locator,
  type Page,
  test,
} from '@playwright/test'
import { Client } from '../../apps/agent-cmo/node_modules/eve/dist/src/client/index.js'
import { requestHash } from '../../packages/brain/src/canonical'
import type { QueryResultRow } from '../../packages/db/node_modules/@types/pg'
import { createAuthenticatedBrowser } from './support/auth'
import {
  cleanTestData,
  closeTestDatabase,
  createTestDataRegistry,
  databasePool,
} from './support/database'
import {
  appOrigin,
  cronSecret,
  functionalAgentOrigins,
  providerStateDirectory,
  testAuthSecret,
  webOrigin,
} from './support/environment'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const BRAND_CONTEXT_URL_PATTERN = /\/brands\/[0-9a-f-]+\/context$/u
const CMO_CONVERSATION_URL_PATTERN = /\/cmo\/[0-9a-f-]+$/u
const LANDING_HEADING_PATTERN = /The AI CMO/i
const PRIVATE_ROUTE_BOUNDARY_PATTERN =
  /This page is not in your workspace|We can’t show this state right now/u
const TOKEN_WORD_PATTERN = /token/i
const TOKEN_LIKE_PATTERN =
  /(?:access|refresh|id)_token|api[_-]?key|client_secret|sk_live|re_[A-Za-z0-9]{16,}/iu
const PRODUCT_MARKETER_SOURCE_PATTERN = /product-marketer/u
const GATEWAY_TRACE_FILE_PATTERN = /^gateway-\d+-\d{4}\.json$/u
const STREAM_TAIL_INDEX_PATTERN = /^-?\d+$/u
const PROXY_DIAGNOSTIC_BODY_LIMIT_BYTES = 16_384
const PROXY_SNAPSHOT_BUDGET_MS = 8000
const SCRIPTED_ASSET_SOURCE_URL =
  'https://example.com/branderize-e2e/phase0-logo.svg'
const SCRIPTED_ASSET_MARKER = 'Branderize scripted E2E asset'
const SCRIPTED_MODEL_ID = 'deepseek/deepseek-v4-pro-0813'
const SCRIPTED_RUNTIME_MODEL_ID = `dynamic:${SCRIPTED_MODEL_ID}`
const SCREENSHOT_STYLE_PATH = fileURLToPath(
  new URL('./snapshot.css', import.meta.url)
)
const SCREENSHOT_FONT_URL = 'https://snapshot-font.invalid/geist-regular.ttf'
const requireFromWebApp = createRequire(
  new URL('../../apps/web/package.json', import.meta.url)
)
const SCREENSHOT_FONT_PATH = resolve(
  dirname(requireFromWebApp.resolve('next/package.json')),
  'dist/compiled/@vercel/og/Geist-Regular.ttf'
)
const screenshotPreparedPages = new WeakSet<Page>()
const CMO_SPECIALIST_PROMPT =
  'Use the single active Intent. Call request_specialist_work now.'
const CMO_CONSULTATION_PROMPT =
  'Consult the Product Marketer and return exactly one missing strategic question.'
const CMO_CONSULTATION_ANSWER =
  'The priority audience is product-led teams. Refine the active Intent with this answer.'
const CMO_RESOLUTION_PROMPT =
  'Resolve the attached Product Marketer question and refine its Intent.'
const CMO_HOLD_PROMPT = 'Keep this exact turn active until I stop it.'
const PRODUCT_MARKETER_QUESTION =
  'Which enterprise buyer must the positioning prioritize?'

interface OnboardingProofRow extends QueryResultRow {
  readonly actionId: string
  readonly actionIntentId: string
  readonly actionType: string
  readonly actorKey: string
  readonly brandId: string
  readonly brandName: string
  readonly brandSlug: string
  readonly grantAmount: string
  readonly intentId: string
  readonly intentRevision: number
  readonly intentStatement: string
  readonly intentStatus: string
  readonly onboardingOutcome: string
  readonly organizationId: string
  readonly websiteUrl: string
}

interface ContextImportProofRow extends QueryResultRow {
  readonly actionId: string
  readonly actorKey: string
  readonly artifactBlobKey: string
  readonly artifactByteSize: string
  readonly artifactContentType: string
  readonly artifactFinalUrl: string
  readonly artifactId: string
  readonly artifactSha256: string
  readonly artifactSourceUrl: string
  readonly contextId: string
  readonly contextNormalization: string
  readonly contextProvider: string
  readonly contextSource: string
  readonly contextWebsiteUrl: string
}

interface TaskRequestProofRow extends QueryResultRow {
  readonly actionSessionId: string
  readonly actionType: string
  readonly actorKey: string
  readonly cmoSessionId: string
  readonly intentId: string
  readonly status: string
  readonly taskId: string
  readonly taskSessionId: string | null
  readonly workerKey: string
}

interface TaskCompletionProofRow extends QueryResultRow {
  readonly actionType: string
  readonly actorKey: string
  readonly basisObjectId: string
  readonly completionStatus: string
  readonly newContextId: string
  readonly newContextSource: string
  readonly newContextStatus: string
  readonly oldContextStatus: string
  readonly outcomeCode: string
  readonly sessionId: string
  readonly status: string
  readonly terminalEventCount: number
}

interface TaskEventProofRow extends QueryResultRow {
  readonly eventKinds: readonly string[]
}

interface IntentMutationProofRow extends QueryResultRow {
  readonly actionCount: number
  readonly actionId: string
  readonly actionType: string
  readonly authorActorKey: string
  readonly intentId: string
  readonly producerActorKey: string
  readonly revision: number
  readonly sessionId: string
  readonly statement: string
  readonly status: string
}

interface TaskQuestionProofRow extends QueryResultRow {
  readonly actionCount: number
  readonly completionStatus: string
  readonly intentId: string
  readonly openQuestions: readonly string[]
  readonly outcomeCode: string
  readonly sessionId: string
  readonly status: string
  readonly taskId: string
}

interface TaskStabilityProofRow extends QueryResultRow {
  readonly attempts: number
  readonly sessionEventCount: number
  readonly sessionId: string
  readonly startedAt: Date
  readonly status: string
}

interface QuestionResolutionProofRow extends QueryResultRow {
  readonly actionType: string
  readonly actorKey: string
  readonly disposition: string
  readonly intentRevision: number
  readonly rationale: string
  readonly taskId: string
}

interface ModelChargeProofRow extends QueryResultRow {
  readonly amount: string
  readonly duplicateCount: number
  readonly gatewayCostUsd: string
  readonly generationId: string
  readonly inputTokens: number
  readonly modelId: string
  readonly outputTokens: number
  readonly sessionEventId: string
}

interface WinningModelStepProofRow extends QueryResultRow {
  readonly generationId: string
}

interface TurnProofRow extends QueryResultRow {
  readonly eventKind: string
  readonly sessionId: string
  readonly turnId: string
}

interface ConversationCheckpointProofRow extends QueryResultRow {
  readonly sessionId: string
  readonly streamIndex: number
}

interface InstantNavigationFixtureRow extends QueryResultRow {
  readonly conversationId: string
  readonly intentId: string
  readonly intentStatement: string
  readonly objectId: string
  readonly organizationId: string
  readonly taskId: string
}

interface InstantNavigationFixture {
  readonly conversationId: string
  readonly conversationTitle: string
  readonly intentId: string
  readonly intentStatement: string
  readonly objectId: string
  readonly objectType: string
  readonly organizationId: string
  readonly taskId: string
}

interface InstantRouteShell {
  readonly heading: string
  readonly status: string
}

interface ScriptedGatewayTrace {
  readonly agent: string
  readonly costUsd: number
  readonly generationId: string
  readonly lane: string
  readonly modelId: string
  readonly providerOptions: {
    readonly tags: readonly string[]
    readonly user?: string
  }
}

interface ProxyStreamProbeReceipt {
  readonly completionMilliseconds: number
  readonly error: {
    readonly message: string
    readonly name: string
  } | null
  readonly eventCount: number
  readonly events: readonly {
    readonly index: number
    readonly type: string
  }[]
  readonly expectedEventCount: number | null
  readonly failureStage: 'body' | 'fetch' | 'headers' | null
  readonly firstHeaderMilliseconds: number | null
  readonly responseBody: {
    readonly bytesRead: number
    readonly limitBytes: number
    readonly text: string
    readonly truncated: boolean
  } | null
  readonly responseHeaders: {
    readonly 'content-type': string | null
    readonly 'x-eve-session-id': string | null
    readonly 'x-eve-stream-format': string | null
    readonly 'x-eve-stream-tail-index': string | null
    readonly 'x-eve-stream-version': string | null
  }
  readonly sessionState: string | null
  readonly status: number | null
  readonly tailIndex: number | null
}

interface PublicClientSnapshotReceipt {
  readonly elapsedMilliseconds: number
  readonly error: {
    readonly message: string
    readonly name: string
  } | null
  readonly eventCount: number | null
  readonly sessionId: string | null
  readonly streamIndex: number | null
}

type DirectCmoStreamProbeReceipt = Omit<
  ProxyStreamProbeReceipt,
  'responseBody' | 'responseHeaders'
> & {
  readonly mode: 'bounded' | 'unbounded'
}

const mintE2eCmoBridgeToken = ({
  brandId,
  conversationId,
  userId,
}: {
  readonly brandId: string
  readonly conversationId: string
  readonly userId: string
}): string => {
  const secret = process.env.CMO_BRIDGE_SECRET
  if (secret === undefined || secret.length === 0) {
    throw new Error('CMO_BRIDGE_SECRET is required by the direct CMO probe')
  }
  const issuedAt = Math.floor(Date.now() / 1000)
  const header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' })
  ).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({
      aud: 'agent-cmo',
      brand_id: brandId,
      conversation_id: conversationId,
      exp: issuedAt + 45,
      iat: issuedAt,
      iss: 'branderize-app',
      jti: randomUUID(),
      sub: userId,
    })
  ).toString('base64url')
  const unsignedToken = `${header}.${payload}`
  const signature = createHmac('sha256', secret)
    .update(unsignedToken)
    .digest('base64url')
  return `${unsignedToken}.${signature}`
}

const assertAxeClean = async (page: Page): Promise<void> => {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  const report = violations
    .map(
      (violation) =>
        `${violation.id} (${violation.impact ?? 'unknown'}): ${violation.nodes.length} node(s)`
    )
    .join('\n')
  expect(violations, report).toEqual([])
}

const readPathIdentifier = ({
  position,
  url,
}: {
  readonly position: number
  readonly url: string
}): string => {
  const value = new URL(url).pathname.split('/').filter(Boolean)[position]
  if (value === undefined || !UUID_PATTERN.test(value)) {
    throw new Error(`Expected a UUID in ${url}`)
  }
  return value
}

const readScriptedGatewayTraces = async (): Promise<
  readonly ScriptedGatewayTrace[]
> => {
  const entries = await readdir(providerStateDirectory, {
    withFileTypes: true,
  })
  return await Promise.all(
    entries
      .filter(
        (entry) => entry.isFile() && GATEWAY_TRACE_FILE_PATTERN.test(entry.name)
      )
      .map(async (entry) => {
        const source = await readFile(
          `${providerStateDirectory}/${entry.name}`,
          'utf8'
        )
        return JSON.parse(source) as ScriptedGatewayTrace
      })
  )
}

const createInstantNavigationFixture = async ({
  brandId,
  ownerUserId,
  suffix,
}: {
  readonly brandId: string
  readonly ownerUserId: string
  readonly suffix: string
}): Promise<InstantNavigationFixture> => {
  const actionId = randomUUID()
  const conversationId = randomUUID()
  const conversationTitle = `Instant conversation ${suffix}`
  const objectId = randomUUID()
  const objectType = `instant-navigation-${suffix}`
  const taskId = randomUUID()
  const result = await databasePool.query<InstantNavigationFixtureRow>(
    `WITH source AS (
       SELECT
         brands.organization_id,
         intents.author_actor_id,
         intents.id AS intent_id,
         intents.statement AS intent_statement
       FROM brands
       INNER JOIN intents
         ON intents.brand_id = brands.id
        AND intents.status = 'active'
       WHERE brands.id = $1
       ORDER BY intents.created_at ASC, intents.id ASC
       LIMIT 1
     ), fixture_action AS (
       INSERT INTO actions (
         id, brand_id, actor_id, intent_id, type, rationale, effect_class,
         payload, policy_snapshot
       )
       SELECT
         $2, $1, source.author_actor_id, source.intent_id,
         'instant_navigation_fixture',
         'Creates a terminal navigation-only E2E projection.',
         'graph-internal',
         jsonb_build_object('fixture', 'instant-navigation'),
         jsonb_build_object('source', 'e2e')
       FROM source
       RETURNING id
     ), fixture_object AS (
       INSERT INTO objects (
         id, brand_id, type, status, content, content_text, produced_by
       )
       SELECT
         $3, $1, $4, 'active',
         jsonb_build_object('proof', 'instant navigation'),
         $5,
         fixture_action.id
       FROM fixture_action
       RETURNING id
     ), fixture_task AS (
       INSERT INTO tasks (
         id, brand_id, kind, subject_key, worker_key, execution_mode,
         activation, status, finished_at, payload, payload_hash, outcome_code
       )
       VALUES (
         $6, $1, 'product-marketer.brand-context.v1', $7,
         'product-marketer', 'agent', 'automatic', 'failed', NOW(),
         jsonb_build_object('fixture', 'instant-navigation'), $8,
         'instant_navigation_fixture'
       )
       RETURNING id
     ), fixture_conversation AS (
       INSERT INTO cmo_conversations (
         id, brand_id, owner_user_id, title
       )
       VALUES ($9, $1, $10, $11)
       RETURNING id
     )
     SELECT
       fixture_conversation.id AS "conversationId",
       source.intent_id AS "intentId",
       source.intent_statement AS "intentStatement",
       fixture_object.id AS "objectId",
       source.organization_id AS "organizationId",
       fixture_task.id AS "taskId"
     FROM source
     CROSS JOIN fixture_action
     CROSS JOIN fixture_object
     CROSS JOIN fixture_task
     CROSS JOIN fixture_conversation`,
    [
      brandId,
      actionId,
      objectId,
      objectType,
      `Instant navigation proof ${suffix}`,
      taskId,
      `instant-navigation:${suffix}`,
      `instant-navigation:${suffix}`,
      conversationId,
      ownerUserId,
      conversationTitle,
    ]
  )
  const fixture = result.rows.at(0)
  if (fixture === undefined) {
    throw new Error('The instant-navigation fixture could not be created')
  }
  return {
    ...fixture,
    conversationTitle,
    objectType,
  }
}

const visibleNavigationPending = (page: Page): Locator =>
  page.locator('.navigation-pending').filter({ visible: true })

const assertInstantShell = async ({
  forbiddenCopy = [],
  page,
  shell,
}: {
  readonly forbiddenCopy?: readonly string[]
  readonly page: Page
  readonly shell: InstantRouteShell
}): Promise<void> => {
  const pending = visibleNavigationPending(page)
  await expect(pending).toHaveCount(1)
  await expect(pending.getByRole('status')).toHaveText(shell.status)
  await expect(
    pending.getByRole('heading', { exact: true, name: shell.heading })
  ).toBeVisible()
  await Promise.all(
    forbiddenCopy.map((value) => expect(pending).not.toContainText(value))
  )
}

const assertInstantHardNavigation = async ({
  context,
  expectProtectedLayout = false,
  forbiddenCopy,
  path,
  ready,
  settledPath = path,
  shell,
}: {
  readonly context: BrowserContext
  readonly expectProtectedLayout?: boolean
  readonly forbiddenCopy?: readonly string[]
  readonly path: string
  readonly ready: (page: Page) => Locator
  readonly settledPath?: string
  readonly shell: InstantRouteShell
}): Promise<void> => {
  const page = await context.newPage()
  try {
    await instant(
      page,
      async () => {
        await page.goto(path)
        await assertInstantShell({ forbiddenCopy, page, shell })
        if (expectProtectedLayout) {
          const protectedLayout = page.locator('.app-frame--pending')
          await expect(protectedLayout).toHaveCount(1)
          await Promise.all(
            (forbiddenCopy ?? []).map((value) =>
              expect(protectedLayout).not.toContainText(value)
            )
          )
        }
      },
      { baseURL: appOrigin }
    )
    await expect(page).toHaveURL(`${appOrigin}${settledPath}`)
    await expect(visibleNavigationPending(page)).toHaveCount(0)
    await expect(ready(page)).toBeVisible()
  } finally {
    await page.close()
  }
}

const assertInstantClientNavigation = async ({
  context,
  forbiddenCopy,
  link,
  ready,
  shell,
  sourcePath,
  targetPath,
}: {
  readonly context: BrowserContext
  readonly forbiddenCopy: readonly string[]
  readonly link: (page: Page) => Locator
  readonly ready: (page: Page) => Locator
  readonly shell: InstantRouteShell
  readonly sourcePath: string
  readonly targetPath: string
}): Promise<void> => {
  const page = await context.newPage()
  try {
    await page.goto(sourcePath)
    const sourceLink = link(page)
    await expect(sourceLink).toBeVisible()
    await instant(page, async () => {
      await Promise.all([
        page.waitForURL(
          (url) =>
            url.origin === appOrigin &&
            url.pathname === targetPath &&
            url.search === ''
        ),
        sourceLink.click(),
      ])
      await assertInstantShell({ forbiddenCopy, page, shell })
    })
    await expect(page).toHaveURL(`${appOrigin}${targetPath}`)
    await expect(visibleNavigationPending(page)).toHaveCount(0)
    await expect(ready(page)).toBeVisible()
  } finally {
    await page.close()
  }
}

const assertNoHorizontalOverflow = async (page: Page): Promise<void> => {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
}

const assertNoElementHorizontalOverflow = async (
  locator: Locator
): Promise<void> => {
  const dimensions = await locator.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }))
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
}

const assertVisibleFocusIndicator = async (locator: Locator): Promise<void> => {
  await expect(locator).toBeFocused()
  await expect(locator).toBeVisible()
  const hasVisibleIndicator = await locator.evaluate((element) => {
    const style = getComputedStyle(element)
    const hasOutline =
      style.outlineStyle !== 'none' && style.outlineWidth !== '0px'
    return hasOutline || style.boxShadow !== 'none'
  })
  expect(hasVisibleIndicator).toBe(true)
}

const advanceKeyboardFocusTo = async ({
  description,
  maximumTabPresses,
  page,
  target,
}: {
  readonly description: string
  readonly maximumTabPresses: number
  readonly page: Page
  readonly target: Locator
}): Promise<void> => {
  const reachesTarget = async (
    remainingTabPresses: number
  ): Promise<boolean> => {
    await page.keyboard.press('Tab')
    if (
      await target.evaluate((element) => element === document.activeElement)
    ) {
      return true
    }
    return remainingTabPresses > 1
      ? reachesTarget(remainingTabPresses - 1)
      : false
  }
  if (await reachesTarget(maximumTabPresses)) {
    return
  }
  throw new Error(
    `Keyboard traversal did not reach ${description} within ${maximumTabPresses} Tab presses`
  )
}

const captureDeterministicScreenshot = async ({
  mask,
  name,
  page,
}: {
  readonly mask?: Locator[]
  readonly name: string
  readonly page: Page
}): Promise<void> => {
  if (!screenshotPreparedPages.has(page)) {
    await page.route(SCREENSHOT_FONT_URL, async (route) => {
      await route.fulfill({
        contentType: 'font/ttf',
        headers: { 'access-control-allow-origin': '*' },
        path: SCREENSHOT_FONT_PATH,
      })
    })
    screenshotPreparedPages.add(page)
  }
  const snapshotStyle = await page.addStyleTag({ path: SCREENSHOT_STYLE_PATH })
  try {
    await page.evaluate(async () => {
      await document.fonts.ready
    })
    expect(
      await page.evaluate(() =>
        document.fonts.check('16px "Branderize E2E Snapshot"')
      )
    ).toBe(true)
    await page.evaluate(() => window.scrollTo(0, 0))
    await expect(page).toHaveScreenshot(name, {
      animations: 'disabled',
      caret: 'hide',
      fullPage: true,
      ...(mask === undefined ? {} : { mask }),
      maxDiffPixelRatio: 0.02,
      stylePath: SCREENSHOT_STYLE_PATH,
      threshold: 0.2,
    })
  } finally {
    await snapshotStyle.evaluate((element) =>
      element.parentNode?.removeChild(element)
    )
  }
}

const captureBrowserConsole = (
  context: BrowserContext,
  messages: string[]
): void => {
  const attach = (page: Page): void => {
    page.on('console', (message) => messages.push(message.text()))
  }
  context.on('page', attach)
  for (const page of context.pages()) {
    attach(page)
  }
}

test.describe.configure({ mode: 'serial' })

test.afterAll(async () => {
  await closeTestDatabase()
})

test('the landing route is present in its initial Cache Components shell', async ({
  page,
}) => {
  await instant(
    page,
    async () => {
      await page.goto(webOrigin)
      await expect(
        page.getByRole('heading', { name: LANDING_HEADING_PATTERN })
      ).toBeVisible()
      await expect(
        page
          .getByRole('link', {
            name: 'Open the Branderize app and sign in with email',
          })
          .first()
      ).toHaveAttribute('href', appOrigin)
    },
    { baseURL: webOrigin }
  )
})

test('landing and sign-in expose accessible Phase 0 boundaries', async ({
  page,
}) => {
  await page.goto(webOrigin)
  await expect(
    page.getByRole('heading', { name: LANDING_HEADING_PATTERN })
  ).toBeVisible()
  await expect(
    page
      .getByRole('link', {
        name: 'Open the Branderize app and sign in with email',
      })
      .first()
  ).toHaveAttribute('href', appOrigin)
  await assertAxeClean(page)
  await page.keyboard.press('Tab')
  const skipLink = page.getByRole('link', { name: 'Skip to content' })
  await assertVisibleFocusIndicator(skipLink)
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(`${webOrigin}/#content`)

  await page.goto(`${appOrigin}/sign-in`)
  await expect(
    page.getByRole('heading', {
      name: 'You can still see why something was made.',
    })
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Email me a code' })
  ).toBeVisible()
  await assertAxeClean(page)
  await page.keyboard.press('Tab')
  await assertVisibleFocusIndicator(page.locator('a.wordmark'))
  await page.keyboard.press('Tab')
  await assertVisibleFocusIndicator(
    page.getByRole('textbox', { name: 'Email' })
  )
  await page.keyboard.press('Tab')
  await assertVisibleFocusIndicator(
    page.getByRole('button', { name: 'Email me a code' })
  )
})

test('public shells reflow at 200% and 400% zoom equivalents', async ({
  page,
}) => {
  const captureReflowProof = async ({
    label,
    ready,
    url,
    width,
  }: {
    readonly label: string
    readonly ready?: Locator
    readonly url: string
    readonly width: number
  }): Promise<void> => {
    await page.setViewportSize({ height: 900, width })
    await page.goto(url)
    if (ready !== undefined) {
      await expect(ready).toBeVisible()
    }
    await assertNoHorizontalOverflow(page)
    await captureDeterministicScreenshot({
      name: `${label}.png`,
      page,
    })
  }
  const signInHeading = page.getByRole('heading', {
    name: 'You can still see why something was made.',
  })

  await captureReflowProof({
    label: 'landing-primary',
    url: webOrigin,
    width: 1280,
  })
  await captureReflowProof({
    label: 'sign-in-primary',
    ready: signInHeading,
    url: `${appOrigin}/sign-in`,
    width: 1280,
  })
  await captureReflowProof({
    label: 'landing-web-breakpoint-1121',
    url: webOrigin,
    width: 1121,
  })
  await captureReflowProof({
    label: 'landing-web-breakpoint-1120',
    url: webOrigin,
    width: 1120,
  })
  await captureReflowProof({
    label: 'landing-web-breakpoint-769',
    url: webOrigin,
    width: 769,
  })
  await captureReflowProof({
    label: 'landing-web-breakpoint-768',
    url: webOrigin,
    width: 768,
  })
  await captureReflowProof({
    label: 'landing-200-percent',
    url: webOrigin,
    width: 640,
  })
  await captureReflowProof({
    label: 'sign-in-200-percent',
    ready: signInHeading,
    url: `${appOrigin}/sign-in`,
    width: 640,
  })
  await captureReflowProof({
    label: 'landing-400-percent',
    url: webOrigin,
    width: 320,
  })
  await captureReflowProof({
    label: 'sign-in-400-percent',
    ready: signInHeading,
    url: `${appOrigin}/sign-in`,
    width: 320,
  })
})

test('every app route family exposes an instant shell before streamed data', async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const suffix = randomUUID().slice(0, 8)
  const ownerEmail = `instant-owner-${suffix}@e2e.branderize.test`
  const ownerName = `Instant Owner ${suffix}`
  const organizationSlug = `instant-org-${suffix}`
  const brandName = `Instant Brand ${suffix}`
  const brandSlug = `instant-brand-${suffix}`
  const registry = createTestDataRegistry()
  registry.organizationSlugs.add(organizationSlug)
  registry.userEmails.add(ownerEmail)
  const anonymousContext = await browser.newContext({ baseURL: appOrigin })

  try {
    await assertInstantHardNavigation({
      context: anonymousContext,
      path: '/',
      ready: (page) =>
        page.getByRole('heading', {
          name: 'You can still see why something was made.',
        }),
      settledPath: '/sign-in',
      shell: {
        heading: 'Opening your workspace.',
        status: 'Taking you to your brand.',
      },
    })
    await assertInstantHardNavigation({
      context: anonymousContext,
      path: '/sign-in',
      ready: (page) => page.getByRole('button', { name: 'Email me a code' }),
      shell: {
        heading: 'Checking your session.',
        status: 'Checking for an existing session.',
      },
    })
  } finally {
    await anonymousContext.close()
  }

  const owner = await createAuthenticatedBrowser({
    browser,
    email: ownerEmail,
    name: ownerName,
  })
  registry.userIds.add(owner.userId)

  try {
    await assertInstantHardNavigation({
      context: owner.context,
      forbiddenCopy: [ownerEmail, ownerName],
      path: '/onboarding',
      ready: (page) =>
        page.getByRole('button', { name: 'Create brand and continue' }),
      shell: {
        heading: 'Preparing the first record.',
        status: 'Setting up the new brand.',
      },
    })

    const setupPage = await owner.context.newPage()
    await setupPage.goto('/onboarding')
    await setupPage
      .getByLabel('Organization name')
      .fill(`Instant Org ${suffix}`)
    await setupPage.getByLabel('Organization slug').fill(organizationSlug)
    await setupPage.getByLabel('Brand name').fill(brandName)
    await setupPage.getByLabel('Brand slug').fill(brandSlug)
    await setupPage.getByLabel('Website').fill(`https://${brandSlug}.example`)
    await setupPage
      .getByLabel('First goal')
      .fill(`Intent instant navigation ${suffix}`)
    await setupPage
      .getByRole('button', { name: 'Create brand and continue' })
      .click()
    await expect(setupPage).toHaveURL(BRAND_CONTEXT_URL_PATTERN)
    const brandId = readPathIdentifier({
      position: 1,
      url: setupPage.url(),
    })
    await expect(
      setupPage.getByLabel('Brand').locator('option:checked')
    ).toHaveText(brandName)
    await expect(setupPage.locator('.sidebar__foot p')).toHaveText(ownerName)
    await setupPage.close()

    const fixture = await createInstantNavigationFixture({
      brandId,
      ownerUserId: owner.userId,
      suffix,
    })
    registry.organizationIds.add(fixture.organizationId)

    const brandPath = `/brands/${brandId}`
    const todayPath = `${brandPath}/today`
    const intentPath = `${brandPath}/intent`
    const intentDetailPath = `${intentPath}/${fixture.intentId}`
    const contextPath = `${brandPath}/context`
    const objectDetailPath = `${brandPath}/objects/${fixture.objectId}`
    const workPath = `${brandPath}/work`
    const taskDetailPath = `${workPath}/${fixture.taskId}`
    const cmoPath = `${brandPath}/cmo`
    const conversationDetailPath = `${cmoPath}/${fixture.conversationId}`
    const protectedCopy = [brandName, ownerName]
    const intentListReady = (page: Page): Locator =>
      page.getByRole('link', { name: fixture.intentStatement })
    const objectListReady = (page: Page): Locator =>
      page.getByRole('link').filter({ hasText: fixture.objectType })
    const taskListReady = (page: Page): Locator =>
      page.getByRole('link').filter({ hasText: fixture.taskId.slice(0, 8) })
    const conversationListReady = (page: Page): Locator =>
      page.getByRole('link').filter({ hasText: fixture.conversationTitle })
    const todayReady = (page: Page): Locator =>
      page.getByRole('heading', {
        exact: true,
        name: 'What needs attention.',
      })

    await assertInstantHardNavigation({
      context: owner.context,
      expectProtectedLayout: true,
      forbiddenCopy: protectedCopy,
      path: brandPath,
      ready: todayReady,
      settledPath: todayPath,
      shell: {
        heading: 'Opening Today.',
        status: 'Opening Today.',
      },
    })
    await assertInstantHardNavigation({
      context: owner.context,
      expectProtectedLayout: true,
      forbiddenCopy: protectedCopy,
      path: todayPath,
      ready: todayReady,
      shell: {
        heading: 'What needs attention.',
        status: 'Loading Today.',
      },
    })
    await assertInstantHardNavigation({
      context: owner.context,
      expectProtectedLayout: true,
      forbiddenCopy: protectedCopy,
      path: intentPath,
      ready: intentListReady,
      shell: {
        heading: 'The result before the work.',
        status: 'Loading Intents.',
      },
    })
    await assertInstantHardNavigation({
      context: owner.context,
      expectProtectedLayout: true,
      forbiddenCopy: protectedCopy,
      path: intentDetailPath,
      ready: (page) =>
        page.getByRole('heading', {
          exact: true,
          name: fixture.intentStatement,
        }),
      shell: {
        heading: 'Opening the Intent.',
        status: 'Loading the Intent.',
      },
    })
    await assertInstantHardNavigation({
      context: owner.context,
      expectProtectedLayout: true,
      forbiddenCopy: protectedCopy,
      path: contextPath,
      ready: objectListReady,
      shell: {
        heading: 'Sources, then proof.',
        status: 'Loading Brand Context.',
      },
    })
    await assertInstantHardNavigation({
      context: owner.context,
      expectProtectedLayout: true,
      forbiddenCopy: protectedCopy,
      path: objectDetailPath,
      ready: (page) =>
        page.getByRole('heading', {
          exact: true,
          name: fixture.objectType,
        }),
      shell: {
        heading: 'Opening the record.',
        status: 'Loading the Object.',
      },
    })
    await assertInstantHardNavigation({
      context: owner.context,
      expectProtectedLayout: true,
      forbiddenCopy: protectedCopy,
      path: workPath,
      ready: taskListReady,
      shell: {
        heading: 'Work leaves a receipt.',
        status: 'Loading Work.',
      },
    })
    await assertInstantHardNavigation({
      context: owner.context,
      expectProtectedLayout: true,
      forbiddenCopy: protectedCopy,
      path: taskDetailPath,
      ready: (page) => page.getByText(fixture.taskId, { exact: true }),
      shell: {
        heading: 'Opening the work.',
        status: 'Loading the task.',
      },
    })
    await assertInstantHardNavigation({
      context: owner.context,
      expectProtectedLayout: true,
      forbiddenCopy: protectedCopy,
      path: cmoPath,
      ready: conversationListReady,
      shell: {
        heading: 'Yours alone, inside the brand.',
        status: 'Loading CMO.',
      },
    })
    await assertInstantHardNavigation({
      context: owner.context,
      expectProtectedLayout: true,
      forbiddenCopy: protectedCopy,
      path: conversationDetailPath,
      ready: (page) =>
        page.getByRole('heading', {
          exact: true,
          name: fixture.conversationTitle,
        }),
      shell: {
        heading: 'Opening the private conversation.',
        status: 'Loading the CMO conversation.',
      },
    })

    await assertInstantClientNavigation({
      context: owner.context,
      forbiddenCopy: protectedCopy,
      link: (page) => page.getByRole('link', { exact: true, name: 'Today' }),
      ready: todayReady,
      shell: {
        heading: 'What needs attention.',
        status: 'Loading Today.',
      },
      sourcePath: contextPath,
      targetPath: todayPath,
    })
    await assertInstantClientNavigation({
      context: owner.context,
      forbiddenCopy: protectedCopy,
      link: (page) => page.getByRole('link', { exact: true, name: 'Intent' }),
      ready: intentListReady,
      shell: {
        heading: 'The result before the work.',
        status: 'Loading Intents.',
      },
      sourcePath: todayPath,
      targetPath: intentPath,
    })
    await assertInstantClientNavigation({
      context: owner.context,
      forbiddenCopy: protectedCopy,
      link: intentListReady,
      ready: (page) =>
        page.getByRole('heading', {
          exact: true,
          name: fixture.intentStatement,
        }),
      shell: {
        heading: 'Opening the Intent.',
        status: 'Loading the Intent.',
      },
      sourcePath: intentPath,
      targetPath: intentDetailPath,
    })
    await assertInstantClientNavigation({
      context: owner.context,
      forbiddenCopy: protectedCopy,
      link: (page) =>
        page.getByRole('link', { exact: true, name: 'Brand Context' }),
      ready: objectListReady,
      shell: {
        heading: 'Sources, then proof.',
        status: 'Loading Brand Context.',
      },
      sourcePath: intentDetailPath,
      targetPath: contextPath,
    })
    await assertInstantClientNavigation({
      context: owner.context,
      forbiddenCopy: protectedCopy,
      link: objectListReady,
      ready: (page) =>
        page.getByRole('heading', {
          exact: true,
          name: fixture.objectType,
        }),
      shell: {
        heading: 'Opening the record.',
        status: 'Loading the Object.',
      },
      sourcePath: contextPath,
      targetPath: objectDetailPath,
    })
    await assertInstantClientNavigation({
      context: owner.context,
      forbiddenCopy: protectedCopy,
      link: (page) => page.getByRole('link', { exact: true, name: 'Work' }),
      ready: taskListReady,
      shell: {
        heading: 'Work leaves a receipt.',
        status: 'Loading Work.',
      },
      sourcePath: objectDetailPath,
      targetPath: workPath,
    })
    await assertInstantClientNavigation({
      context: owner.context,
      forbiddenCopy: protectedCopy,
      link: taskListReady,
      ready: (page) => page.getByText(fixture.taskId, { exact: true }),
      shell: {
        heading: 'Opening the work.',
        status: 'Loading the task.',
      },
      sourcePath: workPath,
      targetPath: taskDetailPath,
    })
    await assertInstantClientNavigation({
      context: owner.context,
      forbiddenCopy: protectedCopy,
      link: (page) => page.getByRole('link', { exact: true, name: 'CMO' }),
      ready: conversationListReady,
      shell: {
        heading: 'Yours alone, inside the brand.',
        status: 'Loading CMO.',
      },
      sourcePath: taskDetailPath,
      targetPath: cmoPath,
    })
    await assertInstantClientNavigation({
      context: owner.context,
      forbiddenCopy: protectedCopy,
      link: conversationListReady,
      ready: (page) =>
        page.getByRole('heading', {
          exact: true,
          name: fixture.conversationTitle,
        }),
      shell: {
        heading: 'Opening the private conversation.',
        status: 'Loading the CMO conversation.',
      },
      sourcePath: cmoPath,
      targetPath: conversationDetailPath,
    })
  } finally {
    await owner.context.close()
    await cleanTestData(registry)
  }
})

test('authenticated console stays stable across every Phase 0 app breakpoint', async ({
  browser,
}) => {
  test.setTimeout(90_000)
  const suffix = randomUUID().slice(0, 8)
  const email = `visual-owner-${suffix}@e2e.branderize.test`
  const organizationSlug = `visual-org-${suffix}`
  const brandSlug = `visual-brand-${suffix}`
  const registry = createTestDataRegistry()
  registry.organizationSlugs.add(organizationSlug)
  registry.userEmails.add(email)
  const owner = await createAuthenticatedBrowser({
    browser,
    email,
    name: `Visual Owner ${suffix}`,
  })
  registry.userIds.add(owner.userId)

  try {
    const page = await owner.context.newPage()
    await page.goto('/onboarding')
    await page.getByLabel('Organization name').fill(`Visual Org ${suffix}`)
    await page.getByLabel('Organization slug').fill(organizationSlug)
    await page.getByLabel('Brand name').fill(`Visual Brand ${suffix}`)
    await page.getByLabel('Brand slug').fill(brandSlug)
    await page.getByLabel('Website').fill('https://visual.example')
    await page.getByLabel('First goal').fill(`Intent visuale stabile ${suffix}`)
    await page
      .getByRole('button', { name: 'Create brand and continue' })
      .click()
    await expect(page).toHaveURL(BRAND_CONTEXT_URL_PATTERN)
    await expect(
      page.getByRole('heading', {
        name: 'The site is not in Brand Context yet.',
      })
    ).toBeVisible()
    await assertAxeClean(page)
    const wordmark = page.locator('a.wordmark')
    await advanceKeyboardFocusTo({
      description: 'the app wordmark',
      maximumTabPresses: 3,
      page,
      target: wordmark,
    })
    await assertVisibleFocusIndicator(wordmark)
    await page.keyboard.press('Tab')
    await assertVisibleFocusIndicator(page.getByLabel('Brand', { exact: true }))
    await page.keyboard.press('Tab')
    await assertVisibleFocusIndicator(
      page.getByRole('button', { name: 'Open the selected brand' })
    )
    await page.keyboard.press('Tab')
    await assertVisibleFocusIndicator(
      page.getByRole('link', { exact: true, name: 'Today' })
    )
    await page.keyboard.press('Tab')
    await assertVisibleFocusIndicator(
      page.getByRole('link', { exact: true, name: 'Intent' })
    )
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur()
      }
    })

    const masks = [
      page.locator('.brand-switcher'),
      page.locator('.sidebar__foot p'),
      page.locator('.page-header .lede'),
      page.locator('.import-status a'),
    ]
    const captureReflowProof = async ({
      label,
      width,
    }: {
      readonly label: string
      readonly width: number
    }): Promise<void> => {
      await page.setViewportSize({ height: 900, width })
      await assertNoHorizontalOverflow(page)
      if (width === 320) {
        await assertNoElementHorizontalOverflow(
          page.getByRole('navigation', { name: 'Primary' })
        )
      }
      await captureDeterministicScreenshot({
        mask: masks,
        name: `${label}.png`,
        page,
      })
    }
    await captureReflowProof({
      label: 'brand-context-primary',
      width: 1280,
    })
    await captureReflowProof({
      label: 'brand-context-app-breakpoint-1101',
      width: 1101,
    })
    await captureReflowProof({
      label: 'brand-context-app-breakpoint-1100',
      width: 1100,
    })
    await captureReflowProof({
      label: 'brand-context-app-breakpoint-901',
      width: 901,
    })
    await captureReflowProof({
      label: 'brand-context-app-breakpoint-900',
      width: 900,
    })
    await captureReflowProof({
      label: 'brand-context-app-breakpoint-641',
      width: 641,
    })
    await captureReflowProof({
      label: 'brand-context-app-breakpoint-640',
      width: 640,
    })
    await captureReflowProof({
      label: 'brand-context-400-percent',
      width: 320,
    })
  } finally {
    await owner.context.close()
    await cleanTestData(registry)
  }
})

test('the four Phase 0 mandatory journeys cross browser, boundaries, and PostgreSQL', async ({
  browser,
}) => {
  test.setTimeout(360_000)
  const fixtureId = randomUUID()
  const suffix = fixtureId.slice(0, 8)
  const brandName = `Atelier E2E ${suffix}`
  const brandSlug = `atelier-e2e-${suffix}`
  const conversationTitle = `Posizionamento privato ${suffix}`
  const intentStatement = `Rendere verificabile il posizionamento ${suffix}`
  const organizationName = `Organizzazione E2E ${suffix}`
  const organizationSlug = `organizzazione-e2e-${suffix}`
  const outsiderBrandName = `Altro brand E2E ${suffix}`
  const outsiderBrandSlug = `altro-brand-e2e-${suffix}`
  const outsiderOrganizationName = `Altro tenant E2E ${suffix}`
  const outsiderOrganizationSlug = `altro-tenant-e2e-${suffix}`
  const contextsToClose: BrowserContext[] = []
  const browserConsoleMessages: string[] = []
  const registry = createTestDataRegistry()
  const ownerEmail = `owner-${suffix}@e2e.branderize.test`
  const collaboratorEmail = `member-${suffix}@e2e.branderize.test`
  const outsiderEmail = `outsider-${suffix}@e2e.branderize.test`
  registry.organizationSlugs.add(organizationSlug)
  registry.organizationSlugs.add(outsiderOrganizationSlug)
  registry.userEmails.add(ownerEmail)
  registry.userEmails.add(collaboratorEmail)
  registry.userEmails.add(outsiderEmail)

  try {
    const owner = await createAuthenticatedBrowser({
      browser,
      email: ownerEmail,
      name: `Owner ${suffix}`,
    })
    contextsToClose.push(owner.context)
    captureBrowserConsole(owner.context, browserConsoleMessages)
    registry.userIds.add(owner.userId)
    const collaborator = await createAuthenticatedBrowser({
      browser,
      email: collaboratorEmail,
      name: `Member ${suffix}`,
    })
    contextsToClose.push(collaborator.context)
    captureBrowserConsole(collaborator.context, browserConsoleMessages)
    registry.userIds.add(collaborator.userId)
    const outsider = await createAuthenticatedBrowser({
      browser,
      email: outsiderEmail,
      name: `Outsider ${suffix}`,
    })
    contextsToClose.push(outsider.context)
    captureBrowserConsole(outsider.context, browserConsoleMessages)
    registry.userIds.add(outsider.userId)

    const ownerPage = await owner.context.newPage()
    await ownerPage.goto('/')
    await expect(ownerPage).toHaveURL(`${appOrigin}/onboarding`)
    await ownerPage.getByLabel('Organization name').fill(organizationName)
    await ownerPage.getByLabel('Organization slug').fill(organizationSlug)
    await ownerPage.getByLabel('Brand name').fill(brandName)
    await ownerPage.getByLabel('Brand slug').fill(brandSlug)
    await ownerPage.getByLabel('Website').fill(`https://${brandSlug}.example`)
    await ownerPage.getByLabel('First goal').fill(intentStatement)
    await ownerPage
      .getByRole('button', { name: 'Create brand and continue' })
      .click()
    await expect(ownerPage).toHaveURL(BRAND_CONTEXT_URL_PATTERN)

    const brandId = readPathIdentifier({ position: 1, url: ownerPage.url() })
    await expect(
      ownerPage.getByRole('heading', {
        name: 'The site is not in Brand Context yet.',
      })
    ).toBeVisible()
    await expect(
      ownerPage.getByText('No Objects have been produced for this brand.')
    ).toBeVisible()
    await expect(
      ownerPage.locator('.sidebar__foot').getByText('owner', { exact: true })
    ).toBeVisible()

    const proof = await databasePool.query<OnboardingProofRow>(
      `SELECT
         b.id AS "brandId",
         b.name AS "brandName",
         b.slug AS "brandSlug",
         b.organization_id AS "organizationId",
         b.website_url AS "websiteUrl",
         i.id AS "intentId",
         i.revision AS "intentRevision",
         i.statement AS "intentStatement",
         i.status AS "intentStatus",
         a.id AS "actionId",
         a.intent_id AS "actionIntentId",
         a.type AS "actionType",
         a.payload->>'outcome' AS "onboardingOutcome",
         actor.actor_key AS "actorKey",
         ledger.amount::text AS "grantAmount"
       FROM brands b
       INNER JOIN intents i
         ON i.brand_id = b.id AND i.status = 'active'
       INNER JOIN actions a
         ON a.brand_id = b.id AND a.intent_id = i.id
       INNER JOIN actors actor ON actor.id = a.actor_id
       INNER JOIN credit_ledger ledger
         ON ledger.brand_id = b.id AND ledger.entry_type = 'grant'
       WHERE b.id = $1`,
      [brandId]
    )
    expect(proof.rowCount).toBe(1)
    const [onboarding] = proof.rows
    if (onboarding === undefined) {
      throw new Error('Onboarding did not commit its canonical database proof')
    }
    registry.organizationIds.add(onboarding.organizationId)
    expect(onboarding).toMatchObject({
      actionIntentId: onboarding.intentId,
      actionType: 'intent_declared',
      actorKey: `human:${owner.userId}`,
      brandId,
      brandName,
      brandSlug,
      grantAmount: '5.000000',
      intentRevision: 1,
      intentStatement,
      intentStatus: 'active',
      onboardingOutcome: 'brand_created',
      websiteUrl: `https://${brandSlug}.example`,
    })

    const outsiderPage = await outsider.context.newPage()
    await outsiderPage.goto('/')
    await expect(outsiderPage).toHaveURL(`${appOrigin}/onboarding`)
    await outsiderPage
      .getByLabel('Organization name')
      .fill(outsiderOrganizationName)
    await outsiderPage
      .getByLabel('Organization slug')
      .fill(outsiderOrganizationSlug)
    await outsiderPage.getByLabel('Brand name').fill(outsiderBrandName)
    await outsiderPage.getByLabel('Brand slug').fill(outsiderBrandSlug)
    await outsiderPage
      .getByLabel('Website')
      .fill(`https://${outsiderBrandSlug}.example`)
    await outsiderPage
      .getByLabel('First goal')
      .fill(`Intent altro tenant ${suffix}`)
    await outsiderPage
      .getByRole('button', { name: 'Create brand and continue' })
      .click()
    await expect(outsiderPage).toHaveURL(BRAND_CONTEXT_URL_PATTERN)

    await ownerPage.getByRole('button', { name: 'Start import' }).click()
    await expect(
      ownerPage.getByRole('heading', {
        name: 'The brand has an active Brand Context.',
      })
    ).toBeVisible({ timeout: 30_000 })
    await expect(ownerPage.getByText('2 visible objects')).toBeVisible()

    const contextProof = await databasePool.query<ContextImportProofRow>(
      `SELECT
         bootstrap.id AS "actionId",
         actor.actor_key AS "actorKey",
         artifact.blob_key AS "artifactBlobKey",
         artifact.blob_byte_size::text AS "artifactByteSize",
         artifact.blob_content_type AS "artifactContentType",
         artifact.content->>'finalUrl' AS "artifactFinalUrl",
         artifact.id AS "artifactId",
         artifact.blob_sha256 AS "artifactSha256",
         artifact.content->>'sourceUrl' AS "artifactSourceUrl",
         context.id AS "contextId",
         context.content->>'normalization' AS "contextNormalization",
         context.content->'snapshot'->'evidence'->>'provider' AS "contextProvider",
         context.content->>'source' AS "contextSource",
         context.content->>'websiteUrl' AS "contextWebsiteUrl"
       FROM objects context
       INNER JOIN actions bootstrap
         ON bootstrap.id = context.produced_by
       INNER JOIN actors actor ON actor.id = bootstrap.actor_id
       INNER JOIN objects artifact
         ON artifact.produced_by = bootstrap.id
        AND artifact.brand_id = context.brand_id
        AND artifact.type = 'artifact'
       WHERE context.brand_id = $1
         AND context.type = 'brand_context'
         AND context.singleton_key = 'brand-context'
         AND context.status = 'active'`,
      [brandId]
    )
    expect(contextProof.rowCount).toBe(1)
    const [importedContext] = contextProof.rows
    if (importedContext === undefined) {
      throw new Error('Context import did not commit its canonical proof')
    }
    expect(importedContext).toMatchObject({
      actorKey: 'system:context-dev',
      artifactContentType: 'image/svg+xml',
      artifactFinalUrl: SCRIPTED_ASSET_SOURCE_URL,
      artifactSourceUrl: SCRIPTED_ASSET_SOURCE_URL,
      contextNormalization: 'context-dev-url-v1',
      contextProvider: 'context.dev',
      contextSource: 'context.dev',
      contextWebsiteUrl: `https://${brandSlug}.example`,
    })
    expect(Number(importedContext.artifactByteSize)).toBeGreaterThan(0)
    expect(importedContext.artifactBlobKey).toBe(
      `brands/${brandId}/artifacts/sha256/${importedContext.artifactSha256}.svg`
    )

    await ownerPage.goto(
      `/brands/${brandId}/objects/${importedContext.artifactId}`
    )
    await expect(
      ownerPage.getByRole('heading', { name: 'artifact' })
    ).toBeVisible()
    await expect(ownerPage.getByText('system:context-dev')).toBeVisible()
    await expect(ownerPage.getByText('image/svg+xml')).toBeVisible()
    await expect(
      ownerPage.getByRole('link', { name: 'Preview ↗' })
    ).toBeVisible()

    const deliveredArtifact = await ownerPage.evaluate(
      async ({ artifactId, currentBrandId }) => {
        const url = `/api/brands/${currentBrandId}/artifacts/${artifactId}?delivery=preview`
        const response = await fetch(url)
        const body = await response.text()
        const etag = response.headers.get('etag')
        const conditional = await fetch(url, {
          headers: etag === null ? {} : { 'if-none-match': etag },
        })
        return {
          body,
          conditionalStatus: conditional.status,
          contentSecurityPolicy: response.headers.get(
            'content-security-policy'
          ),
          contentType: response.headers.get('content-type'),
          etag,
          status: response.status,
        }
      },
      {
        artifactId: importedContext.artifactId,
        currentBrandId: brandId,
      }
    )
    expect(deliveredArtifact).toMatchObject({
      conditionalStatus: 304,
      contentSecurityPolicy: "default-src 'none'; sandbox",
      contentType: 'image/svg+xml',
      status: 200,
    })
    expect(deliveredArtifact.body).toContain(SCRIPTED_ASSET_MARKER)
    expect(deliveredArtifact.etag).not.toBeNull()

    const artifactDeliveryPath = `/api/brands/${brandId}/artifacts/${importedContext.artifactId}`
    const downloadedArtifact = await owner.context.request.get(
      `${artifactDeliveryPath}?delivery=download`
    )
    expect(downloadedArtifact.status()).toBe(200)
    expect(downloadedArtifact.headers()['content-disposition']).toBe(
      `attachment; filename="${importedContext.artifactId}.svg"`
    )
    expect(await downloadedArtifact.text()).toContain(SCRIPTED_ASSET_MARKER)

    const unauthenticated = await browser.newContext({ baseURL: appOrigin })
    contextsToClose.push(unauthenticated)
    const unauthenticatedArtifact = await unauthenticated.request.get(
      `${artifactDeliveryPath}?delivery=preview`
    )
    expect(unauthenticatedArtifact.status()).toBe(401)

    await ownerPage.getByRole('link', { exact: true, name: 'Intent' }).click()
    await ownerPage.getByRole('link', { name: intentStatement }).click()
    await expect(ownerPage.getByText(`human:${owner.userId}`)).toBeVisible()
    await expect(ownerPage.getByText('Root', { exact: true })).toBeVisible()

    await ownerPage.getByRole('link', { exact: true, name: 'CMO' }).click()
    await ownerPage.getByLabel('New conversation').fill(conversationTitle)
    await ownerPage.getByRole('button', { exact: true, name: 'Open' }).click()
    await expect(ownerPage).toHaveURL(CMO_CONVERSATION_URL_PATTERN)
    const conversationId = readPathIdentifier({
      position: 3,
      url: ownerPage.url(),
    })
    await expect(
      ownerPage.getByRole('heading', { name: conversationTitle })
    ).toBeVisible()
    await expect(
      ownerPage.getByText('Owner-private', { exact: true })
    ).toBeVisible()

    const dispatchResult = await ownerPage.evaluate(async (secret) => {
      const response = await fetch('/api/internal/cron/dispatch', {
        headers: { authorization: `Bearer ${secret}` },
      })
      return {
        body: await response.json(),
        status: response.status,
      }
    }, cronSecret)
    expect(dispatchResult).toEqual({
      body: { accepted: 7, attempted: 7, status: 'ok' },
      status: 200,
    })

    await ownerPage.getByLabel('Message to the CMO').fill(CMO_SPECIALIST_PROMPT)
    await ownerPage.getByRole('button', { name: 'Send' }).click()
    await expect(ownerPage.getByText(CMO_SPECIALIST_PROMPT)).toBeVisible()

    let requestedTask: TaskRequestProofRow | undefined
    await expect
      .poll(
        async () => {
          const taskRequestResult =
            await databasePool.query<TaskRequestProofRow>(
              `SELECT
               action.session_id AS "actionSessionId",
               action.type AS "actionType",
               actor.actor_key AS "actorKey",
               conversation.session_id AS "cmoSessionId",
               task.intent_id AS "intentId",
               task.status,
               task.id AS "taskId",
               task.session_id AS "taskSessionId",
               task.worker_key AS "workerKey"
             FROM tasks task
             INNER JOIN actions action
               ON action.task_id = task.id
              AND action.type = 'specialist_work_requested'
             INNER JOIN actors actor ON actor.id = action.actor_id
             INNER JOIN cmo_conversations conversation
               ON conversation.id = $2
             WHERE task.brand_id = $1
               AND task.kind = 'product-marketer.brand-context.v1'
             ORDER BY task.created_at DESC
             LIMIT 1`,
              [brandId, conversationId]
            )
          ;[requestedTask] = taskRequestResult.rows
          const isBoundToConversation =
            typeof requestedTask?.cmoSessionId === 'string' &&
            requestedTask.cmoSessionId.length > 0 &&
            requestedTask.actionSessionId === requestedTask.cmoSessionId
          const hasStartedTaskSession =
            typeof requestedTask?.taskSessionId === 'string' &&
            requestedTask.taskSessionId.length > 0 &&
            (requestedTask.status === 'running' ||
              requestedTask.status === 'succeeded')
          return hasStartedTaskSession && isBoundToConversation
            ? 'immediate-dispatch-observed'
            : null
        },
        { timeout: 45_000 }
      )
      .toBe('immediate-dispatch-observed')
    if (requestedTask === undefined) {
      throw new Error('CMO did not request the Product Marketer task')
    }
    const requestedTaskProof = requestedTask
    expect(requestedTaskProof).toMatchObject({
      actionSessionId: requestedTaskProof.cmoSessionId,
      actionType: 'specialist_work_requested',
      actorKey: 'agent:cmo',
      intentId: onboarding.intentId,
      workerKey: 'product-marketer',
    })
    expect(requestedTaskProof.cmoSessionId).not.toHaveLength(0)
    expect(requestedTaskProof.taskSessionId).not.toBeNull()
    await expect(ownerPage.locator('.cmo-status')).toContainText('Ready', {
      timeout: 30_000,
    })
    let writerCheckpoint: ConversationCheckpointProofRow | undefined
    await expect
      .poll(async () => {
        const result = await databasePool.query<ConversationCheckpointProofRow>(
          `SELECT
               session_id AS "sessionId",
               stream_index::int AS "streamIndex"
             FROM cmo_conversations
             WHERE id = $1
               AND owner_user_id = $2`,
          [conversationId, owner.userId]
        )
        ;[writerCheckpoint] = result.rows
        return writerCheckpoint?.streamIndex ?? 0
      })
      .toBeGreaterThan(0)
    expect(writerCheckpoint?.sessionId).toBe(requestedTaskProof.cmoSessionId)

    let completedTask: TaskCompletionProofRow | undefined
    await expect
      .poll(
        async () => {
          const taskCompletionResult =
            await databasePool.query<TaskCompletionProofRow>(
              `SELECT
               result_action.type AS "actionType",
               actor.actor_key AS "actorKey",
               produced.content->>'basisObjectId' AS "basisObjectId",
               task.completion->>'status' AS "completionStatus",
               produced.id AS "newContextId",
               produced.content->>'source' AS "newContextSource",
               produced.status AS "newContextStatus",
               basis.status AS "oldContextStatus",
               task.outcome_code AS "outcomeCode",
               task.session_id AS "sessionId",
               task.status,
               (
                 SELECT count(*)::int
                 FROM session_events event
                 WHERE event.task_id = task.id
                   AND event.event_kind = 'session.completed'
               ) AS "terminalEventCount"
             FROM tasks task
             LEFT JOIN actions result_action
               ON result_action.id = task.result_action_id
             LEFT JOIN actors actor ON actor.id = result_action.actor_id
             LEFT JOIN objects produced
               ON produced.produced_by = result_action.id
              AND produced.type = 'brand_context'
             LEFT JOIN objects basis
               ON basis.id = (produced.content->>'basisObjectId')::uuid
             WHERE task.id = $1`,
              [requestedTaskProof.taskId]
            )
          ;[completedTask] = taskCompletionResult.rows
          const taskEventResult = await databasePool.query<TaskEventProofRow>(
            `SELECT coalesce(
               array_agg(event_kind ORDER BY ingestion_sequence),
               ARRAY[]::text[]
             ) AS "eventKinds"
             FROM session_events
             WHERE task_id = $1`,
            [requestedTaskProof.taskId]
          )
          const productMarketerTraceCount = (
            await readScriptedGatewayTraces()
          ).filter(
            (trace) =>
              trace.agent === 'product-marketer' &&
              trace.lane === 'task' &&
              trace.providerOptions.user === brandId
          ).length
          return {
            actionType: completedTask?.actionType ?? null,
            eventKinds: taskEventResult.rows[0]?.eventKinds ?? [],
            productMarketerTraceCount,
            status: completedTask?.status ?? null,
          }
        },
        { timeout: 60_000 }
      )
      .toMatchObject({ status: 'succeeded' })
    if (completedTask === undefined) {
      throw new Error('Product Marketer did not settle its canonical task')
    }
    expect(completedTask).toMatchObject({
      actionType: 'brand_context_enriched',
      actorKey: 'agent:product-marketer',
      basisObjectId: importedContext.contextId,
      completionStatus: 'completed',
      newContextSource: 'product-marketer',
      newContextStatus: 'active',
      oldContextStatus: 'superseded',
      outcomeCode: 'completed',
      status: 'succeeded',
      terminalEventCount: 1,
    })
    expect(completedTask.sessionId).not.toHaveLength(0)
    expect(completedTask.sessionId).toBe(requestedTaskProof.taskSessionId)

    await ownerPage.goto(`/brands/${brandId}/work/${requestedTaskProof.taskId}`)
    await expect(
      ownerPage.getByRole('heading', { name: 'succeeded' })
    ).toBeVisible()
    await expect(ownerPage.getByText('Completion · completed')).toBeVisible()
    await ownerPage
      .getByRole('link', { name: 'Open the produced Object →' })
      .click()
    await expect(
      ownerPage.getByRole('heading', { name: 'brand-context' })
    ).toBeVisible()
    await expect(ownerPage.getByText('agent:product-marketer')).toBeVisible()
    await expect(
      ownerPage.getByText(PRODUCT_MARKETER_SOURCE_PATTERN).first()
    ).toBeVisible()

    const readRawStreamBoundary = async (
      label: string
    ): Promise<ProxyStreamProbeReceipt> => {
      const startedAt = performance.now()
      const cookieHeader = (await owner.context.cookies(appOrigin))
        .map(({ name, value }) => `${name}=${value}`)
        .join('; ')
      const streamUrl = new URL(
        `/api/brands/${brandId}/cmo/${conversationId}/eve/v1/session/${encodeURIComponent(requestedTaskProof.cmoSessionId)}/stream`,
        appOrigin
      )
      streamUrl.searchParams.set('includeTailIndex', '1')
      const signal = AbortSignal.timeout(PROXY_SNAPSHOT_BUDGET_MS)
      const events: Array<{ readonly index: number; readonly type: string }> =
        []
      const decoder = new TextDecoder()
      let pendingText = ''
      let response: Response | undefined
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
      let expectedEventCount: number | null = null
      let failureStage: ProxyStreamProbeReceipt['failureStage'] = 'fetch'
      let firstHeaderMilliseconds: number | null = null
      let readFailure: unknown
      let responseBody: ProxyStreamProbeReceipt['responseBody'] = null
      let responseHeaders: ProxyStreamProbeReceipt['responseHeaders'] = {
        'content-type': null,
        'x-eve-session-id': null,
        'x-eve-stream-format': null,
        'x-eve-stream-tail-index': null,
        'x-eve-stream-version': null,
      }
      let status: number | null = null
      let tailIndex: number | null = null
      const consumeCompleteLines = (text: string): void => {
        pendingText += text
        const lines = pendingText.split('\n')
        pendingText = lines.pop() ?? ''
        for (const line of lines) {
          if (
            (expectedEventCount !== null &&
              events.length >= expectedEventCount) ||
            line.length === 0
          ) {
            continue
          }
          const event: unknown = JSON.parse(line)
          if (
            typeof event !== 'object' ||
            event === null ||
            !('type' in event) ||
            typeof event.type !== 'string'
          ) {
            throw new Error(`${label} proxy stream emitted an invalid event`)
          }
          events.push({ index: events.length, type: event.type })
        }
      }
      const readThroughTail = async (): Promise<void> => {
        if (
          expectedEventCount !== null &&
          events.length >= expectedEventCount
        ) {
          return
        }
        if (reader === undefined) {
          throw new Error(`${label} proxy stream reader was not initialized`)
        }
        const { done, value } = await reader.read()
        if (done) {
          consumeCompleteLines(`${decoder.decode()}\n`)
          return
        }
        consumeCompleteLines(decoder.decode(value, { stream: true }))
        await readThroughTail()
      }
      const readBoundedTextBody = async (): Promise<
        NonNullable<ProxyStreamProbeReceipt['responseBody']>
      > => {
        if (response?.body === null || response?.body === undefined) {
          return {
            bytesRead: 0,
            limitBytes: PROXY_DIAGNOSTIC_BODY_LIMIT_BYTES,
            text: '',
            truncated: false,
          }
        }
        reader = response.body.getReader()
        const textParts: string[] = []
        let bytesRead = 0
        let truncated = false
        const readNextChunk = async (): Promise<boolean> => {
          if (bytesRead >= PROXY_DIAGNOSTIC_BODY_LIMIT_BYTES) {
            return false
          }
          const { done, value } = await reader.read()
          if (done) {
            textParts.push(decoder.decode())
            return true
          }
          const remainingBytes = PROXY_DIAGNOSTIC_BODY_LIMIT_BYTES - bytesRead
          const capturedChunk = value.subarray(0, remainingBytes)
          bytesRead += capturedChunk.byteLength
          textParts.push(decoder.decode(capturedChunk, { stream: true }))
          if (capturedChunk.byteLength < value.byteLength) {
            truncated = true
            return false
          }
          const bodyEnded = await readNextChunk()
          return bodyEnded
        }
        const bodyEnded = await readNextChunk()
        if (bodyEnded) {
          return {
            bytesRead,
            limitBytes: PROXY_DIAGNOSTIC_BODY_LIMIT_BYTES,
            text: textParts.join(''),
            truncated,
          }
        }
        if (!truncated) {
          // One bounded look-ahead distinguishes an exact-limit body from truncation.
          const { done } = await reader.read()
          truncated = !done
        }
        textParts.push(decoder.decode())
        return {
          bytesRead,
          limitBytes: PROXY_DIAGNOSTIC_BODY_LIMIT_BYTES,
          text: textParts.join(''),
          truncated,
        }
      }
      try {
        response = await fetch(streamUrl, {
          cache: 'no-store',
          headers: { cookie: cookieHeader },
          redirect: 'error',
          signal,
        })
        firstHeaderMilliseconds = performance.now() - startedAt
        ;({ status } = response)
        failureStage = 'headers'
        responseHeaders = {
          'content-type': response.headers.get('content-type'),
          'x-eve-session-id': response.headers.get('x-eve-session-id'),
          'x-eve-stream-format': response.headers.get('x-eve-stream-format'),
          'x-eve-stream-tail-index': response.headers.get(
            'x-eve-stream-tail-index'
          ),
          'x-eve-stream-version': response.headers.get('x-eve-stream-version'),
        }
        if (status === 200) {
          const rawTailIndex = responseHeaders['x-eve-stream-tail-index']
          if (
            rawTailIndex === null ||
            !STREAM_TAIL_INDEX_PATTERN.test(rawTailIndex)
          ) {
            throw new Error(`${label} proxy stream omitted a valid tail index`)
          }
          tailIndex = Number(rawTailIndex)
          if (!Number.isSafeInteger(tailIndex) || tailIndex < -1) {
            throw new Error(
              `${label} proxy stream reported an invalid tail index`
            )
          }
          if (response.body === null) {
            throw new Error(`${label} proxy stream returned no body`)
          }
          expectedEventCount = tailIndex + 1
          failureStage = 'body'
          reader = response.body.getReader()
          await readThroughTail()
          failureStage = null
        } else {
          failureStage = 'body'
          responseBody = await readBoundedTextBody()
          failureStage = null
        }
      } catch (error) {
        readFailure = error
      } finally {
        try {
          if (reader === undefined) {
            await response?.body?.cancel()
          } else {
            await reader.cancel()
          }
        } catch (error) {
          if (readFailure === undefined) {
            readFailure = error
          }
        }
      }
      const completionMilliseconds = performance.now() - startedAt
      let sessionState: string | null = null
      for (const event of events) {
        if (event.type.startsWith('session.')) {
          sessionState = event.type
        }
      }
      const receipt: ProxyStreamProbeReceipt = {
        completionMilliseconds,
        error:
          readFailure === undefined
            ? null
            : {
                message:
                  readFailure instanceof Error
                    ? readFailure.message
                    : String(readFailure),
                name:
                  readFailure instanceof Error
                    ? readFailure.name
                    : 'UnknownError',
              },
        eventCount: events.length,
        events: events.slice(),
        expectedEventCount,
        failureStage,
        firstHeaderMilliseconds,
        responseBody,
        responseHeaders,
        sessionState,
        status,
        tailIndex,
      }
      await test
        .info()
        .attach(`proxy-stream-${label.replaceAll(' ', '-')}.json`, {
          body: JSON.stringify(receipt, null, 2),
          contentType: 'application/json',
        })
      return receipt
    }

    const readDirectCmoStreamBoundary = async ({
      label,
      mode,
    }: {
      readonly label: string
      readonly mode: DirectCmoStreamProbeReceipt['mode']
    }): Promise<DirectCmoStreamProbeReceipt> => {
      const startedAt = performance.now()
      const streamUrl = new URL(
        `/eve/v1/session/${encodeURIComponent(requestedTaskProof.cmoSessionId)}/stream`,
        functionalAgentOrigins.cmo
      )
      if (mode === 'bounded') {
        streamUrl.searchParams.set('includeTailIndex', '1')
      }
      const signal = AbortSignal.timeout(PROXY_SNAPSHOT_BUDGET_MS)
      const events: Array<{ readonly index: number; readonly type: string }> =
        []
      const decoder = new TextDecoder()
      let pendingText = ''
      let response: Response | undefined
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
      let expectedEventCount: number | null = null
      let failureStage: ProxyStreamProbeReceipt['failureStage'] = 'fetch'
      let firstHeaderMilliseconds: number | null = null
      let readFailure: unknown
      let status: number | null = null
      let tailIndex: number | null = null
      const hasReachedBoundary = (): boolean =>
        mode === 'bounded'
          ? expectedEventCount !== null && events.length >= expectedEventCount
          : events.length > 0
      const consumeCompleteLines = (text: string): void => {
        pendingText += text
        const lines = pendingText.split('\n')
        pendingText = lines.pop() ?? ''
        for (const line of lines) {
          if (hasReachedBoundary() || line.length === 0) {
            continue
          }
          const event: unknown = JSON.parse(line)
          if (
            typeof event !== 'object' ||
            event === null ||
            !('type' in event) ||
            typeof event.type !== 'string'
          ) {
            throw new Error(
              `${label} direct CMO stream emitted an invalid event`
            )
          }
          events.push({ index: events.length, type: event.type })
        }
      }
      const readUntilBoundary = async (): Promise<void> => {
        if (hasReachedBoundary()) {
          return
        }
        if (reader === undefined) {
          throw new Error(`${label} direct CMO reader was not initialized`)
        }
        const { done, value } = await reader.read()
        if (done) {
          consumeCompleteLines(`${decoder.decode()}\n`)
          return
        }
        consumeCompleteLines(decoder.decode(value, { stream: true }))
        await readUntilBoundary()
      }
      try {
        response = await fetch(streamUrl, {
          cache: 'no-store',
          headers: {
            authorization: `Bearer ${mintE2eCmoBridgeToken({
              brandId,
              conversationId,
              userId: owner.userId,
            })}`,
          },
          redirect: 'error',
          signal,
        })
        firstHeaderMilliseconds = performance.now() - startedAt
        ;({ status } = response)
        failureStage = 'headers'
        if (status !== 200) {
          throw new Error(
            `${label} direct CMO stream returned status ${status}`
          )
        }
        const rawTailIndex = response.headers.get('x-eve-stream-tail-index')
        if (rawTailIndex !== null) {
          if (!STREAM_TAIL_INDEX_PATTERN.test(rawTailIndex)) {
            throw new Error(`${label} direct CMO stream returned invalid tail`)
          }
          tailIndex = Number(rawTailIndex)
          if (!Number.isSafeInteger(tailIndex) || tailIndex < -1) {
            throw new Error(`${label} direct CMO stream returned invalid tail`)
          }
        }
        if (mode === 'bounded') {
          if (tailIndex === null) {
            throw new Error(`${label} direct CMO stream omitted its tail`)
          }
          expectedEventCount = tailIndex + 1
        }
        if (response.body === null) {
          throw new Error(`${label} direct CMO stream returned no body`)
        }
        failureStage = 'body'
        reader = response.body.getReader()
        await readUntilBoundary()
        if (!hasReachedBoundary()) {
          throw new Error(
            `${label} direct CMO stream ended before its boundary`
          )
        }
        failureStage = null
      } catch (error) {
        readFailure = error
      } finally {
        try {
          if (reader === undefined) {
            await response?.body?.cancel()
          } else {
            await reader.cancel()
          }
        } catch (error) {
          if (readFailure === undefined) {
            readFailure = error
          }
        }
      }
      const completionMilliseconds = performance.now() - startedAt
      let sessionState: string | null = null
      for (const event of events) {
        if (event.type.startsWith('session.')) {
          sessionState = event.type
        }
      }
      const receipt: DirectCmoStreamProbeReceipt = {
        completionMilliseconds,
        error:
          readFailure === undefined
            ? null
            : {
                message:
                  readFailure instanceof Error
                    ? readFailure.message
                    : String(readFailure),
                name:
                  readFailure instanceof Error
                    ? readFailure.name
                    : 'UnknownError',
              },
        eventCount: events.length,
        events: events.slice(),
        expectedEventCount,
        failureStage,
        firstHeaderMilliseconds,
        mode,
        sessionState,
        status,
        tailIndex,
      }
      await test
        .info()
        .attach(`direct-cmo-${mode}-${label.replaceAll(' ', '-')}.json`, {
          body: JSON.stringify(receipt, null, 2),
          contentType: 'application/json',
        })
      return receipt
    }

    const probeConversationSnapshot = async (
      label: string
    ): Promise<number> => {
      const rawReceipt = await readRawStreamBoundary(label)
      const startedAt = performance.now()
      const cookieHeader = (await owner.context.cookies(appOrigin))
        .map(({ name, value }) => `${name}=${value}`)
        .join('; ')
      const client = new Client({
        headers: { cookie: cookieHeader },
        host: `${appOrigin}/api/brands/${brandId}/cmo/${conversationId}`,
        redirect: 'error',
      })
      const attachedSession = client.sessions.attach(
        requestedTaskProof.cmoSessionId
      )
      let snapshot: Awaited<ReturnType<typeof attachedSession.snapshot>>
      try {
        snapshot = await attachedSession.snapshot({
          signal: AbortSignal.timeout(PROXY_SNAPSHOT_BUDGET_MS),
        })
      } catch (error) {
        const receipt: PublicClientSnapshotReceipt = {
          elapsedMilliseconds: performance.now() - startedAt,
          error: {
            message: error instanceof Error ? error.message : String(error),
            name: error instanceof Error ? error.name : 'UnknownError',
          },
          eventCount: null,
          sessionId: null,
          streamIndex: null,
        }
        await test
          .info()
          .attach(`public-client-${label.replaceAll(' ', '-')}.json`, {
            body: JSON.stringify(receipt, null, 2),
            contentType: 'application/json',
          })
        const directBoundedReceipt = await readDirectCmoStreamBoundary({
          label,
          mode: 'bounded',
        })
        const directUnboundedReceipt = await readDirectCmoStreamBoundary({
          label,
          mode: 'unbounded',
        })
        throw new Error(
          `${label} public Client snapshot failed; receipts ${JSON.stringify({ client: receipt, directBounded: directBoundedReceipt, directUnbounded: directUnboundedReceipt, raw: rawReceipt })}`,
          { cause: error }
        )
      }
      const receipt: PublicClientSnapshotReceipt = {
        elapsedMilliseconds: performance.now() - startedAt,
        error: null,
        eventCount: snapshot.events.length,
        sessionId: snapshot.session.sessionId,
        streamIndex: snapshot.session.streamIndex,
      }
      await test
        .info()
        .attach(`public-client-${label.replaceAll(' ', '-')}.json`, {
          body: JSON.stringify(receipt, null, 2),
          contentType: 'application/json',
        })
      expect(receipt.eventCount, `${label} public Client stream body`).toBe(
        receipt.streamIndex
      )
      expect(receipt.eventCount, `${label} public Client stream body`).toBe(
        snapshot.events.length
      )
      expect(
        receipt.eventCount,
        `${label} public Client stream body`
      ).toBeGreaterThan(0)
      expect(receipt.sessionId, `${label} public Client session`).toBe(
        requestedTaskProof.cmoSessionId
      )
      expect(
        receipt.elapsedMilliseconds,
        `${label} public Client snapshot exceeded the production budget`
      ).toBeLessThan(PROXY_SNAPSHOT_BUDGET_MS)
      return receipt.elapsedMilliseconds
    }

    await probeConversationSnapshot('before runtime override')
    const tracesBeforeRuntimeOverride = await readScriptedGatewayTraces()
    const eventsBeforeRuntimeOverride = await databasePool.query<
      QueryResultRow & { readonly count: number }
    >(
      `SELECT count(*)::int AS count
         FROM session_events
         WHERE conversation_id = $1`,
      [conversationId]
    )
    const runtimeOverride = await owner.context.request.post(
      `/api/brands/${brandId}/cmo/${conversationId}/eve/v1/session/${encodeURIComponent(requestedTaskProof.cmoSessionId)}`,
      {
        data: {
          message: 'This request must not reach inference.',
          model: 'attacker/runtime-override',
        },
      }
    )
    expect(runtimeOverride.status()).toBe(400)
    expect(await readScriptedGatewayTraces()).toHaveLength(
      tracesBeforeRuntimeOverride.length
    )
    const eventsAfterRuntimeOverride = await databasePool.query<
      QueryResultRow & { readonly count: number }
    >(
      `SELECT count(*)::int AS count
         FROM session_events
         WHERE conversation_id = $1`,
      [conversationId]
    )
    expect(eventsAfterRuntimeOverride.rows[0]?.count).toBe(
      eventsBeforeRuntimeOverride.rows[0]?.count
    )
    await probeConversationSnapshot('after runtime override')

    const secondIntentStatement = `Mandatory blocked enterprise Intent ${suffix}`
    const secondIntentPrompt = `Declare a second root Intent exactly as "${secondIntentStatement}" and call request_specialist_work for the returned Intent.`
    await ownerPage.goto(`/brands/${brandId}/cmo/${conversationId}`)
    await ownerPage.getByLabel('Message to the CMO').fill(secondIntentPrompt)
    await ownerPage.getByRole('button', { name: 'Send' }).click()
    await expect(
      ownerPage.getByText(secondIntentPrompt, { exact: true })
    ).toBeVisible()
    await expect(
      ownerPage.getByText(
        'The second root Intent and its Product Marketer work are canonical.'
      )
    ).toBeVisible({ timeout: 30_000 })
    await expect(ownerPage.locator('.cmo-status')).toContainText('Ready')

    let secondIntent: IntentMutationProofRow | undefined
    await expect
      .poll(async () => {
        const result = await databasePool.query<IntentMutationProofRow>(
          `SELECT
             count(action.id)::int AS "actionCount",
             min(action.id::text) AS "actionId",
             min(action.type) AS "actionType",
             author.actor_key AS "authorActorKey",
             intent.id AS "intentId",
             producer.actor_key AS "producerActorKey",
             intent.revision,
             min(action.session_id) AS "sessionId",
             intent.statement,
             intent.status
           FROM intents intent
           INNER JOIN actors author ON author.id = intent.author_actor_id
           INNER JOIN actions action
             ON action.intent_id = intent.id
            AND action.type = 'intent_declared'
           INNER JOIN actors producer ON producer.id = action.actor_id
           WHERE intent.brand_id = $1
             AND intent.statement = $2
           GROUP BY
             intent.id,
             author.actor_key,
             producer.actor_key`,
          [brandId, secondIntentStatement]
        )
        ;[secondIntent] = result.rows
        return secondIntent?.actionCount ?? null
      })
      .toBe(1)
    if (secondIntent === undefined) {
      throw new Error('The second CMO Intent did not become canonical')
    }
    const secondIntentProof = secondIntent
    expect(secondIntentProof).toMatchObject({
      actionCount: 1,
      actionType: 'intent_declared',
      authorActorKey: `human:${owner.userId}`,
      producerActorKey: 'agent:cmo',
      revision: 1,
      sessionId: requestedTaskProof.cmoSessionId,
      statement: secondIntentStatement,
      status: 'active',
    })

    await ownerPage
      .getByLabel('Message to the CMO')
      .fill(CMO_CONSULTATION_PROMPT)
    await ownerPage.getByRole('button', { name: 'Send' }).click()
    await expect(
      ownerPage.getByText(`Product Marketer asks: ${PRODUCT_MARKETER_QUESTION}`)
    ).toBeVisible({ timeout: 30_000 })
    await expect(ownerPage.locator('.cmo-status')).toContainText('Ready')

    await ownerPage
      .getByLabel('Message to the CMO')
      .fill(CMO_CONSULTATION_ANSWER)
    await ownerPage.getByRole('button', { name: 'Send' }).click()
    await expect(
      ownerPage.getByText(
        'The active Intent now records the unambiguous audience answer.'
      )
    ).toBeVisible({ timeout: 30_000 })
    await expect(ownerPage.locator('.cmo-status')).toContainText('Ready')

    let refinedSecondIntent: IntentMutationProofRow | undefined
    await expect
      .poll(async () => {
        const result = await databasePool.query<IntentMutationProofRow>(
          `SELECT
             count(action.id)::int AS "actionCount",
             min(action.id::text) AS "actionId",
             min(action.type) AS "actionType",
             author.actor_key AS "authorActorKey",
             intent.id AS "intentId",
             producer.actor_key AS "producerActorKey",
             intent.revision,
             min(action.session_id) AS "sessionId",
             intent.statement,
             intent.status
           FROM intents intent
           INNER JOIN actors author ON author.id = intent.author_actor_id
           INNER JOIN actions action
             ON action.intent_id = intent.id
            AND action.type = 'intent_refined'
           INNER JOIN actors producer ON producer.id = action.actor_id
           WHERE intent.id = $1
           GROUP BY
             intent.id,
             author.actor_key,
             producer.actor_key`,
          [secondIntentProof.intentId]
        )
        ;[refinedSecondIntent] = result.rows
        return refinedSecondIntent?.revision ?? null
      })
      .toBe(2)
    if (refinedSecondIntent === undefined) {
      throw new Error('The consultation answer did not refine its Intent')
    }
    expect(refinedSecondIntent).toMatchObject({
      actionCount: 1,
      actionType: 'intent_refined',
      authorActorKey: `human:${owner.userId}`,
      producerActorKey: 'agent:cmo',
      revision: 2,
      sessionId: requestedTaskProof.cmoSessionId,
      statement: secondIntentStatement,
      status: 'active',
    })

    await ownerPage.reload()
    await expect(
      ownerPage
        .getByText(secondIntentPrompt, { exact: true })
        .filter({ visible: true })
    ).toBeVisible()
    await expect(
      ownerPage
        .getByText(CMO_CONSULTATION_ANSWER, { exact: true })
        .filter({ visible: true })
    ).toBeVisible()
    await expect(
      ownerPage
        .getByText(
          'The active Intent now records the unambiguous audience answer.',
          { exact: true }
        )
        .filter({ visible: true })
    ).toBeVisible()

    let blockedTask: TaskQuestionProofRow | undefined
    await expect
      .poll(
        async () => {
          const result = await databasePool.query<TaskQuestionProofRow>(
            `SELECT
               count(request_action.id)::int AS "actionCount",
               task.completion->>'status' AS "completionStatus",
               task.intent_id AS "intentId",
               task.completion->'openQuestions' AS "openQuestions",
               task.outcome_code AS "outcomeCode",
               task.session_id AS "sessionId",
               task.status,
               task.id AS "taskId"
             FROM tasks task
             INNER JOIN actions request_action
               ON request_action.task_id = task.id
              AND request_action.type = 'specialist_work_requested'
             WHERE task.intent_id = $1
             GROUP BY task.id`,
            [secondIntentProof.intentId]
          )
          ;[blockedTask] = result.rows
          return blockedTask?.completionStatus ?? null
        },
        { timeout: 60_000 }
      )
      .toBe('blocked')
    if (blockedTask === undefined) {
      throw new Error('The blocked Product Marketer task was not persisted')
    }
    const blockedTaskProof = blockedTask
    expect(blockedTaskProof).toMatchObject({
      actionCount: 1,
      completionStatus: 'blocked',
      intentId: secondIntentProof.intentId,
      openQuestions: [PRODUCT_MARKETER_QUESTION],
      outcomeCode: 'blocked',
      status: 'succeeded',
    })
    expect(blockedTaskProof.sessionId).not.toHaveLength(0)

    const readBlockedTaskStability =
      async (): Promise<TaskStabilityProofRow> => {
        const result = await databasePool.query<TaskStabilityProofRow>(
          `SELECT
           task.attempts,
           (
             SELECT count(*)::int
             FROM session_events event
             WHERE event.task_id = task.id
           ) AS "sessionEventCount",
           task.session_id AS "sessionId",
           task.started_at AS "startedAt",
           task.status
         FROM tasks task
         WHERE task.id = $1`,
          [blockedTaskProof.taskId]
        )
        const [row] = result.rows
        if (row === undefined) {
          throw new Error('The blocked task disappeared')
        }
        return row
      }
    const blockedTaskBeforeOpening = await readBlockedTaskStability()
    await ownerPage.goto(`/brands/${brandId}/work/${blockedTaskProof.taskId}`)
    await expect(
      ownerPage.getByRole('heading', { name: 'Open questions' })
    ).toBeVisible()
    await expect(ownerPage.getByText(PRODUCT_MARKETER_QUESTION)).toBeVisible()
    await expect(
      ownerPage.getByRole('link', { name: 'Answer with the CMO' })
    ).toBeVisible()
    await ownerPage.reload()
    await expect(
      ownerPage.getByRole('heading', { name: 'Open questions' })
    ).toBeVisible()
    expect(await readBlockedTaskStability()).toEqual(blockedTaskBeforeOpening)

    await ownerPage.getByRole('link', { name: 'Answer with the CMO' }).click()
    await expect(
      ownerPage.getByText('The next turn can attest the task')
    ).toBeVisible()
    await ownerPage.getByRole('link', { name: conversationTitle }).click()
    await expect(
      ownerPage.getByText(`This turn attests task ${blockedTaskProof.taskId}.`)
    ).toBeVisible()
    const resolutionsBeforeAnswer = await databasePool.query<
      QueryResultRow & { readonly count: number }
    >(
      `SELECT count(*)::int AS count
         FROM actions
         WHERE task_id = $1
           AND type = 'task_questions_resolved'`,
      [blockedTaskProof.taskId]
    )
    expect(resolutionsBeforeAnswer.rows[0]?.count).toBe(0)

    await ownerPage.getByLabel('Message to the CMO').fill(CMO_RESOLUTION_PROMPT)
    await ownerPage.getByRole('button', { name: 'Send' }).click()
    await expect(
      ownerPage.getByText(
        'The question bundle is resolved and its Intent is refined.'
      )
    ).toBeVisible({ timeout: 30_000 })
    await expect(ownerPage.locator('.cmo-status')).toContainText('Ready')

    let resolution: QuestionResolutionProofRow | undefined
    await expect
      .poll(async () => {
        const result = await databasePool.query<QuestionResolutionProofRow>(
          `SELECT
             action.type AS "actionType",
             actor.actor_key AS "actorKey",
             action.payload->>'disposition' AS "disposition",
             intent.revision AS "intentRevision",
             action.payload->>'rationale' AS "rationale",
             task.id AS "taskId"
           FROM tasks task
           INNER JOIN actions action
             ON action.task_id = task.id
            AND action.type = 'task_questions_resolved'
           INNER JOIN actors actor ON actor.id = action.actor_id
           INNER JOIN intents intent ON intent.id = task.intent_id
           WHERE task.id = $1`,
          [blockedTaskProof.taskId]
        )
        ;[resolution] = result.rows
        return resolution?.intentRevision ?? null
      })
      .toBe(3)
    expect(resolution).toMatchObject({
      actionType: 'task_questions_resolved',
      actorKey: 'agent:cmo',
      disposition: 'answered',
      intentRevision: 3,
      rationale:
        'The human identified enterprise product leaders at growth-stage SaaS.',
      taskId: blockedTaskProof.taskId,
    })

    await ownerPage.goto(`/brands/${brandId}/work/${blockedTaskProof.taskId}`)
    await expect(
      ownerPage.getByRole('heading', { name: 'Open questions' })
    ).toHaveCount(0)
    await expect(
      ownerPage.getByRole('link', { name: 'Answer with the CMO' })
    ).toHaveCount(0)
    expect(await readBlockedTaskStability()).toEqual(blockedTaskBeforeOpening)

    const collaboratorPage = await collaborator.context.newPage()
    await collaboratorPage.goto(`/brands/${brandId}/intent`)
    await expect(
      collaboratorPage.getByRole('heading', {
        name: 'This page is not in your workspace.',
      })
    ).toBeVisible()
    const collaboratorActorsBeforeMembership = await databasePool.query<
      QueryResultRow & { readonly count: number }
    >(
      `SELECT count(*)::int AS count
         FROM actors
         WHERE user_id = $1`,
      [collaborator.userId]
    )
    expect(collaboratorActorsBeforeMembership.rows[0]?.count).toBe(0)

    await databasePool.query(
      `INSERT INTO member (id, organization_id, user_id, role)
       VALUES ($1, $2, $3, 'member')`,
      [randomUUID(), onboarding.organizationId, collaborator.userId]
    )

    await collaboratorPage.goto(`/brands/${brandId}/intent`)
    await expect(
      collaboratorPage.getByRole('link', {
        name: intentStatement,
      })
    ).toBeVisible()
    await expect(
      collaboratorPage.locator('.sidebar__foot').getByText('member', {
        exact: true,
      })
    ).toBeVisible()
    const collaboratorActorAfterRead = await databasePool.query<
      QueryResultRow & {
        readonly actorKey: string
        readonly type: string
        readonly userId: string
      }
    >(
      `SELECT
         actor_key AS "actorKey",
         type,
         user_id AS "userId"
       FROM actors
       WHERE user_id = $1`,
      [collaborator.userId]
    )
    expect(collaboratorActorAfterRead.rowCount).toBe(1)
    expect(collaboratorActorAfterRead.rows[0]).toMatchObject({
      actorKey: `human:${collaborator.userId}`,
      type: 'human',
      userId: collaborator.userId,
    })
    await collaboratorPage.goto(
      `/brands/${brandId}/objects/${completedTask.newContextId}`
    )
    await expect(
      collaboratorPage.getByRole('heading', { name: 'brand-context' })
    ).toBeVisible()
    await expect(
      collaboratorPage.getByText('agent:product-marketer')
    ).toBeVisible()

    await collaboratorPage.goto(`/brands/${brandId}/cmo`)
    await expect(
      collaboratorPage.getByText('0 private').filter({ visible: true })
    ).toBeVisible()
    await expect(collaboratorPage.getByText(conversationTitle)).toHaveCount(0)

    await databasePool.query(
      `UPDATE member
       SET role = 'admin'
       WHERE organization_id = $1
         AND user_id = $2`,
      [onboarding.organizationId, collaborator.userId]
    )
    await collaboratorPage.goto(`/brands/${brandId}/intent`)
    await expect(
      collaboratorPage.getByRole('link', {
        name: intentStatement,
      })
    ).toBeVisible()
    await expect(
      collaboratorPage.locator('.sidebar__foot').getByText('admin', {
        exact: true,
      })
    ).toBeVisible()
    await collaboratorPage.goto(`/brands/${brandId}/cmo`)
    await expect(
      collaboratorPage.getByText('0 private').filter({ visible: true })
    ).toBeVisible()
    await expect(collaboratorPage.getByText(conversationTitle)).toHaveCount(0)

    await collaboratorPage.goto(`/brands/${brandId}/cmo/${conversationId}`)
    await expect(collaboratorPage.getByText(conversationTitle)).toHaveCount(0)
    await expect(
      collaboratorPage.getByRole('heading', {
        name: PRIVATE_ROUTE_BOUNDARY_PATTERN,
      })
    ).toBeVisible()

    await databasePool.query(
      `DELETE FROM member
       WHERE organization_id = $1
         AND user_id = $2`,
      [onboarding.organizationId, collaborator.userId]
    )
    await collaboratorPage.goto(`/brands/${brandId}/intent`)
    await expect(
      collaboratorPage.getByRole('heading', {
        name: 'This page is not in your workspace.',
      })
    ).toBeVisible()

    await outsiderPage.goto(`/brands/${brandId}/intent`)
    await expect(
      outsiderPage.getByRole('heading', {
        name: 'This page is not in your workspace.',
      })
    ).toBeVisible()
    const crossTenantArtifact = await outsider.context.request.get(
      `${artifactDeliveryPath}?delivery=preview`
    )
    expect(crossTenantArtifact.status()).toBe(403)
    const eventsBeforeCrossTenantMutation = await databasePool.query<
      QueryResultRow & { readonly count: number }
    >(
      `SELECT count(*)::int AS count
         FROM session_events
         WHERE conversation_id = $1`,
      [conversationId]
    )
    const crossTenantMutation = await outsider.context.request.post(
      `/api/brands/${brandId}/cmo/${conversationId}/eve/v1/session/${encodeURIComponent(requestedTaskProof.cmoSessionId)}`,
      { data: { message: 'Cross-tenant writes must fail closed.' } }
    )
    expect(crossTenantMutation.status()).toBe(403)
    const eventsAfterCrossTenantMutation = await databasePool.query<
      QueryResultRow & { readonly count: number }
    >(
      `SELECT count(*)::int AS count
         FROM session_events
         WHERE conversation_id = $1`,
      [conversationId]
    )
    expect(eventsAfterCrossTenantMutation.rows[0]?.count).toBe(
      eventsBeforeCrossTenantMutation.rows[0]?.count
    )

    const gatewayTraces = await readScriptedGatewayTraces()
    const expectedAttribution = [
      {
        agent: 'cmo',
        feature: 'feature:conversation',
        lane: 'cmo',
      },
      {
        agent: 'product-marketer',
        feature: 'feature:brand-context',
        lane: 'task',
      },
      {
        agent: 'product-marketer',
        feature: 'feature:brand-context',
        lane: 'consultation',
      },
    ] as const
    for (const expectedTrace of expectedAttribution) {
      const matchingTrace = gatewayTraces.find(
        (trace) =>
          trace.agent === expectedTrace.agent &&
          trace.lane === expectedTrace.lane &&
          trace.providerOptions.user === brandId
      )
      expect(matchingTrace).toBeDefined()
      expect(matchingTrace).toMatchObject({
        costUsd: 0.000_004,
        modelId: SCRIPTED_MODEL_ID,
        providerOptions: {
          user: brandId,
        },
      })
      expect(matchingTrace?.providerOptions.tags).toEqual(
        expect.arrayContaining([
          `agent:${expectedTrace.agent}`,
          'env:development',
          expectedTrace.feature,
          `lane:${expectedTrace.lane}`,
        ])
      )
    }

    const chargeResult = await databasePool.query<ModelChargeProofRow>(
      `SELECT
         ledger.amount::text AS amount,
         (count(*) OVER (
           PARTITION BY ledger.session_event_id
         ))::int AS "duplicateCount",
         ledger.gateway_cost_usd::text AS "gatewayCostUsd",
         ledger.generation_id AS "generationId",
         ledger.input_tokens AS "inputTokens",
         ledger.model_id AS "modelId",
         ledger.output_tokens AS "outputTokens",
         ledger.session_event_id AS "sessionEventId"
       FROM credit_ledger ledger
       WHERE ledger.brand_id = $1
         AND ledger.entry_type = 'model_charge'
       ORDER BY ledger.created_at, ledger.id`,
      [brandId]
    )
    expect(chargeResult.rows.length).toBeGreaterThan(0)
    const chargedGenerationIds = new Set<string>()
    for (const charge of chargeResult.rows) {
      expect(charge).toMatchObject({
        amount: '-0.000004',
        duplicateCount: 1,
        gatewayCostUsd: '0.00000400',
        inputTokens: 120,
        modelId: SCRIPTED_RUNTIME_MODEL_ID,
        outputTokens: 32,
      })
      expect(charge.sessionEventId).not.toHaveLength(0)
      expect(chargedGenerationIds.has(charge.generationId)).toBe(false)
      chargedGenerationIds.add(charge.generationId)
    }
    expect(gatewayTraces.map((trace) => trace.generationId)).toEqual(
      expect.arrayContaining([...chargedGenerationIds])
    )
    const winningStepResult =
      await databasePool.query<WinningModelStepProofRow>(
        `WITH ranked_steps AS (
         SELECT
           event #>> '{data,providerMetadata,gateway,generationId}' AS "generationId",
           row_number() OVER (
             PARTITION BY
               session_id,
               event #>> '{data,turnId}',
               event #>> '{data,sequence}',
               event #>> '{data,stepIndex}'
             ORDER BY ingestion_sequence DESC
           ) AS winner_rank
         FROM session_events
         WHERE brand_id = $1
           AND event_kind = 'step.completed'
       )
       SELECT "generationId"
       FROM ranked_steps
       WHERE winner_rank = 1
         AND "generationId" IS NOT NULL
       ORDER BY "generationId"`,
        [brandId]
      )
    const winningStepGenerationIds = winningStepResult.rows.map(
      (row) => row.generationId
    )
    expect([...chargedGenerationIds].sort()).toEqual(winningStepGenerationIds)
    const winningStepGenerationIdSet = new Set(winningStepGenerationIds)
    const nonWinningTraceGenerationIds = gatewayTraces
      .filter(
        (trace) =>
          trace.providerOptions.user === brandId &&
          !winningStepGenerationIdSet.has(trace.generationId)
      )
      .map((trace) => trace.generationId)
    expect(nonWinningTraceGenerationIds).not.toHaveLength(0)
    expect([...chargedGenerationIds]).toEqual(
      expect.not.arrayContaining(nonWinningTraceGenerationIds)
    )

    const turnBoundary = await databasePool.query<
      QueryResultRow & { readonly sequence: string | null }
    >(
      `SELECT max(ingestion_sequence)::text AS sequence
         FROM session_events
         WHERE conversation_id = $1`,
      [conversationId]
    )
    const boundarySequence = Number(turnBoundary.rows[0]?.sequence ?? '0')
    await ownerPage.goto(`/brands/${brandId}/cmo/${conversationId}`)
    await ownerPage.getByLabel('Message to the CMO').fill(CMO_HOLD_PROMPT)
    await ownerPage.getByRole('button', { name: 'Send' }).click()
    await expect(
      ownerPage.getByText(CMO_HOLD_PROMPT, { exact: true })
    ).toBeVisible()
    await expect(ownerPage.locator('.cmo-status')).toContainText('CMO at work')

    let observedTurn: TurnProofRow | undefined
    await expect
      .poll(async () => {
        const result = await databasePool.query<TurnProofRow>(
          `SELECT
             event_kind AS "eventKind",
             session_id AS "sessionId",
             event->'data'->>'turnId' AS "turnId"
           FROM session_events
           WHERE conversation_id = $1
             AND ingestion_sequence > $2
             AND event_kind = 'turn.started'
           ORDER BY ingestion_sequence DESC
           LIMIT 1`,
          [conversationId, boundarySequence]
        )
        ;[observedTurn] = result.rows
        return observedTurn?.turnId ?? null
      })
      .not.toBeNull()
    if (observedTurn === undefined) {
      throw new Error('The active CMO turn was not persisted')
    }
    expect(observedTurn.sessionId).toBe(requestedTaskProof.cmoSessionId)

    await databasePool.query(
      `UPDATE member
       SET role = 'viewer'
       WHERE organization_id = $1
         AND user_id = $2`,
      [onboarding.organizationId, owner.userId]
    )
    await ownerPage.reload()
    await expect(
      ownerPage
        .getByText(CMO_HOLD_PROMPT, { exact: true })
        .filter({ visible: true })
    ).toBeVisible()
    await expect(
      ownerPage.getByRole('button', { name: 'Stop turn' })
    ).toBeVisible({ timeout: 30_000 })
    await expect(ownerPage.getByLabel('Message to the CMO')).toBeDisabled()

    const wrongTurnCancellation = await owner.context.request.post(
      `/api/brands/${brandId}/cmo/${conversationId}/eve/v1/session/${encodeURIComponent(requestedTaskProof.cmoSessionId)}/cancel`,
      { data: { turnId: `${observedTurn.turnId}-not-observed` } }
    )
    expect(wrongTurnCancellation.status()).toBe(202)
    expect(await wrongTurnCancellation.json()).toEqual({
      ok: true,
      sessionId: requestedTaskProof.cmoSessionId,
      status: 'accepted',
    })
    const cancellationEventsAfterWrongTarget = await databasePool.query<
      QueryResultRow & { readonly count: number }
    >(
      `SELECT count(*)::int AS count
         FROM session_events
         WHERE conversation_id = $1
           AND ingestion_sequence > $2
           AND event_kind = 'turn.cancelled'`,
      [conversationId, boundarySequence]
    )
    expect(cancellationEventsAfterWrongTarget.rows[0]?.count).toBe(0)
    await expect(ownerPage.locator('.cmo-status')).toContainText('CMO at work')
    await expect(
      ownerPage.getByRole('button', { name: 'Stop turn' })
    ).toBeVisible()

    await ownerPage.getByRole('button', { name: 'Stop turn' }).click()
    await expect
      .poll(
        async () => {
          const result = await databasePool.query<TurnProofRow>(
            `SELECT
               event_kind AS "eventKind",
               session_id AS "sessionId",
               event->'data'->>'turnId' AS "turnId"
             FROM session_events
             WHERE conversation_id = $1
               AND ingestion_sequence > $2
               AND event_kind IN ('turn.cancelled', 'session.waiting')
             ORDER BY ingestion_sequence`,
            [conversationId, boundarySequence]
          )
          return {
            cancelled: result.rows.some(
              (row) =>
                row.eventKind === 'turn.cancelled' &&
                row.sessionId === observedTurn?.sessionId &&
                row.turnId === observedTurn?.turnId
            ),
            waiting: result.rows.some(
              (row) =>
                row.eventKind === 'session.waiting' &&
                row.sessionId === observedTurn?.sessionId
            ),
          }
        },
        { timeout: 30_000 }
      )
      .toEqual({ cancelled: true, waiting: true })
    await expect(ownerPage.locator('.cmo-status')).toContainText('Read only')
    await expect(
      ownerPage
        .getByText(CMO_HOLD_PROMPT, { exact: true })
        .filter({ visible: true })
    ).toBeVisible()

    const sensitiveFixtureValues = [
      testAuthSecret,
      cronSecret,
      process.env.AI_GATEWAY_API_KEY,
      process.env.BLOB_READ_WRITE_TOKEN,
      process.env.CMO_BRIDGE_SECRET,
      process.env.CONTEXT_DEV_API_KEY,
      process.env.DATABASE_URL,
      process.env.DISPATCH_SECRET,
      process.env.RESEND_API_KEY,
    ].filter(
      (value): value is string => typeof value === 'string' && value.length > 0
    )
    const renderedSurfaces = await Promise.all(
      [ownerPage, collaboratorPage, outsiderPage].map(async (page) =>
        page.content()
      )
    )
    const providerTracesAfterCancel = await readScriptedGatewayTraces()
    const browserInspectableText = [
      ...renderedSurfaces,
      ...browserConsoleMessages,
      JSON.stringify(providerTracesAfterCancel),
    ].join('\n')
    for (const sensitiveValue of sensitiveFixtureValues) {
      expect(browserInspectableText).not.toContain(sensitiveValue)
    }

    const secretLeakResult = await databasePool.query<
      QueryResultRow & { readonly count: number }
    >(
      `WITH surface AS (
         SELECT to_jsonb(intent)::text AS body
         FROM intents intent
         WHERE intent.brand_id = $1
         UNION ALL
         SELECT to_jsonb(object_row)::text AS body
         FROM objects object_row
         WHERE object_row.brand_id = $1
         UNION ALL
         SELECT to_jsonb(action)::text AS body
         FROM actions action
         WHERE action.brand_id = $1
         UNION ALL
         SELECT to_jsonb(task)::text AS body
         FROM tasks task
         WHERE task.brand_id = $1
         UNION ALL
         SELECT to_jsonb(event_row)::text AS body
         FROM session_events event_row
         WHERE event_row.brand_id = $1
       ), forbidden AS (
         SELECT unnest($2::text[]) AS value
       )
       SELECT count(*)::int AS count
       FROM surface
       CROSS JOIN forbidden
       WHERE position(forbidden.value IN surface.body) > 0`,
      [brandId, sensitiveFixtureValues]
    )
    expect(secretLeakResult.rows[0]?.count).toBe(0)

    const sharedTranscriptLeakResult = await databasePool.query<
      QueryResultRow & { readonly count: number }
    >(
      `WITH shared_surface AS (
         SELECT to_jsonb(intent)::text AS body
         FROM intents intent
         WHERE intent.brand_id = $1
         UNION ALL
         SELECT to_jsonb(object_row)::text AS body
         FROM objects object_row
         WHERE object_row.brand_id = $1
         UNION ALL
         SELECT to_jsonb(action)::text AS body
         FROM actions action
         WHERE action.brand_id = $1
         UNION ALL
         SELECT to_jsonb(task)::text AS body
         FROM tasks task
         WHERE task.brand_id = $1
       ), private_marker AS (
         SELECT unnest($2::text[]) AS value
       )
       SELECT count(*)::int AS count
       FROM shared_surface
       CROSS JOIN private_marker
       WHERE position(private_marker.value IN shared_surface.body) > 0`,
      [brandId, [conversationTitle, CMO_HOLD_PROMPT]]
    )
    expect(sharedTranscriptLeakResult.rows[0]?.count).toBe(0)
  } finally {
    try {
      await Promise.all(contextsToClose.map(async (context) => context.close()))
    } finally {
      await cleanTestData(registry)
    }
  }
})

const insertIntent = async ({
  authorActorId,
  brandId,
  statement,
  status,
}: {
  readonly authorActorId: string
  readonly brandId: string
  readonly statement: string
  readonly status: 'abandoned' | 'active' | 'draft' | 'settled'
}): Promise<string> => {
  const intentId = randomUUID()
  await databasePool.query(
    `INSERT INTO intents (
       id, brand_id, author_actor_id, statement, status, revision
     ) VALUES ($1, $2, $3, $4, $5, 1)`,
    [intentId, brandId, authorActorId, statement, status]
  )
  return intentId
}

const insertProducedReport = async ({
  actorId,
  brandId,
}: {
  readonly actorId: string
  readonly brandId: string
}): Promise<string> => {
  const actionId = randomUUID()
  const reportObjectId = randomUUID()
  await databasePool.query(
    `INSERT INTO actions (
       id, brand_id, actor_id, type, rationale, effect_class, payload,
       policy_snapshot
     ) VALUES (
       $1, $2, $3, 'content_brief_seeded',
       'Seed a Content report for the Notion commitment',
       'graph-internal', jsonb_build_object('objectId', $4::text),
       jsonb_build_object('source', 'e2e')
     )`,
    [actionId, brandId, actorId, reportObjectId]
  )
  await databasePool.query(
    `INSERT INTO objects (
       id, brand_id, type, status, content, content_text, produced_by
     ) VALUES (
       $1, $2, 'report', 'active',
       jsonb_build_object('title', 'Content report'),
       'Content report', $3
     )`,
    [reportObjectId, brandId, actionId]
  )
  return reportObjectId
}

const insertGenericTask = async ({
  activation = 'automatic',
  brandId,
  executionMode = 'agent',
  kind,
  status,
  workerKey,
}: {
  readonly activation?: 'automatic' | 'human'
  readonly brandId: string
  readonly executionMode?: 'agent' | 'direct'
  readonly kind: string
  readonly status: string
  readonly workerKey: string
}): Promise<string> => {
  const taskId = randomUUID()
  const payload = { fixture: kind }
  await databasePool.query(
    `INSERT INTO tasks (
       id, brand_id, kind, subject_key, worker_key, execution_mode,
       activation, status, payload, payload_hash
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10
     )`,
    [
      taskId,
      brandId,
      kind,
      `${kind}:${taskId}`,
      workerKey,
      executionMode,
      activation,
      status,
      JSON.stringify(payload),
      requestHash(payload),
    ]
  )
  return taskId
}

const insertNotionCommitment = async ({
  actorId,
  brandId,
  title,
}: {
  readonly actorId: string
  readonly brandId: string
  readonly title: string
}): Promise<{ readonly reportObjectId: string; readonly taskId: string }> => {
  const reportObjectId = await insertProducedReport({ actorId, brandId })
  const taskId = randomUUID()
  const payload = { reportObjectId, title }
  await databasePool.query(
    `INSERT INTO tasks (
       id, brand_id, kind, subject_key, worker_key, execution_mode,
       activation, status, payload, payload_hash, revision
     ) VALUES (
       $1, $2, 'content.notion-page.v1', $3, 'content', 'direct',
       'human', 'awaiting_approval', $4::jsonb, $5, 1
     )`,
    [
      taskId,
      brandId,
      `commitment:${taskId}`,
      JSON.stringify(payload),
      requestHash(payload),
    ]
  )
  return { reportObjectId, taskId }
}

const latestDismissalFact = async ({
  brandId,
  payloadHash,
}: {
  readonly brandId: string
  readonly payloadHash: string
}): Promise<string | null> => {
  const result = await databasePool.query<
    QueryResultRow & { readonly type: string }
  >(
    `SELECT type
       FROM actions
      WHERE brand_id = $1
        AND type IN ('commitment_dismissed', 'commitment_reopened')
        AND payload->>'payloadHash' = $2
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [brandId, payloadHash]
  )
  return result.rows[0]?.type ?? null
}

test('Phase 1 console journeys prove proposals, approvals, work, and connections', async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const suffix = randomUUID().slice(0, 8)
  const registry = createTestDataRegistry()
  const ownerEmail = `phase1-owner-${suffix}@e2e.branderize.test`
  const memberEmail = `phase1-member-${suffix}@e2e.branderize.test`
  const viewerEmail = `phase1-viewer-${suffix}@e2e.branderize.test`
  const organizationSlug = `phase1-org-${suffix}`
  const brandSlug = `phase1-brand-${suffix}`
  const draftStatement = `Draft proposal ${suffix}`
  const settledStatement = `Settled register ${suffix}`
  const abandonedStatement = `Abandoned register ${suffix}`
  const notionTitle = `Launch page ${suffix}`
  registry.organizationSlugs.add(organizationSlug)
  registry.userEmails.add(ownerEmail)
  registry.userEmails.add(memberEmail)
  registry.userEmails.add(viewerEmail)
  const contextsToClose: BrowserContext[] = []

  try {
    const owner = await createAuthenticatedBrowser({
      browser,
      email: ownerEmail,
      name: `Phase1 Owner ${suffix}`,
    })
    contextsToClose.push(owner.context)
    registry.userIds.add(owner.userId)
    const memberUser = await createAuthenticatedBrowser({
      browser,
      email: memberEmail,
      name: `Phase1 Member ${suffix}`,
    })
    contextsToClose.push(memberUser.context)
    registry.userIds.add(memberUser.userId)
    const viewerUser = await createAuthenticatedBrowser({
      browser,
      email: viewerEmail,
      name: `Phase1 Viewer ${suffix}`,
    })
    contextsToClose.push(viewerUser.context)
    registry.userIds.add(viewerUser.userId)

    const ownerPage = await owner.context.newPage()
    await ownerPage.goto('/onboarding')
    await ownerPage.getByLabel('Organization name').fill(`Phase1 Org ${suffix}`)
    await ownerPage.getByLabel('Organization slug').fill(organizationSlug)
    await ownerPage.getByLabel('Brand name').fill(`Phase1 Brand ${suffix}`)
    await ownerPage.getByLabel('Brand slug').fill(brandSlug)
    await ownerPage.getByLabel('Website').fill(`https://${brandSlug}.example`)
    await ownerPage
      .getByLabel('First goal')
      .fill(`Phase1 active goal ${suffix}`)
    await ownerPage
      .getByRole('button', { name: 'Create brand and continue' })
      .click()
    await expect(ownerPage).toHaveURL(BRAND_CONTEXT_URL_PATTERN)
    const brandId = readPathIdentifier({
      position: 1,
      url: ownerPage.url(),
    })

    const brandRow = await databasePool.query<
      QueryResultRow & {
        readonly actorId: string
        readonly organizationId: string
      }
    >(
      `SELECT
         brands.organization_id AS "organizationId",
         intents.author_actor_id AS "actorId"
       FROM brands
       INNER JOIN intents ON intents.brand_id = brands.id
       WHERE brands.id = $1
       ORDER BY intents.created_at ASC
       LIMIT 1`,
      [brandId]
    )
    const [brandFacts] = brandRow.rows
    if (brandFacts === undefined) {
      throw new Error('Phase 1 onboarding did not persist a brand actor')
    }
    registry.organizationIds.add(brandFacts.organizationId)

    await databasePool.query(
      `INSERT INTO member (id, organization_id, user_id, role)
       VALUES ($1, $2, $3, 'member'), ($4, $2, $5, 'viewer')`,
      [
        randomUUID(),
        brandFacts.organizationId,
        memberUser.userId,
        randomUUID(),
        viewerUser.userId,
      ]
    )

    const draftId = await insertIntent({
      authorActorId: brandFacts.actorId,
      brandId,
      statement: draftStatement,
      status: 'draft',
    })
    const settledId = await insertIntent({
      authorActorId: brandFacts.actorId,
      brandId,
      statement: settledStatement,
      status: 'settled',
    })
    const abandonedId = await insertIntent({
      authorActorId: brandFacts.actorId,
      brandId,
      statement: abandonedStatement,
      status: 'abandoned',
    })

    await ownerPage.goto(`/brands/${brandId}/intent`)
    await expect(
      ownerPage.getByRole('link', { name: draftStatement })
    ).toHaveCount(0)
    await expect(
      ownerPage.getByRole('link', { name: settledStatement })
    ).toBeVisible()
    await expect(
      ownerPage.getByRole('link', { name: abandonedStatement })
    ).toBeVisible()

    await ownerPage.goto(`/brands/${brandId}/intent/proposals`)
    await expect(
      ownerPage.getByRole('link', { name: draftStatement })
    ).toBeVisible()
    await expect(
      ownerPage.getByRole('link', { name: settledStatement })
    ).toHaveCount(0)

    await ownerPage.goto(`/brands/${brandId}/intent/${draftId}`)
    await expect(
      ownerPage.getByRole('heading', {
        name: PRIVATE_ROUTE_BOUNDARY_PATTERN,
      })
    ).toBeVisible()
    await expect(ownerPage.getByText('Save revision')).toHaveCount(0)

    const viewerPage = await viewerUser.context.newPage()
    await viewerPage.goto(`/brands/${brandId}/intent/proposals/${draftId}`)
    await expect(
      viewerPage.getByRole('heading', { name: draftStatement })
    ).toBeVisible()
    await expect(viewerPage.getByRole('button', { name: 'Adopt' })).toHaveCount(
      0
    )
    await expect(
      viewerPage.getByRole('button', { name: 'Abandon' })
    ).toHaveCount(0)

    const memberPage = await memberUser.context.newPage()
    const memberAdoptPage = await memberUser.context.newPage()
    await memberPage.goto(`/brands/${brandId}/intent/proposals/${draftId}`)
    await memberAdoptPage.goto(`/brands/${brandId}/intent/proposals/${draftId}`)
    await Promise.all([
      memberPage.getByRole('button', { name: 'Adopt' }).click(),
      memberAdoptPage.getByRole('button', { name: 'Adopt' }).click(),
    ])
    const adopted = await databasePool.query<
      QueryResultRow & {
        readonly actionCount: number
        readonly status: string
      }
    >(
      `SELECT
         intents.status,
         (
           SELECT count(*)::int
           FROM actions
           WHERE actions.intent_id = intents.id
             AND actions.type = 'intent_adopted'
         ) AS "actionCount"
       FROM intents
       WHERE intents.id = $1`,
      [draftId]
    )
    expect(adopted.rows[0]).toMatchObject({
      actionCount: 1,
      status: 'active',
    })

    await ownerPage.goto(`/brands/${brandId}/intent`)
    await expect(
      ownerPage.getByRole('link', { name: draftStatement })
    ).toBeVisible()
    await ownerPage.goto(`/brands/${brandId}/intent/proposals`)
    await expect(
      ownerPage.getByRole('link', { name: draftStatement })
    ).toHaveCount(0)

    await memberPage.goto(`/brands/${brandId}/intent/${settledId}`)
    await expect(memberPage.getByText('Save revision')).toHaveCount(0)
    await memberPage.goto(`/brands/${brandId}/intent/${abandonedId}`)
    await expect(
      memberPage.getByRole('button', { name: 'Abandon' })
    ).toHaveCount(0)

    const contentTaskId = await insertGenericTask({
      brandId,
      kind: 'content.brief.v1',
      status: 'succeeded',
      workerKey: 'content',
    })
    const distributionTaskId = await insertGenericTask({
      brandId,
      kind: 'distribution.channel-plan.v1',
      status: 'failed',
      workerKey: 'distribution',
    })
    const seoTaskId = await insertGenericTask({
      brandId,
      kind: 'seo-discovery.opportunity.v1',
      status: 'cancelled',
      workerKey: 'seo-discovery',
    })
    const notion = await insertNotionCommitment({
      actorId: brandFacts.actorId,
      brandId,
      title: notionTitle,
    })
    const dismissible = await insertNotionCommitment({
      actorId: brandFacts.actorId,
      brandId,
      title: `Dismiss ${suffix}`,
    })

    await ownerPage.goto(`/brands/${brandId}/connections`)
    await expect(
      ownerPage.getByRole('heading', { name: 'Notion' })
    ).toBeVisible()
    await expect(
      ownerPage.getByRole('heading', { name: 'Typefully' })
    ).toBeVisible()
    await expect(
      ownerPage.getByText('no active Notion connection')
    ).toBeVisible()
    await expect(ownerPage.getByText(TOKEN_WORD_PATTERN)).toHaveCount(0)
    await ownerPage
      .locator('article')
      .filter({ hasText: 'Notion' })
      .getByLabel('Account label')
      .fill('Acme Notion workspace')
    await ownerPage
      .locator('article')
      .filter({ hasText: 'Notion' })
      .getByLabel('Connector')
      .fill('notion/branderize-e2e')
    await ownerPage
      .locator('article')
      .filter({ hasText: 'Notion' })
      .getByLabel('Scopes')
      .fill('read\nwrite')
    await ownerPage
      .locator('article')
      .filter({ hasText: 'Notion' })
      .getByRole('button', { name: 'Connect Notion' })
      .click()
    await expect(ownerPage.getByText('Acme Notion workspace')).toBeVisible()
    await expect(ownerPage.getByText('Scopes: read, write')).toBeVisible()
    const connectionBody = await ownerPage.locator('main').innerText()
    expect(connectionBody).not.toMatch(TOKEN_LIKE_PATTERN)

    await ownerPage.goto(`/brands/${brandId}/approvals`)
    await expect(ownerPage.getByText(notionTitle)).toBeVisible()
    await expect(
      ownerPage.getByRole('button', { name: 'Approve Notion page-create' })
    ).toHaveCount(1)
    await expect(
      ownerPage.getByRole('button', { name: 'Approve all' })
    ).toHaveCount(0)
    await ownerPage
      .locator('article')
      .filter({ hasText: notionTitle })
      .getByRole('button', { name: 'Approve Notion page-create' })
      .click()
    await expect(ownerPage.getByText('Commitment approved.')).toBeVisible()

    const signedCron = async (): Promise<void> => {
      const dispatchResult = await ownerPage.evaluate(async (secret) => {
        const response = await fetch('/api/internal/cron/dispatch', {
          headers: { authorization: `Bearer ${secret}` },
        })
        return {
          body: await response.json(),
          status: response.status,
        }
      }, cronSecret)
      expect(dispatchResult).toEqual({
        body: { accepted: 7, attempted: 7, status: 'ok' },
        status: 200,
      })
    }
    await expect
      .poll(
        async () => {
          await signedCron()
          const result = await databasePool.query<
            QueryResultRow & {
              readonly approvalType: string | null
              readonly resultType: string | null
              readonly status: string
            }
          >(
            `SELECT
               tasks.status,
               approval.type AS "approvalType",
               result_action.type AS "resultType"
             FROM tasks
             LEFT JOIN actions approval
               ON approval.id = tasks.approval_action_id
             LEFT JOIN actions result_action
               ON result_action.id = tasks.result_action_id
             WHERE tasks.id = $1`,
            [notion.taskId]
          )
          return result.rows[0] ?? null
        },
        { timeout: 60_000 }
      )
      .toMatchObject({
        approvalType: 'commitment_approved',
        resultType: 'commitment_result',
        status: 'succeeded',
      })

    await ownerPage.goto(`/brands/${brandId}/work/${notion.taskId}`)
    await expect(ownerPage.getByText('Approval')).toBeVisible()
    await expect(ownerPage.getByText('commitment approved')).toBeVisible()
    await expect(ownerPage.getByText('Result')).toBeVisible()
    await expect(ownerPage.getByText('commitment result')).toBeVisible()

    await ownerPage.goto(`/brands/${brandId}/approvals`)
    await ownerPage
      .locator('article')
      .filter({ hasText: `Dismiss ${suffix}` })
      .getByRole('button', { name: 'Dismiss' })
      .click()
    await expect(ownerPage.getByText('Commitment dismissed.')).toBeVisible()
    const dismissPayload = {
      reportObjectId: dismissible.reportObjectId,
      title: `Dismiss ${suffix}`,
    }
    const dismissHash = requestHash(dismissPayload)
    expect(
      await latestDismissalFact({
        brandId,
        payloadHash: dismissHash,
      })
    ).toBe('commitment_dismissed')

    const dismissedStatus = await databasePool.query<
      QueryResultRow & { readonly status: string }
    >('SELECT status FROM tasks WHERE id = $1', [dismissible.taskId])
    expect(dismissedStatus.rows[0]?.status).toBe('dismissed')

    await ownerPage.goto(`/brands/${brandId}/work/${dismissible.taskId}`)
    await expect(
      ownerPage.getByRole('heading', { name: 'dismissed' })
    ).toBeVisible()
    await ownerPage.getByRole('button', { name: 'Reopen' }).click()
    await expect(ownerPage.getByText('Commitment reopened.')).toBeVisible()
    expect(
      await latestDismissalFact({
        brandId,
        payloadHash: dismissHash,
      })
    ).toBe('commitment_reopened')

    await ownerPage.goto(`/brands/${brandId}/work`)
    await expect(ownerPage.getByText('Content · succeeded')).toBeVisible()
    await expect(ownerPage.getByText('Distribution · failed')).toBeVisible()
    await expect(ownerPage.getByText('SEO · cancelled')).toBeVisible()
    await expect(ownerPage.getByText('Notion page · succeeded')).toBeVisible()
    await expect(
      ownerPage.getByRole('link').filter({ hasText: contentTaskId.slice(0, 8) })
    ).toBeVisible()
    await expect(
      ownerPage
        .getByRole('link')
        .filter({ hasText: distributionTaskId.slice(0, 8) })
    ).toBeVisible()
    await expect(
      ownerPage.getByRole('link').filter({ hasText: seoTaskId.slice(0, 8) })
    ).toBeVisible()

    await signedCron()
  } finally {
    try {
      await Promise.all(contextsToClose.map(async (context) => context.close()))
    } finally {
      await cleanTestData(registry)
    }
  }
})
