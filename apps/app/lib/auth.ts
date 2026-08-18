import 'server-only'

import { createBranderizeAuth } from '@repo/auth/server'
import { db } from '@repo/db'
import { parseAppServerEnvironment } from '@repo/env/app-server'

export const appEnvironment = parseAppServerEnvironment(process.env)

export const auth = createBranderizeAuth({
  database: db,
  environment: appEnvironment,
})
