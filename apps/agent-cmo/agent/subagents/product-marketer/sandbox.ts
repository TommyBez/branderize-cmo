import { defineSandbox, type SandboxDefinition } from 'eve/sandbox'
import { docker } from 'eve/sandbox/docker'
import { vercel } from 'eve/sandbox/vercel'

const sandbox: SandboxDefinition<never, never> = process.env.VERCEL
  ? defineSandbox({
      backend: () => vercel({ networkPolicy: 'deny-all' }),
    })
  : defineSandbox({
      backend: () => docker({ networkPolicy: 'deny-all' }),
    })

export default sandbox
