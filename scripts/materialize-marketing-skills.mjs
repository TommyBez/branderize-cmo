import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDirectory = fileURLToPath(new URL('..', import.meta.url))
const agentRootNames = new Set([
  'agent-cmo',
  'agent-content',
  'agent-distribution',
  'agent-growth',
  'agent-lifecycle',
  'agent-product-marketer',
  'agent-seo-discovery',
])
const mountSource =
  "import marketingSkills from '@repo/marketing-skills'\n\nexport default marketingSkills()\n"

const resolveAgentRoot = () => {
  const currentDirectory = resolve(process.cwd())
  const currentName = basename(currentDirectory)

  if (agentRootNames.has(currentName)) {
    return currentDirectory
  }

  const [, , requestedName] = process.argv
  if (requestedName && agentRootNames.has(requestedName)) {
    return join(rootDirectory, 'apps', requestedName)
  }

  throw new Error(
    'Run materialize-marketing-skills from a registered agent root or pass its directory name.'
  )
}

const agentRoot = resolveAgentRoot()
const manifest = JSON.parse(
  readFileSync(join(agentRoot, 'package.json'), 'utf8')
)

if (manifest.dependencies?.['@repo/marketing-skills'] !== 'workspace:*') {
  throw new Error(
    `${basename(agentRoot)} must depend on @repo/marketing-skills with workspace:*`
  )
}

const extensionsDirectory = join(agentRoot, 'agent', 'extensions')
const mountPath = join(extensionsDirectory, 'marketing-skills.ts')

mkdirSync(extensionsDirectory, { recursive: true })

let currentSource
try {
  currentSource = readFileSync(mountPath, 'utf8')
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
    throw error
  }
}

if (currentSource !== mountSource) {
  writeFileSync(mountPath, mountSource, 'utf8')
}

process.stdout.write(
  `materialized Phase 0 marketing-skills mount for ${basename(agentRoot)}\n`
)
