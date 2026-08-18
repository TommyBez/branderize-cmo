const EVE_LOCAL_STORE_MODULE_SUFFIX =
  '/eve/dist/src/internal/workflow/local-world-data-directory.js'
const EVE_LOCAL_STORE_RELATIVE_PATH = '.eve/.workflow-data'

let expectedModuleUrl
let storeDirectory

export const initialize = ({
  expectedLocalStoreModuleUrl,
  workflowStoreDirectory,
}) => {
  if (process.env.E2E_PROVIDER_MODE !== 'scripted') {
    throw new Error('The E2E Workflow store loader ran outside E2E')
  }
  expectedModuleUrl = expectedLocalStoreModuleUrl
  storeDirectory = workflowStoreDirectory
}

export const resolve = async (specifier, context, nextResolve) => {
  const resolution = await nextResolve(specifier, context)
  if (
    resolution.url.endsWith(EVE_LOCAL_STORE_MODULE_SUFFIX) &&
    resolution.url !== expectedModuleUrl
  ) {
    throw new Error(
      `The pinned Eve local Workflow store module changed: ${resolution.url}`
    )
  }
  return resolution
}

export const load = async (url, context, nextLoad) => {
  if (url !== expectedModuleUrl) {
    return await nextLoad(url, context)
  }
  if (typeof storeDirectory !== 'string' || storeDirectory.length === 0) {
    throw new Error('The E2E Workflow store loader is missing its state root')
  }

  return {
    format: 'module',
    shortCircuit: true,
    source: `
      export const LOCAL_WORKFLOW_WORLD_DATA_DIRECTORY_RELATIVE_PATH = ${JSON.stringify(EVE_LOCAL_STORE_RELATIVE_PATH)}
      export const resolveLocalWorkflowWorldDataDirectory = () =>
        ${JSON.stringify(storeDirectory)}
    `,
  }
}
