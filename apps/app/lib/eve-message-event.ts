import 'server-only'

import { sessionEventEnvelopeSchema } from '@repo/brain/session-events'
import type { MessageStreamEvent } from 'eve/client'
import { z } from 'zod'

type ProjectedEventType =
  | 'action.partial'
  | 'action.result'
  | 'actions.requested'
  | 'authorization.completed'
  | 'authorization.required'
  | 'input.requested'
  | 'message.appended'
  | 'message.completed'
  | 'message.received'
  | 'reasoning.appended'
  | 'reasoning.completed'
  | 'result.completed'
  | 'step.started'
  | 'turn.cancelled'
  | 'turn.completed'

type ProjectedMessageStreamEvent = Extract<
  MessageStreamEvent,
  { readonly type: ProjectedEventType }
>

const nonBlankStringSchema = z.string().min(1)
const jsonObjectSchema = z.record(z.string(), z.json())
const sequenceSchema = z.number().int().nonnegative()

const runtimeActionRequestSchema = z.discriminatedUnion('kind', [
  z
    .object({
      callId: nonBlankStringSchema,
      input: jsonObjectSchema,
      kind: z.literal('load-skill'),
    })
    .strict(),
  z
    .object({
      callId: nonBlankStringSchema,
      description: z.string(),
      input: jsonObjectSchema,
      kind: z.literal('remote-agent-call'),
      name: nonBlankStringSchema,
      nodeId: nonBlankStringSchema,
      remoteAgentName: nonBlankStringSchema,
    })
    .strict(),
  z
    .object({
      callId: nonBlankStringSchema,
      description: z.string(),
      input: jsonObjectSchema,
      kind: z.literal('subagent-call'),
      name: nonBlankStringSchema,
      nodeId: nonBlankStringSchema,
      subagentName: nonBlankStringSchema,
    })
    .strict(),
  z
    .object({
      callId: nonBlankStringSchema,
      input: jsonObjectSchema,
      kind: z.literal('tool-call'),
      toolName: nonBlankStringSchema,
    })
    .strict(),
])

const toolResultSchema = z
  .object({
    callId: nonBlankStringSchema,
    isError: z.boolean().optional(),
    kind: z.literal('tool-result'),
    output: z.json(),
    toolName: nonBlankStringSchema,
  })
  .strict()

const tokenUsageSchema = z
  .object({
    cacheReadTokens: sequenceSchema,
    cacheWriteTokens: sequenceSchema,
    inputTokens: sequenceSchema,
    outputTokens: sequenceSchema,
  })
  .strict()

const agentTurnResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cancelled') }).strict(),
  z.object({ error: z.json(), kind: z.literal('failed') }).strict(),
  z.object({ kind: z.literal('succeeded'), output: z.json() }).strict(),
])

const agentTurnOutcomeSchema = z
  .object({
    kind: z.enum(['parked', 'terminal']),
    result: agentTurnResultSchema,
    usageDelta: tokenUsageSchema,
  })
  .strict()

const runtimeActionResultSchema = z.discriminatedUnion('kind', [
  z
    .object({
      callId: nonBlankStringSchema,
      isError: z.boolean().optional(),
      kind: z.literal('load-skill-result'),
      name: z.string().optional(),
      output: z.json(),
    })
    .strict(),
  toolResultSchema,
  z
    .object({
      callId: nonBlankStringSchema,
      isError: z.boolean().optional(),
      kind: z.literal('subagent-result'),
      origin: z.literal('child'),
      outcome: agentTurnOutcomeSchema,
      output: z.json(),
      subagentName: nonBlankStringSchema,
      usage: tokenUsageSchema.optional(),
    })
    .strict(),
  z
    .object({
      callId: nonBlankStringSchema,
      isError: z.literal(true),
      kind: z.literal('subagent-result'),
      origin: z.literal('dispatch'),
      output: z.json(),
      subagentName: nonBlankStringSchema,
    })
    .strict(),
])

const inputOptionSchema = z
  .object({
    description: z.string().optional(),
    id: nonBlankStringSchema,
    label: nonBlankStringSchema,
    style: z.enum(['danger', 'default', 'primary']).optional(),
  })
  .strict()

const inputRequestSchema = z
  .object({
    action: z
      .object({
        callId: nonBlankStringSchema,
        input: jsonObjectSchema,
        kind: z.literal('tool-call'),
        toolName: nonBlankStringSchema,
      })
      .strict(),
    allowFreeform: z.boolean().optional(),
    display: z.enum(['confirmation', 'select', 'text']).optional(),
    kind: z.enum(['question', 'session-limit', 'tool-approval']),
    options: z.array(inputOptionSchema).optional(),
    prompt: z.string(),
    requestId: nonBlankStringSchema,
  })
  .strict()

