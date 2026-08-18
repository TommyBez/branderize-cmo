import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  cacheComponents: true,
  experimental: {
    exposeTestingApiInProductionBuild:
      process.env.E2E_EXPOSE_NEXT_TESTING_API === '1',
    instantInsights: {
      validationLevel: 'warning',
    },
  },
  partialPrefetching: true,
  reactCompiler: true,
}

export default nextConfig
