import { appendFileSync } from 'node:fs'

const PROJECT_ID_PATTERN = /^[a-z0-9-]{1,60}$/
const PREVIEW_BRANCH_PATTERN = /^preview\/pr-[1-9]\d*-[\w./-]+$/u
const NEON_API_BASE_URL = 'https://console.neon.tech/api/v2'

const requireEnvironmentValue = (name) => {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`${name} is required`)
  }
  return value
}

const writeOutput = (name, value) => {
  const githubOutput = requireEnvironmentValue('GITHUB_OUTPUT')
  appendFileSync(githubOutput, `${name}=${value}\n`, 'utf8')
}

const parseBranches = (value) => {
  if (!(value && typeof value === 'object' && 'branches' in value)) {
    throw new Error('Neon returned an invalid branch-list response')
  }

  const { branches } = value
  if (!Array.isArray(branches)) {
    throw new Error('Neon returned an invalid branches field')
  }

  return branches
}

const isUnsafeBranch = (branch) => {
  if (!(branch && typeof branch === 'object')) {
    return true
  }

  return (
    branch.default === true ||
    branch.primary === true ||
    branch.protected === true ||
    typeof branch.parent_id !== 'string' ||
    branch.parent_id.length === 0
  )
}

const apiKey = requireEnvironmentValue('NEON_API_KEY')
const branchName = requireEnvironmentValue('NEON_PREVIEW_BRANCH_NAME')
const projectId = requireEnvironmentValue('NEON_PROJECT_ID')

if (!PROJECT_ID_PATTERN.test(projectId)) {
  throw new Error('NEON_PROJECT_ID has an invalid format')
}

if (
  !PREVIEW_BRANCH_PATTERN.test(branchName) ||
  branchName.includes('..') ||
  branchName.endsWith('.') ||
  branchName.endsWith('/')
) {
  throw new Error('Refusing a branch outside the preview/pr-* namespace')
}

const url = new URL(`${NEON_API_BASE_URL}/projects/${projectId}/branches`)
url.searchParams.set('include_deleted', 'false')
url.searchParams.set('limit', '100')
url.searchParams.set('search', branchName)

const response = await fetch(url, {
  headers: {
    accept: 'application/json',
    authorization: `Bearer ${apiKey}`,
  },
  signal: AbortSignal.timeout(10_000),
})

if (!response.ok) {
  throw new Error(`Neon branch lookup failed with HTTP ${response.status}`)
}

const branches = parseBranches(await response.json())
const exactMatches = branches.filter(
  (branch) => branch && typeof branch === 'object' && branch.name === branchName
)

if (exactMatches.length === 0) {
  writeOutput('branch_found', 'false')
  writeOutput('branch_id', '')
  process.stdout.write('Neon preview branch is already absent\n')
} else {
  if (exactMatches.length !== 1) {
    throw new Error('Neon returned more than one exact preview branch')
  }

  const [branch] = exactMatches
  if (isUnsafeBranch(branch)) {
    throw new Error('Refusing to delete a default, root, or protected branch')
  }
  if (typeof branch.id !== 'string' || !branch.id.startsWith('br-')) {
    throw new Error('Neon returned an invalid preview branch id')
  }

  writeOutput('branch_found', 'true')
  writeOutput('branch_id', branch.id)
  process.stdout.write(`Resolved safe Neon preview branch ${branchName}\n`)
}
