const POSTHOG_PROJECT_TOKEN_PATTERN = /^phc_[A-Za-z0-9_-]{8,252}$/u

export type PostHogEnvironmentSource = Readonly<
  Record<string, string | undefined>
>

export const resolveProductionPostHogToken = (
  source: PostHogEnvironmentSource
): string | null => {
  if (source.NODE_ENV !== 'production' || source.VERCEL_ENV !== 'production') {
    return null
  }

  const token = source.NEXT_PUBLIC_POSTHOG_KEY?.trim()
  return token && POSTHOG_PROJECT_TOKEN_PATTERN.test(token) ? token : null
}
