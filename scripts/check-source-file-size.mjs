import { readdir, readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

const MAX_SOURCE_LINES = 999
const SOURCE_ROOTS = ['apps', 'packages', 'scripts']
const SOURCE_EXTENSIONS = new Set(['.css', '.mjs', '.ts', '.tsx'])
const EXCLUDED_DIRECTORIES = new Set([
  '.agents',
  '.claude',
  '.eve',
  '.next',
  '.output',
  'coverage',
  'dist',
  'node_modules',
  'test-results',
  'tests',
])
const TEST_FILE_PATTERN = /(?:^|\.)test\.(?:ts|tsx)$/u

const countLines = (source) => {
  if (source.length === 0) {
    return 0
  }
  const lineBreaks = source.match(/\n/gu)?.length ?? 0
  return lineBreaks + (source.endsWith('\n') ? 0 : 1)
}

const listSourceFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      if (entry.name.startsWith('.eve-extension-build-')) {
        return []
      }
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        return EXCLUDED_DIRECTORIES.has(entry.name)
          ? []
          : await listSourceFiles(path)
      }
      if (
        entry.isFile() &&
        SOURCE_EXTENSIONS.has(extname(entry.name)) &&
        !TEST_FILE_PATTERN.test(entry.name)
      ) {
        return [path]
      }
      return []
    })
  )
  return files.flat()
}

const sourceFiles = (
  await Promise.all(SOURCE_ROOTS.map((root) => listSourceFiles(root)))
).flat()
const inspectedFiles = await Promise.all(
  sourceFiles.map(async (path) => ({
    lines: countLines(await readFile(path, 'utf8')),
    path,
  }))
)
const oversized = inspectedFiles.filter(({ lines }) => lines > MAX_SOURCE_LINES)

if (oversized.length > 0) {
  oversized.sort((left, right) => right.lines - left.lines)
  for (const file of oversized) {
    process.stderr.write(
      `${file.path}: ${file.lines} lines exceeds the ${MAX_SOURCE_LINES}-line source limit\n`
    )
  }
  process.exitCode = 1
} else {
  process.stdout.write(
    `Source file size gate passed (${sourceFiles.length} files, maximum ${MAX_SOURCE_LINES} lines).\n`
  )
}
