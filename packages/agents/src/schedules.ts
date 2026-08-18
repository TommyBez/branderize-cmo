import { z } from 'zod'

const scheduleKeySchema = z
  .string()
  .trim()
  .min(1)
  .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u)
const taskKindSchema = z.string().trim().min(1)
const digestSchema = z.string().regex(/^[0-9a-f]{64}$/u)

export const activeScheduleTemplateSchema = z
  .object({
    defaultCadence: z.enum(['daily', 'weekly']),
    defaultEnabled: z.literal(false),
    defaultLocalTime: z.iso.time({ precision: 0 }),
    defaultLocalWeekday: z.number().int().min(0).max(6).optional(),
    fixedPayload: z.record(z.string(), z.json()),
    lifecycle: z.literal('active'),
    scheduleKey: scheduleKeySchema,
    taskKind: taskKindSchema,
  })
  .strict()
  .superRefine((template, context) => {
    const hasWeekday = template.defaultLocalWeekday !== undefined
    if (template.defaultCadence === 'daily' && hasWeekday) {
      context.addIssue({
        code: 'custom',
        message: 'Daily templates cannot declare a weekday',
        path: ['defaultLocalWeekday'],
      })
    }
    if (template.defaultCadence === 'weekly' && !hasWeekday) {
      context.addIssue({
        code: 'custom',
        message: 'Weekly templates require a weekday',
        path: ['defaultLocalWeekday'],
      })
    }
  })

export const retiredScheduleTemplateSchema = z
  .object({
    displayLabel: z.string().trim().min(1),
    frozenBinding: z
      .object({
        fixedPayloadDigest: digestSchema,
        taskKind: taskKindSchema,
        workerKey: z.string().trim().min(1),
      })
      .strict(),
    lifecycle: z.literal('retired'),
    scheduleKey: scheduleKeySchema,
  })
  .strict()

export const scheduleTemplateSchema = z.discriminatedUnion('lifecycle', [
  activeScheduleTemplateSchema,
  retiredScheduleTemplateSchema,
])

export type ActiveScheduleTemplate = z.infer<
  typeof activeScheduleTemplateSchema
>
export type RetiredScheduleTemplate = z.infer<
  typeof retiredScheduleTemplateSchema
>
export type ScheduleTemplate = z.infer<typeof scheduleTemplateSchema>

export const scheduleTemplates =
  [] as const satisfies readonly ScheduleTemplate[]

export const validateScheduleTemplates = (
  templates: readonly unknown[]
): readonly ScheduleTemplate[] => {
  const parsed = templates.map((template) =>
    scheduleTemplateSchema.parse(template)
  )
  const observedKeys = new Set<string>()
  for (const template of parsed) {
    if (observedKeys.has(template.scheduleKey)) {
      throw new Error(
        `Duplicate schedule template key: ${template.scheduleKey}`
      )
    }
    observedKeys.add(template.scheduleKey)
  }
  return parsed
}
