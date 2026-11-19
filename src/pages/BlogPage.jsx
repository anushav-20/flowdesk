import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import Button from '@/components/ui/Button'
import PageHeader from '@/components/ui/PageHeader'
import Pagination from '@/components/ui/Pagination'
import BlogFilters from '@/features/blog/BlogFilters'
import { getPosts, postsKey } from '@/features/blog/blogService'
import PostCard, { PostSkeleton } from '@/features/blog/PostCard'
import useDebounce from '@/hooks/useDebounce'
import useDocumentMeta from '@/hooks/useDocumentMeta'
import useQuery from '@/hooks/useQuery'
import '@/features/blog/Blog.css'

const SAFE_TAG = /^[a-z][a-z-]{0,29}$/

/** Reads + validates filters from the URL, so every view is shareable and survives refresh. */
function useBlogParams() {
  const [params, setParams] = useSearchParams()
  const q = (params.get('q') ?? '').slice(0, 100)
  const rawTag = params.get('tag') ?? ''
  const tag = SAFE_TAG.test(rawTag) ? rawTag : '' // validate, never pass raw URL input to the API
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1)

  const update = (next) => {
    const merged = { q, tag, page, ...next }
    const out = {}
    if (merged.q) out.q = merged.q
    if (merged.tag) out.tag = merged.tag
    if (merged.page > 1) out.page = String(merged.page)
    setParams(out, { replace: 'q' in next }) // typing shouldn't flood browser history
  }

  return { q, tag, page, update }
}

export default function BlogPage() {
  useDocumentMeta({
    title: 'Blog',
    description: 'Articles on productivity, planning and teamwork from the FlowDesk team.',
  })

  const { q, tag, page, update } = useBlogParams()
  const [query, setQuery] = useState(q)
  const debouncedQuery = useDebounce(query.trim(), 400)
  const resultsRef = useRef(null)

  // Keep the input in sync if the URL changes from outside (back/forward buttons, command menu)
  const [lastUrlQuery, setLastUrlQuery] = useState(q)
  if (q !== lastUrlQuery) {
    setLastUrlQuery(q)
    if (q !== query.trim()) setQuery(q)
  }

  // Push the debounced search term into the URL (search and tag are mutually exclusive in the API)
  useEffect(() => {
    if (debouncedQuery !== q) update({ q: debouncedQuery, tag: debouncedQuery ? '' : tag, page: 1 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery])

  const params = { q, tag, page }
  const { data, status, error, isFetching, isPreviousData, refetch } = useQuery(
    postsKey(params),
    () => getPosts(params),
    {
      keepPreviousData: true,
    },
  )

  const goToPage = (p) => {
    update({ page: p })
    resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const summary =
    status === 'success'
      ? `${data.total} article${data.total === 1 ? '' : 's'}${q ? ` matching “${q}”` : ''}${tag ? ` tagged ${tag}` : ''}`
      : ''

  return (
    <>
      <PageHeader
        eyebrow="Blog"
        title="Ideas for calmer, faster teams"
        subtitle="Search and filter live articles from a REST API. Filters are kept in the URL, so any view can be bookmarked or shared."
      />

      <section className="section section--tight" aria-label="Articles">
        <div className="container">
          <BlogFilters
            query={query}
            onQueryChange={setQuery}
            tag={tag}
            onTagChange={(t) => {
              setQuery('')
              update({ tag: t, q: '', page: 1 })
            }}
          />

          <div ref={resultsRef} className="blog__results-head">
            <p role="status" aria-live="polite">
              {isFetching && !data ? 'Loading articles…' : summary}
            </p>
            {data?.isFallback && <span className="blog__badge">Offline copy</span>}
          </div>

          {status === 'error' && (
            <div className="blog__notice blog__notice--error" role="alert">
              <p>{error?.message || 'Something went wrong while loading articles.'}</p>
              <Button variant="secondary" size="sm" iconLeft="refresh" onClick={refetch}>
                Try again
              </Button>
            </div>
          )}

          {status === 'loading' && (
            <div className="blog__grid" aria-busy="true">
              {Array.from({ length: 6 }, (_, i) => (
                <PostSkeleton key={i} />
              ))}
            </div>
          )}

          {status === 'success' && data.posts.length === 0 && (
            <div className="blog__empty">
              <h2>No articles found</h2>
              <p>Try a different search term or topic.</p>
              <Button
                variant="secondary"
                onClick={() => {
                  setQuery('')
                  update({ q: '', tag: '', page: 1 })
                }}
              >
                Clear filters
              </Button>
            </div>
          )}

          {status === 'success' && data.posts.length > 0 && (
            <>
              <div className={`blog__grid ${isPreviousData ? 'is-stale' : ''}`} aria-busy={isFetching}>
                {data.posts.map((post) => (
                  <PostCard key={post.id} post={post} headingLevel="h2" />
                ))}
              </div>
              <Pagination page={page} pages={data.pages} onChange={goToPage} label="Blog pages" />
            </>
          )}
        </div>
      </section>
    </>
  )
}
