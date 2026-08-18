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
  redirect(`/brands/${brandId}/intent`)
}

export default function BrandIndexPage(props: BrandIndexPageProps) {
  return (
    <Suspense
      fallback={
        <NavigationPending
          eyebrow="Intent register"
          status="Apertura del registro Intent."
          title="Apro gli Intent."
        />
      }
    >
      <BrandIndexRedirect {...props} />
    </Suspense>
  )
}
