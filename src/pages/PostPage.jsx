import { Link, useParams } from 'react-router'
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import { getPost, postKey } from '@/features/blog/blogService'
import useDocumentMeta from '@/hooks/useDocumentMeta'
import useQuery from '@/hooks/useQuery'
import NotFoundPage from './NotFoundPage'
import '@/features/blog/Blog.css'
import './PostPage.css'

/** Accept only ids we know how to fetch (numbers, or offline ids like "f3"). Never send arbitrary input to the API. */
const VALID_ID = /^(\d{1,6}|f\d{1,2})$/

function PostSkeletonView() {
  return (
    <div className="article article--loading container" aria-busy="true" aria-label="Loading article">
      <span className="skeleton skeleton--tag" />
      <span className="skeleton skeleton--h1" />
      <span className="skeleton skeleton--h1 short" />
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className="skeleton skeleton--text" />
      ))}
    </div>
  )
}

export default function PostPage() {
  const { postId } = useParams()
  const valid = VALID_ID.test(postId ?? '')
  const { data: post, status, error, refetch } = useQuery(valid ? postKey(postId) : null, () => getPost(postId))

  useDocumentMeta({
    title: post?.title ?? 'Article',
    description: post?.excerpt,
  })

  if (!valid || error?.status === 404) return <NotFoundPage message="We couldn't find that article." />
  if (status === 'loading') return <PostSkeletonView />

  if (status === 'error') {
    return (
      <div className="container article" role="alert">
        <h1>Couldn't load this article</h1>
        <p className="article__lead">Check your connection and try again.</p>
        <Button iconLeft="refresh" onClick={refetch}>
          Try again
        </Button>
      </div>
    )
  }

  return (
    <article className="article container">
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <ol>
          <li>
            <Link to="/">Home</Link>
          </li>
          <li>
            <Link to="/blog">Blog</Link>
          </li>
          <li aria-current="page">{post.title}</li>
        </ol>
      </nav>

      <ul className="article__tags" aria-label="Topics">
        {post.tags.map((t) => (
          <li key={t}>
            <Link to={`/blog?tag=${encodeURIComponent(t)}`} className="post__tag">
              {t}
            </Link>
          </li>
        ))}
      </ul>

      <h1 className="article__title">{post.title}</h1>

      <div className="article__meta">
        <span className="article__avatar" aria-hidden="true">
          {post.author
            .split(' ')
            .map((n) => n[0])
            .join('')}
        </span>
        <span>
          By <strong>{post.author}</strong> · {post.readTime} min read
        </span>
        <span className="article__stats">
          <Icon name="heart" size={16} /> {post.likes} <span className="sr-only">likes</span>
          <Icon name="eye" size={16} /> {post.views} <span className="sr-only">views</span>
        </span>
      </div>

      {/* Rendered as text through JSX → automatically escaped (no XSS risk from API content) */}
      <div className="article__body">
        <p>{post.body}</p>
      </div>

      <section className="comments" aria-labelledby="comments-title">
        <h2 id="comments-title">
          <Icon name="message" size={20} /> Comments ({post.comments.length})
        </h2>
        {post.comments.length === 0 ? (
          <p className="comments__empty">No comments yet.</p>
        ) : (
          <ul>
            {post.comments.map((c) => (
              <li key={c.id} className="comment">
                <span className="comment__avatar" aria-hidden="true">
                  <Icon name="user" size={18} />
                </span>
                <div>
                  <p className="comment__user">{c.user}</p>
                  <p>{c.body}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Button to="/blog" variant="secondary" iconLeft="arrowLeft">
        Back to all articles
      </Button>
    </article>
  )
}
