import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

const backendFactories = {
  vercel: vi.fn((options: unknown) => ({ kind: 'vercel', options })),
}

const UNSAFE_SANDBOX_BACKEND_PATTERN =
  /defaultBackend|docker|just-?bash|microsandbox/iu

const sandboxOwners = [
  {
    load: () => import('../../apps/agent-cmo/agent/sandbox'),
    name: 'cmo',
    sourceUrl: new URL(
      '../../apps/agent-cmo/agent/sandbox.ts',
      import.meta.url
    ),
  },
  {
    load: () => import('../../apps/agent-content/agent/sandbox'),
    name: 'content',
    sourceUrl: new URL(
      '../../apps/agent-content/agent/sandbox.ts',
      import.meta.url
    ),
  },
  {
    load: () => import('../../apps/agent-distribution/agent/sandbox'),
    name: 'distribution',
    sourceUrl: new URL(
      '../../apps/agent-distribution/agent/sandbox.ts',
      import.meta.url
    ),
  },
  {
    load: () => import('../../apps/agent-growth/agent/sandbox'),
    name: 'growth',
    sourceUrl: new URL(
      '../../apps/agent-growth/agent/sandbox.ts',
      import.meta.url
    ),
  },
  {
    load: () => import('../../apps/agent-lifecycle/agent/sandbox'),
    name: 'lifecycle',
    sourceUrl: new URL(
      '../../apps/agent-lifecycle/agent/sandbox.ts',
      import.meta.url
    ),
  },
  {
    load: () => import('../../apps/agent-product-marketer/agent/sandbox'),
    name: 'product-marketer',
    sourceUrl: new URL(
      '../../apps/agent-product-marketer/agent/sandbox.ts',
      import.meta.url
    ),
  },
  {
    load: () => import('../../apps/agent-seo-discovery/agent/sandbox'),
    name: 'seo-discovery',
    sourceUrl: new URL(
      '../../apps/agent-seo-discovery/agent/sandbox.ts',
      import.meta.url
    ),
  },
  {
    load: () =>
      import('../../apps/agent-cmo/agent/subagents/product-marketer/sandbox'),
    name: 'cmo/product-marketer',
    sourceUrl: new URL(
      '../../apps/agent-cmo/agent/subagents/product-marketer/sandbox.ts',
      import.meta.url
    ),
  },
] as const

describe('Eve sandbox network policy', () => {
  it('pins every owner to the shared hosted deny-all backend without a local Docker fallback', async () => {
    const ownerSources = await Promise.all(
      sandboxOwners.map(async (owner) => ({
        name: owner.name,
        source: await readFile(fileURLToPath(owner.sourceUrl), 'utf8'),
      }))
    )
    const sharedSandboxSource = await readFile(
      fileURLToPath(
        new URL('../../packages/agents/src/sandbox.ts', import.meta.url)
      ),
      'utf8'
    )

    for (const { name, source } of ownerSources) {
      expect(source, name).toContain(
        "export { default } from '@repo/agents/sandbox'"
      )
      expect(source, name).not.toMatch(UNSAFE_SANDBOX_BACKEND_PATTERN)
    }
    expect(sharedSandboxSource).toContain("from 'eve/sandbox/vercel'")
    expect(sharedSandboxSource).not.toMatch(UNSAFE_SANDBOX_BACKEND_PATTERN)

    const requireFromAgent = createRequire(
      fileURLToPath(
        new URL('../../apps/agent-cmo/package.json', import.meta.url)
      )
    )
    vi.doMock(requireFromAgent.resolve('eve/sandbox/vercel'), () => ({
      vercel: backendFactories.vercel,
    }))

    const definitions = await Promise.all(
      sandboxOwners.map(async ({ load }) => (await load()).default)
    )
    expect(backendFactories.vercel).not.toHaveBeenCalled()

    const resolvedBackends = definitions.map((definition) => {
      expect(typeof definition.backend).toBe('function')
      if (typeof definition.backend !== 'function') {
        throw new Error('Expected a lazy sandbox backend factory')
      }
      return definition.backend()
    })

    expect(backendFactories.vercel).toHaveBeenCalledTimes(sandboxOwners.length)
    for (const [index, backend] of resolvedBackends.entries()) {
      expect(backend, sandboxOwners[index]?.name).toEqual({
        kind: 'vercel',
        options: { networkPolicy: 'deny-all' },
      })
    }
    for (const [options] of backendFactories.vercel.mock.calls) {
      expect(options).toEqual({ networkPolicy: 'deny-all' })
    }
  })
})
