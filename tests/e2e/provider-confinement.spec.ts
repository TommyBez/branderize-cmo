import { execFile } from 'node:child_process'
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'
import {
  createScriptedInferenceProvider,
  ROOT_SMOKE_PROMPT,
} from './preload/scripted-inference.mjs'

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../..')
const SOURCE_ROOTS = ['apps', 'packages'] as const
const ROOT_CONTRACT_FILES = [
  'compose.yaml',
  'package.json',
  'pnpm-workspace.yaml',
  'turbo.json',
  'vercel.json',
] as const
const SKIPPED_DIRECTORIES = new Set([
  '.eve',
  '.next',
  '.output',
  'coverage',
  'dist',
  'node_modules',
  'test-results',
])
const TEXT_EXTENSIONS = new Set([
  '.cjs',
  '.js',
  '.json',
  '.jsonc',
  '.md',
  '.mjs',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
])
const FORBIDDEN_E2E_REFERENCES = [
  'E2E_PROVIDER_MODE',
  'E2E_PROVIDER_STATE_DIRECTORY',
  'WORKFLOW_LOCAL_DATA_DIR',
  'branderize-e2e-scripted-gateway-key',
  'isolated-workflow-store-loader.mjs',
  'scripted-inference.mjs',
  'scripted-providers.mjs',
  'https://snapshot-font.invalid/geist-regular.ttf',
  ROOT_SMOKE_PROMPT,
] as const
const GATEWAY_LANGUAGE_MODEL_URL =
  'https://ai-gateway.vercel.sh/v4/ai/language-model'
const TEST_GATEWAY_KEY = 'scripted-inference-contract-key'
const TEST_BRAND_ID = '00000000-0000-4000-8000-000000000001'
const SCRIPTED_GENERATION_ID_PATTERN = /^generation_e2e_/u
const SCRIPTED_PROVIDER_PRELOAD_PATH = resolve(
  REPOSITORY_ROOT,
  'tests/e2e/preload/scripted-providers.mjs'
)
const execFileAsync = promisify(execFile)

const gatewayRequest = ({
  prompt,
  tags,
  user = TEST_BRAND_ID,
}: {
  prompt: unknown[]
  tags: string[]
  user?: string | null
}) => ({
  init: {
    body: JSON.stringify({
      prompt,
      providerOptions: {
        gateway: { tags, ...(user === null ? {} : { user }) },
      },
    }),
    headers: {
      'ai-language-model-id': 'deepseek/deepseek-v4-pro-0813',
      'ai-language-model-specification-version': '4',
      'ai-language-model-streaming': 'true',
      authorization: `Bearer ${TEST_GATEWAY_KEY}`,
      'content-type': 'application/json',
    },
    method: 'POST',
  },
  input: GATEWAY_LANGUAGE_MODEL_URL,
  url: new URL(GATEWAY_LANGUAGE_MODEL_URL),
})

const readEventStream = async (response: Response): Promise<unknown[]> =>
  (await response.text())
    .split('\n')
    .filter((line) => line.startsWith('data: ') && line !== 'data: [DONE]')
    .map((line) => JSON.parse(line.slice('data: '.length)))

const collectSourceFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true })
  const nestedFiles = await Promise.all(
    entries
      .filter(
        (entry) => entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name)
      )
      .map(async (entry) => collectSourceFiles(resolve(directory, entry.name)))
  )
  const localFiles = entries
    .filter(
      (entry) => entry.isFile() && TEXT_EXTENSIONS.has(extname(entry.name))
    )
    .map((entry) => resolve(directory, entry.name))
  return [...localFiles, ...nestedFiles.flat()]
}

test('scripted providers remain outside production and deployment contracts', async () => {
  const sourceFiles = (
    await Promise.all(
      SOURCE_ROOTS.map(async (root) =>
        collectSourceFiles(resolve(REPOSITORY_ROOT, root))
      )
    )
  ).flat()
  const contractFiles = (
    await Promise.all(
      ROOT_CONTRACT_FILES.map(async (path) => {
        const absolutePath = resolve(REPOSITORY_ROOT, path)
        try {
          await readFile(absolutePath, 'utf8')
          return absolutePath
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return null
          }
          throw error
        }
      })
    )
  ).filter((path): path is string => path !== null)

  const leaks = (
    await Promise.all(
      [...sourceFiles, ...contractFiles].map(async (path) => {
        const source = await readFile(path, 'utf8')
        return FORBIDDEN_E2E_REFERENCES.filter((reference) =>
          source.includes(reference)
        ).map((reference) => `${path}: ${reference}`)
      })
    )
  ).flat()
  expect(leaks).toEqual([])
})

