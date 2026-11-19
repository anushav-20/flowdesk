import { lazy, Suspense } from 'react'
import Features from '@/features/marketing/Features'
import Hero from '@/features/marketing/Hero'
import LogoStrip from '@/features/marketing/LogoStrip'
import useDocumentMeta from '@/hooks/useDocumentMeta'

// Above-the-fold sections load immediately; everything below is code-split.
const BoardDemo = lazy(() => import('@/features/board/BoardDemo'))
const HowItWorks = lazy(() => import('@/features/marketing/HowItWorks'))
const PricingSection = lazy(() => import('@/features/pricing/PricingSection'))
const Testimonials = lazy(() => import('@/features/marketing/Testimonials'))
const LatestPosts = lazy(() => import('@/features/blog/LatestPosts'))
const FAQ = lazy(() => import('@/features/marketing/FAQ'))
const Newsletter = lazy(() => import('@/features/newsletter/Newsletter'))

export default function HomePage() {
  useDocumentMeta({
    description:
      'FlowDesk is the all-in-one workspace for modern teams. Plan projects, track tasks and collaborate in real time — free for teams up to 5.',
  })

  return (
    <>
      <Hero />
      <LogoStrip />
      <Features />
      <Suspense fallback={<div className="section-fallback" aria-hidden="true" />}>
        <BoardDemo />
        <HowItWorks />
        <PricingSection showCompareLink />
        <Testimonials />
        <LatestPosts />
        <FAQ />
        <Newsletter />
      </Suspense>
    </>
  )
}
