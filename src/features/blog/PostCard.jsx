import { memo } from 'react'
import { Link } from 'react-router'
import Card from '@/components/ui/Card'
import Icon from '@/components/ui/Icon'
import { prefetchQuery } from '@/lib/queryCache'
import { getPost, postKey } from './blogService'

/** Start loading the article as soon as the user shows intent (hover/focus) → near-instant navigation. */
const prefetch = (id) => prefetchQuery(postKey(id), () => getPost(id))

function PostCard({ post, headingLevel: H = 'h3' }) {
  return (
    <Card as="article" interactive className="post">
      <p className="post__tag">{post.tags[0] ?? 'product'}</p>
      <H className="post__title">
        {/* Stretched link: the whole card is clickable but announced as a single link */}
        <Link
          to={`/blog/${post.id}`}
          className="post__link"
          onMouseEnter={() => prefetch(post.id)}
          onFocus={() => prefetch(post.id)}
        >
          {post.title}
        </Link>
      </H>
      <p className="post__excerpt">{post.excerpt}</p>
      <div className="post__meta">
        <span>{post.readTime} min read</span>
        <span className="post__stats">
          <span>
            <Icon name="heart" size={15} /> <span className="sr-only">Likes:</span> {post.likes}
          </span>
          <span>
            <Icon name="eye" size={15} /> <span className="sr-only">Views:</span> {post.views}
          </span>
        </span>
      </div>
    </Card>
  )
}

export default memo(PostCard)

export function PostSkeleton() {
  return (
    <Card className="post" aria-hidden="true">
      <span className="skeleton skeleton--tag" />
      <span className="skeleton skeleton--title" />
      <span className="skeleton skeleton--title short" />
      <span className="skeleton skeleton--text" />
      <span className="skeleton skeleton--text" />
      <span className="skeleton skeleton--text short" />
    </Card>
  )
}
