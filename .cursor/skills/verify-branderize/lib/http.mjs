import { createServer } from 'node:net'

const FETCH_TIMEOUT_MS = 4000

export const fetchText = async (url) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: controller.signal,
    })
    const body = await response.text()
    return {
      body,
      ok: response.ok,
      status: response.status,
      url,
    }
  } catch (error) {
    return {
      body: '',
      error: error instanceof Error ? error.message : String(error),
      ok: false,
      status: 0,
      url,
    }
  } finally {
    clearTimeout(timer)
  }
}

export const portIsListening = (port, host = '127.0.0.1') =>
  new Promise((resolve) => {
    const socket = createServer()
    socket.once('error', () => resolve(true))
    socket.listen(port, host, () => {
      socket.close(() => resolve(false))
    })
  })
