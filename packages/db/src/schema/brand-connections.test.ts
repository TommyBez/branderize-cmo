import { getTableColumns } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { brandConnections } from './domain'

const TOKEN_COLUMN_PATTERN =
  /(?:access|refresh|id)?_?token|api_?key|client_secret|bearer/iu

describe('brand_connections schema', () => {
  it('stores only brand-owned connection references and never token columns', () => {
    const columns = getTableColumns(brandConnections)
    const columnNames = Object.keys(columns).sort()

    expect(columnNames).toEqual([
      'accountLabel',
      'brandId',
      'connectorUid',
      'createdAt',
      'id',
      'installationId',
      'providerSlot',
      'scopes',
      'status',
      'updatedAt',
    ])

    const sqlColumnNames = Object.values(columns)
      .map((column) => column.name)
      .sort()
    expect(sqlColumnNames).toEqual([
      'account_label',
      'brand_id',
      'connector_uid',
      'created_at',
      'id',
      'installation_id',
      'provider_slot',
      'scopes',
      'status',
      'updated_at',
    ])

    for (const columnName of [...columnNames, ...sqlColumnNames]) {
      expect(columnName).not.toMatch(TOKEN_COLUMN_PATTERN)
    }
  })
})
