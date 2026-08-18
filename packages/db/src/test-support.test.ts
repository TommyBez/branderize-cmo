import { describe, expect, it } from 'vitest'

import { executeStatementsSequentially } from './test-support'

describe('database test support', () => {
  it('executes every statement in order', async () => {
    const observed: string[] = []

    await executeStatementsSequentially({
      execute: async (statement) => {
        observed.push(`start:${statement}`)
        await Promise.resolve()
        observed.push(`finish:${statement}`)
      },
      statements: ['first', 'second', 'third'],
    })

    expect(observed).toEqual([
      'start:first',
      'finish:first',
      'start:second',
      'finish:second',
      'start:third',
      'finish:third',
    ])
  })

  it('stops when a statement fails', async () => {
    const observed: string[] = []

    await expect(
      executeStatementsSequentially({
        execute: (statement) => {
          observed.push(statement)
          if (statement === 'second') {
            return Promise.reject(new Error('statement failed'))
          }
          return Promise.resolve()
        },
        statements: ['first', 'second', 'third'],
      })
    ).rejects.toThrow('statement failed')

    expect(observed).toEqual(['first', 'second'])
  })
})
