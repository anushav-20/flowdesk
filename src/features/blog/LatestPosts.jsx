import Button from '@/components/ui/Button'
import Reveal from '@/components/ui/Reveal'
import SectionHeading from '@/components/ui/SectionHeading'
import useQuery from '@/hooks/useQuery'
import { getPosts, postsKey } from './blogService'
import PostCard, { PostSkeleton } from './PostCard'
import './Blog.css'

const params = { page: 1, limit: 3 }

/** Home page teaser: the 3 latest posts, loaded live from the API. */
export default function LatestPosts() {
  const { data, status, refetch } = useQuery(postsKey(params), () => getPosts(params))

  return (
    <section id="latest-posts" className="section" aria-labelledby="latest-title" aria-busy={status === 'loading'}>
      <div className="container">
        <SectionHeading
          id="latest-title"
          eyebrow="From the blog"
          title="Ideas for calmer, faster teams"
          subtitle="Loaded live from a REST API, with caching and an offline fallback."
        />

        {status === 'error' ? (
          <div className="blog__notice" role="alert">
            <p>We couldn't load the latest posts.</p>
            <Button variant="secondary" size="sm" iconLeft="refresh" onClick={refetch}>
              Try again
            </Button>
          </div>
        ) : (
          <>
            {data?.isFallback && (
              <p className="blog__notice" role="status">
                Showing saved posts — the live API couldn't be reached.
              </p>
            )}
            <div className="blog__grid">
              {status === 'loading'
                ? Array.from({ length: 3 }, (_, i) => <PostSkeleton key={i} />)
                : data.posts.map((post, i) => (
                    <Reveal key={post.id} delay={i * 120}>
                      <PostCard post={post} />
                    </Reveal>
                  ))}
            </div>
          </>
        )}

        <div className="blog__more">
          <Button to="/blog" variant="secondary" icon="arrowRight">
            Read all articles
          </Button>
        </div>
      </div>
    </section>
  )
}
