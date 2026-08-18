import { z } from 'zod'

export const memberRoleSchema = z.enum(['owner', 'admin', 'member', 'viewer'])

const identifierSchema = z.string().trim().min(1)

export const trustedOrganizationAccessSchema = z
  .object({
    organizationId: identifierSchema,
    userId: identifierSchema,
  })
  .strict()

export const trustedMemberAccessSchema = z
  .object({
    brandId: identifierSchema,
    humanActorId: identifierSchema,
    humanActorKey: identifierSchema,
    organizationId: identifierSchema,
    role: memberRoleSchema,
    userId: identifierSchema,
  })
  .strict()

export const trustedCmoTurnAccessSchema = trustedMemberAccessSchema.extend({
  callId: identifierSchema,
  cmoActorId: identifierSchema,
  cmoActorKey: z.literal('agent:cmo'),
  conversationId: identifierSchema,
  rootSessionId: identifierSchema,
  sessionId: identifierSchema,
  turnId: identifierSchema,
})

export const trustedTaskExecutionSchema = z
  .object({
    agentActorId: identifierSchema,
    agentActorKey: identifierSchema,
    brandId: identifierSchema,
    rootSessionId: identifierSchema,
    sessionId: identifierSchema,
    startedAt: z.date(),
    taskId: identifierSchema,
    workerKey: identifierSchema,
  })
  .strict()

export type MemberRole = z.infer<typeof memberRoleSchema>
export type TrustedOrganizationAccess = z.infer<
  typeof trustedOrganizationAccessSchema
>
export type TrustedMemberAccess = z.infer<typeof trustedMemberAccessSchema>
export type TrustedCmoTurnAccess = z.infer<typeof trustedCmoTurnAccessSchema>
export type TrustedTaskExecution = z.infer<typeof trustedTaskExecutionSchema>

export const canMutate = (role: MemberRole): boolean => role !== 'viewer'
