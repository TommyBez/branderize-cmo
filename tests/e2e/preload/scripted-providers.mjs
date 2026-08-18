import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { createRequire, register, syncBuiltinESMExports } from 'node:module'
import { basename, dirname, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { createScriptedInferenceProvider } from './scripted-inference.mjs'

const SCRIPTED_PROVIDER_MODE = 'scripted'
const PINNED_EVE_VERSION = '0.31.3'
const BLOB_API_ORIGIN = 'https://vercel.com'
const BLOB_API_PATH_PREFIX = '/api/blob/'
const BLOB_STORE_ID = 'e2estore'
const BLOB_STORE_ORIGIN = `https://${BLOB_STORE_ID}.private.blob.vercel-storage.com`
const CONTEXT_DEV_ORIGIN = 'https://api.context.dev'
const SCRIPTED_ASSET_URL = 'https://example.com/branderize-e2e/phase0-logo.svg'
const SCRIPTED_ASSET_ADDRESS = '93.184.216.34'
const SCRIPTED_ASSET_HOSTNAME = 'example.com'
const LOOPBACK_HOST_PATTERN = /^(?:127\.0\.0\.1|localhost)(?::\d+)?$/u
const SAFE_BLOB_PATH_PATTERN =
  /^brands\/[0-9a-f-]+\/artifacts\/sha256\/[0-9a-f]{64}\.[a-z0-9]+$/u
const HEALTH_ONLY_ROOT_AGENT_BY_DIRECTORY = new Map([
  ['agent-content', 'content'],
  ['agent-distribution', 'distribution'],
  ['agent-growth', 'growth'],
  ['agent-lifecycle', 'lifecycle'],
  ['agent-seo-discovery', 'seo-discovery'],
])
const EVE_ROOT_DIRECTORIES = new Set([
  'agent-cmo',
  'agent-product-marketer',
  ...HEALTH_ONLY_ROOT_AGENT_BY_DIRECTORY.keys(),
])

const scriptedAsset = Buffer.from(
  [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 40">',
    '<title>Branderize scripted E2E asset</title>',
    '<rect width="160" height="40" fill="#18181b"/>',
    '<path d="M16 10h18v20H16z" fill="#f4f4f5"/>',
    '</svg>',
  ].join(''),
  'utf8'
)

if (process.env.E2E_PROVIDER_MODE !== SCRIPTED_PROVIDER_MODE) {
  throw new Error(
    'The scripted provider preload is restricted to the E2E runner process'
  )
}

const providerStateDirectoryValue = process.env.E2E_PROVIDER_STATE_DIRECTORY
if (
  providerStateDirectoryValue === undefined ||
  providerStateDirectoryValue.length === 0
) {
  throw new Error('E2E_PROVIDER_STATE_DIRECTORY is required by the preload')
}
mkdirSync(providerStateDirectoryValue, { recursive: true })
const providerStateDirectory = realpathSync(providerStateDirectoryValue)
const processDirectoryName = basename(process.cwd())
const expectedRuntimeRoot = resolve(
  providerStateDirectory,
  'runtime-roots',
  processDirectoryName
)
const expectedPreflightRoot = resolve(
  providerStateDirectory,
  'preflight-roots',
  processDirectoryName
)
const processDirectory = resolve(process.cwd())
const isKnownEveRootDirectory = EVE_ROOT_DIRECTORIES.has(processDirectoryName)
const isEveRuntimeRoot =
  isKnownEveRootDirectory && processDirectory === expectedRuntimeRoot
const isEvePreflightRoot =
  isKnownEveRootDirectory && processDirectory === expectedPreflightRoot
const isEveRootProcess = isEveRuntimeRoot || isEvePreflightRoot
if (isKnownEveRootDirectory && !isEveRootProcess) {
  throw new Error(
    `The E2E Eve root must run from its temporary preflight or runtime root: ${expectedPreflightRoot} or ${expectedRuntimeRoot}`
  )
}
const expectedWorkflowStore = isEveRootProcess
  ? resolve(processDirectory, '.eve/.workflow-data')
  : resolve(providerStateDirectory, `workflow-${processDirectoryName}`)
if (isEveRootProcess) {
  process.env.WORKFLOW_LOCAL_DATA_DIR = expectedWorkflowStore
}

const evePackageUrl = new URL(
  '../../../apps/agent-cmo/node_modules/eve/package.json',
  import.meta.url
)
const evePackage = JSON.parse(readFileSync(evePackageUrl, 'utf8'))
if (evePackage.version !== PINNED_EVE_VERSION) {
  throw new Error(
    `The E2E Workflow fixture requires eve ${PINNED_EVE_VERSION}, received ${String(evePackage.version)}`
  )
}
const eveLocalStoreModuleUrl = pathToFileURL(
  realpathSync(
    fileURLToPath(
      new URL(
        '../../../apps/agent-cmo/node_modules/eve/dist/src/internal/workflow/local-world-data-directory.js',
        import.meta.url
      )
    )
  )
).toString()
register('./isolated-workflow-store-loader.mjs', import.meta.url, {
  data: {
    expectedLocalStoreModuleUrl: eveLocalStoreModuleUrl,
    workflowStoreDirectory: expectedWorkflowStore,
  },
})
const eveLocalStoreModule = await import(eveLocalStoreModuleUrl)
if (
  eveLocalStoreModule.resolveLocalWorkflowWorldDataDirectory(process.cwd()) !==
  expectedWorkflowStore
) {
  throw new Error('The E2E Workflow store isolation hook was not installed')
}

const preloadPath = fileURLToPath(import.meta.url)
const preloadArgument = `--import=${preloadPath}`
const existingNodeOptions = process.env.NODE_OPTIONS?.trim() ?? ''
if (!existingNodeOptions.includes(preloadArgument)) {
  process.env.NODE_OPTIONS = [existingNodeOptions, preloadArgument]
    .filter((value) => value.length > 0)
    .join(' ')
}

process.env.VERCEL_BLOB_RETRIES = '0'

const requireFromPreload = createRequire(import.meta.url)
const dnsPromises = requireFromPreload('node:dns/promises')
const https = requireFromPreload('node:https')
const originalDnsLookup = dnsPromises.lookup.bind(dnsPromises)
const originalHttpsRequest = https.request.bind(https)

dnsPromises.lookup = async (hostname, options) => {
  if (hostname !== SCRIPTED_ASSET_HOSTNAME) {
    return await originalDnsLookup(hostname, options)
  }
  const address = { address: SCRIPTED_ASSET_ADDRESS, family: 4 }
  return options?.all === true ? [address] : address
}

https.request = (input, options, callback) => {
  const url =
    input instanceof URL || typeof input === 'string' ? new URL(input) : null
  if (url?.toString() !== SCRIPTED_ASSET_URL) {
    return originalHttpsRequest(input, options, callback)
  }
  if (
    options === undefined ||
    typeof options === 'function' ||
    typeof callback !== 'function' ||
    options.agent !== false ||
    (options.family !== 4 && options.family !== 6) ||
    typeof options.lookup !== 'function' ||
    options.method !== 'GET'
  ) {
    throw new Error('The E2E pinned asset transport contract changed')
  }

  const request = new EventEmitter()
  let ended = false
  request.end = () => {
    if (ended) {
      return request
    }
    ended = true
    queueMicrotask(() => {
      options.lookup(
        SCRIPTED_ASSET_HOSTNAME,
        { all: true },
        (error, addresses) => {
          if (error !== null) {
            request.emit('error', error)
            return
          }
          const [pinnedAddress] = Array.isArray(addresses) ? addresses : []
          if (
            pinnedAddress?.address !== SCRIPTED_ASSET_ADDRESS ||
            pinnedAddress.family !== 4
          ) {
            request.emit(
              'error',
              new Error('The E2E asset request was not pinned by production')
            )
            return
          }

          const response = Readable.from([scriptedAsset])
          response.rawHeaders = [
            'content-length',
            String(scriptedAsset.byteLength),
            'content-type',
            'image/svg+xml',
          ]
          response.statusCode = 200
          response.statusMessage = 'OK'
          callback(response)
        }
      )
    })
    return request
  }
  return request
}

syncBuiltinESMExports()

const appPackagePath = fileURLToPath(
  new URL('../../../apps/app/package.json', import.meta.url)
)
const requireFromApp = createRequire(appPackagePath)
const blobEntryPath = requireFromApp.resolve('@vercel/blob')
const requireFromBlob = createRequire(blobEntryPath)
const { MockAgent, setGlobalDispatcher } = requireFromBlob('undici')

const mockAgent = new MockAgent()
const shouldInstallBlobDispatcher =
  resolve(process.cwd()) === dirname(appPackagePath)
if (shouldInstallBlobDispatcher) {
  mockAgent.disableNetConnect()
  mockAgent.enableNetConnect((host) => LOOPBACK_HOST_PATTERN.test(host))
  setGlobalDispatcher(mockAgent)
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex')

const blobPaths = (pathname) => {
  const identity = sha256(pathname)
  return {
    body: resolve(providerStateDirectory, `${identity}.blob`),
    metadata: resolve(providerStateDirectory, `${identity}.json`),
  }
}

const readHeader = (headers, name) => {
  if (headers === undefined) {
    return null
  }
  if (Array.isArray(headers)) {
    for (let index = 0; index < headers.length; index += 2) {
      const key = headers[index]
      if (typeof key === 'string' && key.toLowerCase() === name.toLowerCase()) {
        const value = headers[index + 1]
        return typeof value === 'string' ? value : null
      }
    }
    return null
  }
  if (typeof headers.get === 'function') {
    return headers.get(name)
  }
  const entry = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === name.toLowerCase()
  )
  const value = entry?.[1]
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

const bytesFromBody = (body) => {
  if (typeof body === 'string') {
    return Buffer.from(body)
  }
  if (body instanceof ArrayBuffer) {
    return Buffer.from(body)
  }
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength)
  }
  throw new Error('The E2E Blob provider received an unsupported upload body')
}

