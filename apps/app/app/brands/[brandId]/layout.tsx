import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { AppShell } from '@/components/app-shell'
import { AppShellPending } from '@/components/navigation-pending'
import { AppAccessError, requireBrandPageContext } from '@/lib/dal'

export const instant = true

interface BrandLayoutProps {
  readonly children: React.ReactNode
  readonly params: Promise<{ readonly brandId: string }>
}

const BrandLayoutContent = async ({ children, params }: BrandLayoutProps) => {
  const { brandId } = await params
  try {
    const context = await requireBrandPageContext(brandId)
    return <AppShell context={context}>{children}</AppShell>
  } catch (error) {
    if (error instanceof AppAccessError) {
      notFound()
    }
    throw error
  }
}

export default function BrandLayout(props: BrandLayoutProps) {
  return (
    <Suspense fallback={<AppShellPending>{props.children}</AppShellPending>}>
      <BrandLayoutContent {...props} />
    </Suspense>
  )
}
