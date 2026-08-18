import { defineConfig } from 'drizzle-kit'

const directDatabaseUrl = process.env.DIRECT_DATABASE_URL

if (!directDatabaseUrl) {
  throw new Error('DIRECT_DATABASE_URL is required to run database migrations')
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
