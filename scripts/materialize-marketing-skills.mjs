import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
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
const approvedSkillNames = [
  'copywriting',
  'content-strategy',
  'copy-editing',
  'seo-audit',
  'ai-seo',
]
const mountSource =
  "import marketingSkills from '@repo/marketing-skills'\n\nexport default marketingSkills()\n"
const brandFileBeforeQuestions =
  'If `.agents/product-marketing.md` exists (or `.claude/product-marketing.md`, or the legacy `product-marketing-context.md` filename, in older setups), read it before asking questions.'
const brandFileBeforeEditing =
  'If `.agents/product-marketing.md` exists (or `.claude/product-marketing.md`, or the legacy `product-marketing-context.md` filename, in older setups), read it before editing.'
const brandContextBeforeQuestions =
  'Call `get_brand_context` to read the current Brand Context projection from the brain before asking questions.'
const brandContextBeforeEditing =
  'Call `get_brand_context` to read the current Brand Context projection from the brain before editing.'

const rewriteBrandFileReferences = (source) =>
  source
    .replaceAll(brandFileBeforeQuestions, brandContextBeforeQuestions)
    .replaceAll(brandFileBeforeEditing, brandContextBeforeEditing)

const writeIfChanged = (path, source) => {
  let currentSource
  try {
    currentSource = readFileSync(path, 'utf8')
  } catch (error) {
    if (
      !(error instanceof Error && 'code' in error && error.code === 'ENOENT')
    ) {
      throw error
    }
  }
  if (currentSource !== source) {
    writeFileSync(path, source, 'utf8')
  }
}

const materializeApprovedSkills = () => {
  const sourceRoot = join(rootDirectory, '.agents', 'skills')
  const destinationRoot = join(
    rootDirectory,
    'packages',
    'marketing-skills',
    'extension',
    'skills'
  )
  rmSync(destinationRoot, { force: true, recursive: true })
  mkdirSync(destinationRoot, { recursive: true })

  for (const skillName of approvedSkillNames) {
    const sourceDirectory = join(sourceRoot, skillName)
    const destinationDirectory = join(destinationRoot, skillName)
    const skillSource = readFileSync(join(sourceDirectory, 'SKILL.md'), 'utf8')
    mkdirSync(destinationDirectory, { recursive: true })
    writeFileSync(
      join(destinationDirectory, 'SKILL.md'),
      rewriteBrandFileReferences(skillSource),
      'utf8'
    )
    const referencesDirectory = join(sourceDirectory, 'references')
    try {
      const references = readdirSync(referencesDirectory)
      mkdirSync(join(destinationDirectory, 'references'), { recursive: true })
      for (const referenceName of references) {
        cpSync(
          join(referencesDirectory, referenceName),
          join(destinationDirectory, 'references', referenceName)
        )
      }
    } catch (error) {
      if (
        !(error instanceof Error && 'code' in error && error.code === 'ENOENT')
      ) {
        throw error
      }
    }
  }

  process.stdout.write(
    `materialized ${approvedSkillNames.join(', ')} into @repo/marketing-skills\n`
  )
}

const materializeAgentMount = (agentRoot) => {
  const manifest = JSON.parse(
    readFileSync(join(agentRoot, 'package.json'), 'utf8')
  )

  if (manifest.dependencies?.['@repo/marketing-skills'] !== 'workspace:*') {
    throw new Error(
      `${basename(agentRoot)} must depend on @repo/marketing-skills with workspace:*`
    )
  }

  const extensionsDirectory = join(agentRoot, 'agent', 'extensions')
  mkdirSync(extensionsDirectory, { recursive: true })
  writeIfChanged(join(extensionsDirectory, 'marketing-skills.ts'), mountSource)

  process.stdout.write(
    `materialized marketing-skills mount for ${basename(agentRoot)}\n`
  )
}

const [, , requestedName] = process.argv
const currentName = basename(resolve(process.cwd()))

if (
  requestedName === 'marketing-skills' ||
  currentName === 'marketing-skills'
) {
  materializeApprovedSkills()
} else if (agentRootNames.has(currentName)) {
  materializeAgentMount(resolve(process.cwd()))
} else if (requestedName && agentRootNames.has(requestedName)) {
  materializeAgentMount(join(rootDirectory, 'apps', requestedName))
} else {
  throw new Error(
    'Run materialize-marketing-skills from a registered agent root, the marketing-skills package, or pass that directory name.'
  )
}
