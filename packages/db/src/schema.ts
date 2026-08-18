import { authSchema } from './schema/auth'
import {
  actions,
  actors,
  brands,
  cmoConversations,
  creditLedger,
  intents,
  objects,
  schedules,
  sessionEvents,
  tasks,
} from './schema/domain'

export const schema = {
  ...authSchema,
  actions,
  actors,
  brands,
  cmoConversations,
  creditLedger,
  intents,
  objects,
  schedules,
  sessionEvents,
  tasks,
}
