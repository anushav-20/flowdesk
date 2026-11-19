import PageHeader from '@/components/ui/PageHeader'
import FAQ from '@/features/marketing/FAQ'
import ComparisonTable from '@/features/pricing/ComparisonTable'
import PricingSection from '@/features/pricing/PricingSection'
import RoiCalculator from '@/features/pricing/RoiCalculator'
import useDocumentMeta from '@/hooks/useDocumentMeta'

export default function PricingPage() {
  useDocumentMeta({
    title: 'Pricing',
    description: 'Simple per-user pricing. Free for teams up to 5. Compare plans and calculate your ROI.',
  })

  return (
    <>
      <PageHeader
        eyebrow="Pricing"
        title="Plans for teams of every size"
        subtitle="Start free, upgrade when you grow. Use the calculator to see what FlowDesk is worth to your team."
      />
      <PricingSection id="plans" eyebrow="Plans" title="Choose your plan" />
      <RoiCalculator />
      <ComparisonTable />
      <FAQ />
    </>
  )
}