const parseBlobPathname = (path) => {
  const pathname = new URL(path, BLOB_API_ORIGIN).searchParams.get('pathname')
  if (pathname === null || !SAFE_BLOB_PATH_PATTERN.test(pathname)) {
    throw new Error('The E2E Blob provider received a non-canonical pathname')
  }
  return pathname
}

const readStoredBlob = (pathname) => {
  const paths = blobPaths(pathname)
  if (!(existsSync(paths.body) && existsSync(paths.metadata))) {
    return null
  }
  return {
    body: readFileSync(paths.body),
    metadata: JSON.parse(readFileSync(paths.metadata, 'utf8')),
  }
}

mockAgent
  .get(BLOB_API_ORIGIN)
  .intercept({
    method: 'PUT',
    path: (path) => path.startsWith(BLOB_API_PATH_PREFIX),
  })
  .reply(({ body, headers, path }) => {
    const pathname = parseBlobPathname(path)
    const bytes = bytesFromBody(body)
    const contentType = readHeader(headers, 'x-content-type')
    if (
      readHeader(headers, 'x-vercel-blob-access') !== 'private' ||
      readHeader(headers, 'x-add-random-suffix') !== '0' ||
      readHeader(headers, 'x-allow-overwrite') !== '1' ||
      typeof contentType !== 'string'
    ) {
      throw new Error('The E2E Blob upload contract changed')
    }

    const etag = `"${sha256(bytes)}"`
    const paths = blobPaths(pathname)
    writeFileSync(paths.body, bytes)
    writeFileSync(
      paths.metadata,
      JSON.stringify({ contentType, etag, pathname })
    )
    const url = `${BLOB_STORE_ORIGIN}/${pathname}`
    return {
      data: {
        contentDisposition: 'inline',
        contentType,
        downloadUrl: `${url}?download=1`,
        etag,
        pathname,
        url,
      },
      responseOptions: {
        headers: { 'content-type': 'application/json' },
      },
      statusCode: 200,
    }
  })
  .persist()

