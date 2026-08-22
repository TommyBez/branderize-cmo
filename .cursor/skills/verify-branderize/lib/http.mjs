import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { createServer } from 'node:net'

const FETCH_TIMEOUT_MS = 4000

const defaultPortForProtocol = (protocol) => (protocol === 'https:' ? 443 : 80)

const readResponse = (url, { insecureTls = false } = {}) =>
  new Promise((resolveRead) => {
    const parsed = new URL(url)
    const transport = parsed.protocol === 'https:' ? httpsRequest : httpRequest
    const request = transport(
      {
        hostname: parsed.hostname,
        method: 'GET',
        path: `${parsed.pathname}${parsed.search}` || '/',
        port:
          parsed.port === ''
            ? defaultPortForProtocol(parsed.protocol)
            : parsed.port,
        rejectUnauthorized: !insecureTls,
        timeout: FETCH_TIMEOUT_MS,
      },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => {
          chunks.push(chunk)
        })
        response.on('end', () => {
          const status = response.statusCode ?? 0
          resolveRead({
            body: Buffer.concat(chunks).toString('utf8'),
            ok: status >= 200 && status < 300,
            status,
            url,
          })
        })
      }
    )
    request.once('error', (error) => {
      resolveRead({
        body: '',
        error: error instanceof Error ? error.message : String(error),
        ok: false,
        status: 0,
        url,
      })
    })
    request.once('timeout', () => {
      request.destroy()
      resolveRead({
        body: '',
        error: `Timed out fetching ${url}`,
        ok: false,
        status: 0,
        url,
      })
    })
    request.end()
  })

export const fetchText = (url, options = {}) => readResponse(url, options)

export const portIsListening = (port, host = '127.0.0.1') =>
  new Promise((resolve) => {
    const socket = createServer()
    socket.once('error', () => resolve(true))
    socket.listen(port, host, () => {
      socket.close(() => resolve(false))
    })
  })
