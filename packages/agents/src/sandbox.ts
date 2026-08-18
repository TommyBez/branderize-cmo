import { defineSandbox, type SandboxDefinition } from 'eve/sandbox'
import { vercel } from 'eve/sandbox/vercel'

const sandbox: SandboxDefinition<never, never> = defineSandbox({
  backend: () => vercel({ networkPolicy: 'deny-all' }),
})

export default sandbox
