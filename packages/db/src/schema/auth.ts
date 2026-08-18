import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

const timestampWithTimezone = (name: string) =>
  timestamp(name, { mode: 'date', withTimezone: true })

export const user = pgTable(
  'user',
  {
    createdAt: timestampWithTimezone('created_at').defaultNow().notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').default(false).notNull(),
    id: text('id').primaryKey(),
    image: text('image'),
    name: text('name').notNull(),
    updatedAt: timestampWithTimezone('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('user_email_unique').on(table.email),
    check('user_email_nonempty', sql`length(btrim(${table.email})) > 0`),
  ]
)

export const organization = pgTable(
  'organization',
  {
    createdAt: timestampWithTimezone('created_at').defaultNow().notNull(),
    id: text('id').primaryKey(),
    logo: text('logo'),
    metadata: text('metadata'),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
  },
  (table) => [
    uniqueIndex('organization_slug_unique').on(table.slug),
    check('organization_name_nonempty', sql`length(btrim(${table.name})) > 0`),
  ]
)

export const session = pgTable(
  'session',
  {
    activeOrganizationId: text('active_organization_id').references(
      () => organization.id,
      { onDelete: 'set null' }
    ),
    createdAt: timestampWithTimezone('created_at').defaultNow().notNull(),
    expiresAt: timestampWithTimezone('expires_at').notNull(),
    id: text('id').primaryKey(),
    ipAddress: text('ip_address'),
    token: text('token').notNull(),
    updatedAt: timestampWithTimezone('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [
    uniqueIndex('session_token_unique').on(table.token),
    index('session_user_id_idx').on(table.userId),
    index('session_active_organization_id_idx').on(table.activeOrganizationId),
  ]
)

export const account = pgTable(
  'account',
  {
    accessToken: text('access_token'),
    accessTokenExpiresAt: timestampWithTimezone('access_token_expires_at'),
    accountId: text('account_id').notNull(),
    createdAt: timestampWithTimezone('created_at').defaultNow().notNull(),
    id: text('id').primaryKey(),
    idToken: text('id_token'),
    password: text('password'),
    providerId: text('provider_id').notNull(),
    refreshToken: text('refresh_token'),
    refreshTokenExpiresAt: timestampWithTimezone('refresh_token_expires_at'),
    scope: text('scope'),
    updatedAt: timestampWithTimezone('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [
    uniqueIndex('account_provider_account_unique').on(
      table.providerId,
      table.accountId
    ),
    index('account_user_id_idx').on(table.userId),
  ]
)

export const verification = pgTable(
  'verification',
  {
    createdAt: timestampWithTimezone('created_at').defaultNow().notNull(),
    expiresAt: timestampWithTimezone('expires_at').notNull(),
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    updatedAt: timestampWithTimezone('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    value: text('value').notNull(),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)]
)

export const member = pgTable(
  'member',
  {
    createdAt: timestampWithTimezone('created_at').defaultNow().notNull(),
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [
    uniqueIndex('member_organization_user_unique').on(
      table.organizationId,
      table.userId
    ),
    index('member_user_id_idx').on(table.userId),
    check(
      'member_role_valid',
      sql`${table.role} IN ('owner', 'admin', 'member', 'viewer')`
    ),
  ]
)

export const invitation = pgTable(
  'invitation',
  {
    createdAt: timestampWithTimezone('created_at').defaultNow().notNull(),
    email: text('email').notNull(),
    expiresAt: timestampWithTimezone('expires_at').notNull(),
    id: text('id').primaryKey(),
    inviterId: text('inviter_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    role: text('role'),
    status: text('status').notNull(),
  },
  (table) => [
    index('invitation_organization_status_idx').on(
      table.organizationId,
      table.status
    ),
    index('invitation_email_idx').on(table.email),
    check(
      'invitation_role_valid',
      sql`${table.role} IS NULL OR ${table.role} IN ('owner', 'admin', 'member', 'viewer')`
    ),
    check(
      'invitation_status_valid',
      sql`${table.status} IN ('pending', 'accepted', 'rejected', 'canceled')`
    ),
  ]
)

export const authSchema = {
  account,
  invitation,
  member,
  organization,
  session,
  user,
  verification,
}
