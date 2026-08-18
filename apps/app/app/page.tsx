import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { StandaloneNavigationPending } from '@/components/navigation-pending'
import { firstAvailableBrand, requirePageSession } from '@/lib/dal'

export const instant = true

const HomeRedirect = async () => {
  const session = await requirePageSession()
  const brand = await firstAvailableBrand(session.user.id)

  if (brand === null) {
    redirect('/onboarding')
  }

  redirect(`/brands/${brand.id}/intent`)
}

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <StandaloneNavigationPending
          eyebrow="Private workspace"
          status="Taking you to your brand."
          title="Opening your workspace."
        />
      }
    >
      <HomeRedirect />
    </Suspense>
  )
}
