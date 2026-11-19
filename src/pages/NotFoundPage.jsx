import Button from '@/components/ui/Button'
import useDocumentMeta from '@/hooks/useDocumentMeta'

export default function NotFoundPage({ message = "The page you're looking for doesn't exist or has moved." }) {
  useDocumentMeta({ title: 'Page not found' })

  return (
    <section className="not-found container">
      <p className="not-found__code" aria-hidden="true">
        404
      </p>
      <h1>Page not found</h1>
      <p>{message}</p>
      <div className="not-found__actions">
        <Button to="/" iconLeft="arrowLeft">
          Back to home
        </Button>
        <Button to="/blog" variant="secondary">
          Read the blog
        </Button>
      </div>
    </section>
  )
}
