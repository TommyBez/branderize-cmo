'use client'

import type { BeforeSendFn, CaptureResult, PostHog } from 'posthog-js'

const POSTHOG_EU_HOST = 'https://eu.i.posthog.com'
const POSTHOG_EU_UI_HOST = 'https://eu.posthog.com'
const POSTHOG_PROJECT_TOKEN_PATTERN = /^phc_[A-Za-z0-9_-]{8,252}$/u
const CLIENT_DISTINCT_ID = 'service:app'
const CLIENT_ERROR_CODE = 'CLIENT_RENDER_FAILURE'
const CLIENT_ERROR_FINGERPRINT = `app:client:${CLIENT_ERROR_CODE}`

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const sanitizeClientPostHogEvent: BeforeSendFn = (
  event
): CaptureResult | null => {
  if (!(event && event.event === '$exception' && isRecord(event.properties))) {
    return null
  }

  const {
    distinct_id: distinctId,
    error_code: errorCode,
    error_surface: errorSurface,
    retryable,
    service_name: serviceName,
    token,
  } = event.properties
  const isExpectedSyntheticError =
    distinctId === CLIENT_DISTINCT_ID &&
    errorCode === CLIENT_ERROR_CODE &&
    errorSurface === 'client' &&
    retryable === true &&
    serviceName === 'app'

  if (
    typeof token !== 'string' ||
    !POSTHOG_PROJECT_TOKEN_PATTERN.test(token) ||
    !isExpectedSyntheticError
  ) {
    return null
  }

  return {
    event: '$exception',
    properties: {
      $exception_fingerprint: CLIENT_ERROR_FINGERPRINT,
      $exception_level: 'error',
      $exception_list: [
        {
          mechanism: { handled: true, synthetic: true },
          type: 'BranderizeHandledClientError',
          value: CLIENT_ERROR_CODE,
        },
      ],
      $process_person_profile: false,
      distinct_id: CLIENT_DISTINCT_ID,
      error_code: CLIENT_ERROR_CODE,
      error_surface: 'client',
      retryable: true,
      service_name: 'app',
      token,
    },
    timestamp: event.timestamp,
    uuid: event.uuid,
  }
}

class SyntheticClientRenderError extends Error {
  constructor() {
    super(CLIENT_ERROR_CODE)
    this.name = 'BranderizeHandledClientError'
    Error.captureStackTrace?.(this, SyntheticClientRenderError)
  }
}

let client: PostHog | null = null
let initialization: Promise<PostHog | null> | undefined
let pendingClientRenderError = false
let reportedClientRenderError = false

const sendSyntheticClientRenderError = (posthog: PostHog): void => {
  posthog.captureException(new SyntheticClientRenderError(), {
    distinct_id: CLIENT_DISTINCT_ID,
    error_code: CLIENT_ERROR_CODE,
    error_surface: 'client',
    retryable: true,
    service_name: 'app',
  })
}

export const initializePostHogClient = async (token: string): Promise<void> => {
  if (!POSTHOG_PROJECT_TOKEN_PATTERN.test(token)) {
    return
  }

  initialization ??= (async () => {
    try {
      const { default: posthog } = await import('posthog-js')
      return posthog.init(token, {
        advanced_disable_feature_flags: true,
        advanced_disable_flags: true,
        advanced_disable_toolbar_metrics: true,
        api_host: POSTHOG_EU_HOST,
        autocapture: false,
        before_send: sanitizeClientPostHogEvent,
        capture_exceptions: false,
        capture_pageleave: false,
        capture_pageview: false,
        capture_performance: false,
        disable_conversations: true,
        disable_external_dependency_loading: true,
        disable_persistence: true,
        disable_product_tours: true,
        disable_scroll_properties: true,
        disable_session_recording: true,
        disable_surveys: true,
        disable_web_experiments: true,
        enable_heatmaps: false,
        ip: false,
        opt_in_site_apps: false,
        person_profiles: 'never',
        save_campaign_params: false,
        save_referrer: false,
        ui_host: POSTHOG_EU_UI_HOST,
      })
    } catch {
      return null
    }
  })()

  client = await initialization
  if (client && pendingClientRenderError) {
    pendingClientRenderError = false
    sendSyntheticClientRenderError(client)
  }
}

export const captureSyntheticClientRenderError = (): void => {
  if (reportedClientRenderError) {
    return
  }
  reportedClientRenderError = true

  if (client) {
    sendSyntheticClientRenderError(client)
    return
  }
  pendingClientRenderError = true
}
