const LOOPBACK_IPV4_PATTERN = /^127(?:\.\d{1,3}){3}$/u

const isLoopbackHostname = (hostname: string): boolean =>
  hostname === 'localhost' ||
  hostname === '[::1]' ||
  LOOPBACK_IPV4_PATTERN.test(hostname)

const isLocalhostDevelopmentHostname = (hostname: string): boolean =>
  hostname === 'localhost' || hostname.endsWith('.localhost')

export const isGuardedLocalEmailOtpEnvironment = (environment: {
  readonly AUTH_LOCAL_OTP_BYPASS?: '1'
  readonly BETTER_AUTH_URL: string
  readonly NODE_ENV: 'development' | 'test' | 'production'
  readonly VERCEL_ENV?: 'development' | 'preview' | 'production'
}): boolean => {
  const authUrl = new URL(environment.BETTER_AUTH_URL)
  const authHostname = authUrl.hostname.toLowerCase()
  const authUrlIsLocalDevelopment =
    (authUrl.protocol === 'http:' || authUrl.protocol === 'https:') &&
    (isLoopbackHostname(authHostname) ||
      isLocalhostDevelopmentHostname(authHostname))

  return (
    environment.AUTH_LOCAL_OTP_BYPASS === '1' &&
    environment.NODE_ENV === 'development' &&
    environment.VERCEL_ENV === 'development' &&
    authUrlIsLocalDevelopment
  )
}
