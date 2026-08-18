import { localDev } from 'eve/channels/auth'
import { eveChannel } from 'eve/channels/eve'

import { cmoBridgeAuth } from '../lib/cmo-bridge-auth'

export default eveChannel({
  auth: [cmoBridgeAuth, localDev()],
})