const authorizationChallengeSchema = z
  .object({
    displayName: z.string().optional(),
    expiresAt: z.string().optional(),
    instructions: z.string().optional(),
    url: z.string().optional(),
    userCode: z.string().optional(),
  })
  .strict()

const turnDataSchema = z
  .object({ sequence: sequenceSchema, turnId: nonBlankStringSchema })
  .strict()

const stepDataSchema = turnDataSchema.extend({ stepIndex: sequenceSchema })

const projectionEventSchema = z.discriminatedUnion('type', [
  sessionEventEnvelopeSchema.extend({
    data: z
      .object({
        message: z.string(),
        parts: z
          .array(
            z.discriminatedUnion('type', [
              z.object({ text: z.string(), type: z.literal('text') }).strict(),
              z
                .object({
                  filename: z.string().optional(),
                  mediaType: nonBlankStringSchema,
                  size: z.number().nonnegative().optional(),
                  type: z.literal('file'),
                  url: z.string().optional(),
                })
                .strict(),
            ])
          )
          .optional(),
        sequence: sequenceSchema,
        turnId: nonBlankStringSchema,
      })
      .strict(),
    type: z.literal('message.received'),
  }),
  sessionEventEnvelopeSchema.extend({
    data: stepDataSchema,
    type: z.literal('step.started'),
  }),
  sessionEventEnvelopeSchema.extend({
    data: stepDataSchema.extend({
      reasoningDelta: z.string(),
      reasoningSoFar: z.string(),
    }),
    type: z.literal('reasoning.appended'),
  }),
  sessionEventEnvelopeSchema.extend({
    data: stepDataSchema.extend({ reasoning: z.string() }),
    type: z.literal('reasoning.completed'),
  }),
  sessionEventEnvelopeSchema.extend({
    data: stepDataSchema.extend({
      actions: z.array(runtimeActionRequestSchema),
    }),
    type: z.literal('actions.requested'),
  }),
  sessionEventEnvelopeSchema.extend({
    data: stepDataSchema.extend({ requests: z.array(inputRequestSchema) }),
    type: z.literal('input.requested'),
  }),
  sessionEventEnvelopeSchema.extend({
    data: stepDataSchema.extend({
      error: z
        .object({ code: nonBlankStringSchema, message: z.string() })
        .strict()
        .optional(),
      result: runtimeActionResultSchema,
      status: z.enum(['completed', 'failed', 'rejected']),
    }),
    type: z.literal('action.result'),
  }),
  sessionEventEnvelopeSchema.extend({
    data: stepDataSchema.extend({ result: toolResultSchema }),
    type: z.literal('action.partial'),
  }),
  sessionEventEnvelopeSchema.extend({
    data: stepDataSchema.extend({
      authorization: authorizationChallengeSchema.optional(),
      description: z.string(),
      name: nonBlankStringSchema,
      webhookUrl: z.string().optional(),
    }),
    type: z.literal('authorization.required'),
  }),
  sessionEventEnvelopeSchema.extend({
    data: stepDataSchema.extend({
      authorization: authorizationChallengeSchema.optional(),
      name: nonBlankStringSchema,
      outcome: z.enum(['authorized', 'declined', 'failed', 'timed-out']),
      reason: z.string().optional(),
    }),
    type: z.literal('authorization.completed'),
  }),
  sessionEventEnvelopeSchema.extend({
    data: stepDataSchema.extend({
      messageDelta: z.string(),
      messageSoFar: z.string(),
    }),
    type: z.literal('message.appended'),
  }),
  sessionEventEnvelopeSchema.extend({
    data: stepDataSchema.extend({
      finishReason: z.enum([
        'content-filter',
        'error',
        'length',
        'other',
        'stop',
        'tool-calls',
      ]),
      message: z.string().nullable(),
    }),
    type: z.literal('message.completed'),
  }),
  sessionEventEnvelopeSchema.extend({
    data: stepDataSchema.extend({ result: z.json() }),
    type: z.literal('result.completed'),
  }),
  sessionEventEnvelopeSchema.extend({
    data: turnDataSchema,
    type: z.literal('turn.completed'),
  }),
  sessionEventEnvelopeSchema.extend({
    data: turnDataSchema,
    type: z.literal('turn.cancelled'),
  }),
])

const PROJECTED_EVENT_TYPES = new Set<string>(
  projectionEventSchema.options.map((option) => option.shape.type.value)
)

export const parseEveMessageProjectionEvent = (
  value: unknown
): ProjectedMessageStreamEvent | null => {
  const envelope = sessionEventEnvelopeSchema.parse(value)
  if (!PROJECTED_EVENT_TYPES.has(envelope.type)) {
    return null
  }
  return projectionEventSchema.parse(envelope)
}
