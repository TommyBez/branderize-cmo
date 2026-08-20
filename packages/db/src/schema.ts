import { authSchema } from './schema/auth'
import {
  actions,
  actors,
  brandConnections,
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
  brandConnections,
  brands,
  cmoConversations,
  creditLedger,
  intents,
  objects,
  schedules,
  sessionEvents,
  tasks,
}