test('the preload isolates Eve Workflow state without changing the Next process', async () => {
  const stateDirectory = await realpath(
    await mkdtemp(join(tmpdir(), 'workflow-store-contract-'))
  )
  const temporaryCmoRoot = resolve(stateDirectory, 'runtime-roots', 'agent-cmo')
  const temporaryContentPreflightRoot = resolve(
    stateDirectory,
    'preflight-roots',
    'agent-content'
  )
  await mkdir(temporaryCmoRoot, { recursive: true })
  await mkdir(temporaryContentPreflightRoot, { recursive: true })
  const inheritedEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[0] !== 'NODE_OPTIONS' &&
        entry[0] !== 'WORKFLOW_LOCAL_DATA_DIR' &&
        entry[1] !== undefined
    )
  )
  const readWorkflowStore = async (cwd: string): Promise<string> => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        `--import=${SCRIPTED_PROVIDER_PRELOAD_PATH}`,
        '--eval',
        "process.stdout.write(process.env.WORKFLOW_LOCAL_DATA_DIR ?? 'unset')",
      ],
      {
        cwd,
        env: {
          ...inheritedEnvironment,
          E2E_PROVIDER_MODE: 'scripted',
          E2E_PROVIDER_STATE_DIRECTORY: stateDirectory,
        },
      }
    )
    return stdout
  }

  try {
    await expect(
      readWorkflowStore(resolve(REPOSITORY_ROOT, 'apps/agent-cmo'))
    ).rejects.toThrow('temporary preflight or runtime root')
    await expect(readWorkflowStore(temporaryCmoRoot)).resolves.toBe(
      resolve(temporaryCmoRoot, '.eve/.workflow-data')
    )
    await expect(
      readWorkflowStore(temporaryContentPreflightRoot)
    ).resolves.toBe(
      resolve(temporaryContentPreflightRoot, '.eve/.workflow-data')
    )
    await expect(
      readWorkflowStore(resolve(REPOSITORY_ROOT, 'apps/app'))
    ).resolves.toBe('unset')
  } finally {
    await rm(stateDirectory, { force: true, recursive: true })
  }
})

test('scripted inference follows the AI SDK Gateway stream contract', async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), 'inference-contract-'))
  const previousGatewayKey = process.env.AI_GATEWAY_API_KEY
  process.env.AI_GATEWAY_API_KEY = TEST_GATEWAY_KEY
  try {
    const provider = createScriptedInferenceProvider({
      providerStateDirectory: stateDirectory,
      rootAgent: 'content',
    })
    const userMessage = {
      content: [
        {
          text: 'Use the single active Intent. Call request_specialist_work now.',
          type: 'text',
        },
      ],
      role: 'user',
    }
    const firstResponse = await provider(
      gatewayRequest({
        prompt: [userMessage],
        tags: ['agent:cmo', 'env:test', 'feature:conversation', 'lane:cmo'],
      })
    )
    if (firstResponse === null) {
      throw new Error('The exact Gateway endpoint was not intercepted')
    }
    expect(await readEventStream(firstResponse)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          input: '{}',
          toolName: 'request_specialist_work',
          type: 'tool-call',
        }),
        expect.objectContaining({
          finishReason: expect.objectContaining({ unified: 'tool-calls' }),
          providerMetadata: expect.objectContaining({
            gateway: expect.objectContaining({
              cost: '0.000004',
              generationId: expect.stringMatching(
                SCRIPTED_GENERATION_ID_PATTERN
              ),
            }),
          }),
          type: 'finish',
        }),
      ])
    )

    const secondResponse = await provider(
      gatewayRequest({
        prompt: [
          userMessage,
          {
            content: [
              {
                input: {},
                toolCallId: 'call_fixture',
                toolName: 'request_specialist_work',
                type: 'tool-call',
              },
            ],
            role: 'assistant',
          },
          {
            content: [
              {
                output: {
                  type: 'json',
                  value: { disposition: 'created', taskId: TEST_BRAND_ID },
                },
                toolCallId: 'call_fixture',
                toolName: 'request_specialist_work',
                type: 'tool-result',
              },
            ],
            role: 'tool',
          },
        ],
        tags: ['agent:cmo', 'env:test', 'feature:conversation', 'lane:cmo'],
      })
    )
    if (secondResponse === null) {
      throw new Error('The follow-up Gateway call was not intercepted')
    }
    expect(await readEventStream(secondResponse)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          delta: 'Product Marketer work was requested from the trusted Intent.',
          type: 'text-delta',
        }),
        expect.objectContaining({
          finishReason: expect.objectContaining({ unified: 'stop' }),
          type: 'finish',
        }),
      ])
    )

    const smokeResponse = await provider(
      gatewayRequest({
        prompt: [
          {
            content: [{ text: ROOT_SMOKE_PROMPT, type: 'text' }],
            role: 'user',
          },
        ],
        tags: [],
        user: null,
      })
    )
    if (smokeResponse === null) {
      throw new Error('The health-only root smoke was not intercepted')
    }
    expect(await readEventStream(smokeResponse)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          delta:
            'The content Phase 0 root completed its deterministic smoke turn.',
          type: 'text-delta',
        }),
        expect.objectContaining({
          finishReason: expect.objectContaining({ unified: 'stop' }),
          type: 'finish',
        }),
      ])
    )
  } finally {
    if (previousGatewayKey === undefined) {
      delete process.env.AI_GATEWAY_API_KEY
    } else {
      process.env.AI_GATEWAY_API_KEY = previousGatewayKey
    }
    await rm(stateDirectory, { force: true, recursive: true })
  }
})
