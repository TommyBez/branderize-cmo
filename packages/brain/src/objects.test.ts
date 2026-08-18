import { describe, expect, it } from 'vitest'

import {
  commitContextBootstrapInputSchema,
  productMarketerContextContentSchema,
} from './objects'

const artifact = {
  blobKey:
    'brands/018f47a6-72d3-7a93-b49a-d91f50dd1771/artifacts/sha256/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png',
  byteSize: 8,
  contentType: 'image/png',
  finalUrl: 'https://cdn.example.test/logo.png',
  sha256: 'a'.repeat(64),
  sourceUrl: 'https://example.test/logo.png',
}

describe('canonical Object inputs', () => {
  it('requires at least one mirrored Artifact for Context bootstrap', () => {
    expect(() =>
      commitContextBootstrapInputSchema.parse({
        artifacts: [],
        snapshot: { version: 1 },
        websiteUrl: 'https://example.test',
      })
    ).toThrow()
  })

  it('rejects duplicate mirrored Artifact keys before graph commit', () => {
    expect(() =>
      commitContextBootstrapInputSchema.parse({
        artifacts: [artifact, artifact],
        snapshot: { version: 1 },
        websiteUrl: 'https://example.test',
      })
    ).toThrow('Artifact blob keys must be unique')
  })

  it('rejects unsupported mirrored Artifact content types', () => {
    expect(() =>
      commitContextBootstrapInputSchema.parse({
        artifacts: [{ ...artifact, contentType: 'text/html' }],
        snapshot: { version: 1 },
        websiteUrl: 'https://example.test',
      })
    ).toThrow()
  })

  it('keeps Product Marketer content closed and non-committing', () => {
    expect(() =>
      productMarketerContextContentSchema.parse({
        audiences: [{ need: 'Reliable attribution', segment: 'B2B teams' }],
        category: 'Marketing operating system',
        differentiators: ['Canonical provenance'],
        externalCommitment: 'Publish the campaign',
        risks: [],
        summary: 'The brand can lead with auditable coordination.',
        valueProposition: 'Move from advice to attributable work.',
      })
    ).toThrow()
  })
})