mockAgent
  .get(BLOB_STORE_ORIGIN)
  .intercept({ method: 'GET', path: /^\/brands\//u })
  .reply(({ headers, path }) => {
    const url = new URL(path, BLOB_STORE_ORIGIN)
    const pathname = decodeURIComponent(url.pathname.slice(1))
    if (!SAFE_BLOB_PATH_PATTERN.test(pathname)) {
      throw new Error('The E2E Blob read contract changed')
    }
    const stored = readStoredBlob(pathname)
    if (stored === null) {
      return { statusCode: 404 }
    }
    const responseHeaders = {
      'cache-control': 'private, no-cache',
      'content-length': String(stored.body.byteLength),
      'content-type': stored.metadata.contentType,
      etag: stored.metadata.etag,
      'last-modified': 'Thu, 01 Jan 2026 00:00:00 GMT',
    }
    if (readHeader(headers, 'if-none-match') === stored.metadata.etag) {
      return {
        responseOptions: { headers: responseHeaders },
        statusCode: 304,
      }
    }
    return {
      data: stored.body,
      responseOptions: { headers: responseHeaders },
      statusCode: 200,
    }
  })
  .persist()

const originalFetch = globalThis.fetch.bind(globalThis)
const scriptedInference = createScriptedInferenceProvider({
  providerStateDirectory,
  rootAgent:
    HEALTH_ONLY_ROOT_AGENT_BY_DIRECTORY.get(basename(process.cwd())) ?? null,
})

const requestUrl = (input) => {
  if (typeof input === 'string' || input instanceof URL) {
    return new URL(input)
  }
  return new URL(input.url)
}

const requestMethod = (input, init) =>
  (
    init?.method ??
    (typeof input === 'string' || input instanceof URL ? 'GET' : input.method)
  ).toUpperCase()

const requestHeaders = (input, init) =>
  new Headers(
    init?.headers ??
      (typeof input === 'string' || input instanceof URL
        ? undefined
        : input.headers)
  )

const requestBody = async (input, init) => {
  if (typeof init?.body === 'string') {
    return init.body
  }
  if (typeof input === 'string' || input instanceof URL) {
    return null
  }
  return await input.clone().text()
}

const parseJsonRequest = async (input, init) => {
  const body = await requestBody(input, init)
  if (body === null || body.length === 0) {
    throw new Error('The scripted Context.dev provider expected JSON input')
  }
  return JSON.parse(body)
}

const contextDevResponse = async (url, input, init) => {
  const expectedApiKey = process.env.CONTEXT_DEV_API_KEY
  if (
    expectedApiKey === undefined ||
    requestHeaders(input, init).get('authorization') !==
      `Bearer ${expectedApiKey}`
  ) {
    throw new Error('The scripted Context.dev authorization contract changed')
  }

  const method = requestMethod(input, init)
  if (url.pathname === '/v1/brand/retrieve' && method === 'POST') {
    const request = await parseJsonRequest(input, init)
    return Response.json({
      brand: {
        backdrops: [],
        colors: [
          { hex: '#18181b', name: 'Ink' },
          { hex: '#f4f4f5', name: 'Paper' },
        ],
        description: 'A deterministic Phase 0 brand fixture.',
        domain: request.domain,
        logos: [
          {
            resolution: { aspect_ratio: 4, height: 40, width: 160 },
            url: SCRIPTED_ASSET_URL,
          },
        ],
        slogan: 'Evidence before claims',
        title: 'Branderize Phase 0 Fixture',
      },
      code: 200,
      key_metadata: { credits_consumed: 1, credits_remaining: 99 },
      status: 'ok',
    })
  }

  if (url.pathname === '/v1/web/styleguide' && method === 'GET') {
    return Response.json({
      code: 200,
      domain: url.searchParams.get('domain'),
      key_metadata: { credits_consumed: 1, credits_remaining: 98 },
      status: 'ok',
      styleguide: {
        colors: {
          accent: '#18181b',
          background: '#f4f4f5',
          text: '#18181b',
        },
        typography: {
          headings: {
            h1: {
              fontFamily: 'Geist',
              fontSize: '48px',
              fontWeight: 700,
              lineHeight: '1.1',
            },
          },
          p: {
            fontFamily: 'Geist',
            fontSize: '16px',
            fontWeight: 400,
            lineHeight: '1.5',
          },
        },
      },
    })
  }

  if (url.pathname === '/v1/web/crawl' && method === 'POST') {
    const request = await parseJsonRequest(input, init)
    return Response.json({
      metadata: {
        maxCrawlDepth: 0,
        numFailed: 0,
        numSkipped: 0,
        numSucceeded: 1,
        numUrls: 1,
      },
      results: [
        {
          markdown: '# Branderize Phase 0 Fixture\n\nEvidence before claims.',
          metadata: {
            crawlDepth: 0,
            statusCode: 200,
            success: true,
            title: 'Branderize Phase 0 Fixture',
            url: request.url,
          },
        },
      ],
    })
  }

  return new Response(null, { status: 404 })
}

globalThis.fetch = async (input, init) => {
  const url = requestUrl(input)
  const inferenceResponse = await scriptedInference({ init, input, url })
  if (inferenceResponse !== null) {
    return inferenceResponse
  }
  if (url.origin === CONTEXT_DEV_ORIGIN) {
    return await contextDevResponse(url, input, init)
  }
  if (url.toString() === SCRIPTED_ASSET_URL) {
    return new Response(scriptedAsset, {
      headers: {
        'content-length': String(scriptedAsset.byteLength),
        'content-type': 'image/svg+xml',
      },
      status: 200,
    })
  }
  return await originalFetch(input, init)
}
