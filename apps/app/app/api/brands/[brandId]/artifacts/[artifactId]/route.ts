import { assetDeliveryService } from '@/lib/blob'
import { readRequestSession } from '@/lib/dal'

const responseFromDelivery = async (
  request: Request,
  context: {
    readonly params: Promise<{
      readonly artifactId: string
      readonly brandId: string
    }>
  }
): Promise<Response> => {
  const session = await readRequestSession()
  if (session === null) {
    return new Response(null, { status: 401 })
  }
  const { artifactId, brandId } = await context.params
  const url = new URL(request.url)
  const ifNoneMatch = request.headers.get('if-none-match')
  if ([...url.searchParams.keys()].some((key) => key !== 'delivery')) {
    return new Response(null, { status: 400 })
  }

  const result = await assetDeliveryService.deliver({
    principal: { kind: 'authenticated', userId: session.user.id },
    request: {
      artifactId,
      brandId,
      delivery: url.searchParams.get('delivery'),
      ...(ifNoneMatch === null ? {} : { ifNoneMatch }),
    },
  })

  switch (result.kind) {
    case 'forbidden':
      return new Response(null, { status: 403 })
    case 'invalid_request':
      return new Response(null, { status: 400 })
    case 'not_found':
      return new Response(null, { status: 404 })
    case 'not_modified':
      return new Response(null, { headers: result.headers, status: 304 })
    case 'ready':
      return new Response(result.stream, {
        headers: result.headers,
        status: 200,
      })
    case 'unauthenticated':
      return new Response(null, { status: 401 })
    case 'unavailable':
      return new Response(null, { status: 503 })
    default:
      return new Response(null, { status: 503 })
  }
}

export const GET = responseFromDelivery
