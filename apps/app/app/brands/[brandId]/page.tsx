import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { NavigationPending } from '@/components/navigation-pending'
import { requireBrandPageContext } from '@/lib/dal'

export const instant = true

interface BrandIndexPageProps {
  readonly params: Promise<{ readonly brandId: string }>
}

const BrandIndexRedirect = async ({ params }: BrandIndexPageProps) => {
  const { brandId } = await params
  await requireBrandPageContext(brandId)
  redirect(`/brands/${brandId}/today`)
}

export default function BrandIndexPage(props: BrandIndexPageProps) {
  return (
    <Suspense
      fallback={
        <NavigationPending
          eyebrow="Today"
          status="Opening Today."
          title="Opening Today."
        />
      }
    >
      <BrandIndexRedirect {...props} />
    </Suspense>
  )
}
