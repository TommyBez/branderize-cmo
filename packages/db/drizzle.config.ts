import { defineConfig } from 'drizzle-kit'

const directDatabaseUrl =
  process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL_UNPOOLED

if (!directDatabaseUrl) {
  throw new Error(
    'DIRECT_DATABASE_URL or DATABASE_URL_UNPOOLED is required to run database migrations'
  )
}

export default defineConfig({
  dbCredentials: {
    url: directDatabaseUrl,
  },
  dialect: 'postgresql',
  out: './drizzle',
  schema: ['./src/schema/auth.ts', './src/schema/domain.ts'],
  strict: true,
  verbose: true,
})
