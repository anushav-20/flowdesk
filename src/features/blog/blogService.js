import { http } from '@/lib/http'
import { fallbackAuthors, fallbackPosts } from './fallbackPosts'

/**
 * Blog data access. Components never see raw API responses — everything is
 * mapped into our own shapes here, so an API change only touches this file.
 */

export const PAGE_SIZE = 6
const FIELDS = 'title,body,tags,reactions,views,userId'

const words = (text) => text.trim().split(/\s+/).length

/** API post → the shape our UI uses */
export function toPostSummary(p) {
  return {
    id: String(p.id),
    title: p.title,
    excerpt: p.body.length > 150 ? `${p.body.slice(0, 150).trim()}…` : p.body,
    tags: p.tags ?? [],
    likes: p.reactions?.likes ?? 0,
    views: p.views ?? 0,
    readTime: Math.max(2, Math.round(words(p.body) / 40)),
  }
}

/** Only network failures (status 0) fall back to offline content. Real 4xx/5xx errors are surfaced. */
const isOffline = (err) => err?.status === 0

function filterFallback({ q, tag }) {
  return fallbackPosts.filter(
    (p) => (!q || `${p.title} ${p.body}`.toLowerCase().includes(q.toLowerCase())) && (!tag || p.tags.includes(tag)),
  )
}

/**
 * @param {{ q?: string, tag?: string, page?: number, limit?: number }} params
 * @returns {Promise<{ posts: ReturnType<typeof toPostSummary>[], total: number, page: number, pages: number, isFallback: boolean }>}
 */
export async function getPosts({ q = '', tag = '', page = 1, limit = PAGE_SIZE } = {}) {
  const skip = (page - 1) * limit
  const query = `limit=${limit}&skip=${skip}&select=${FIELDS}`
  const path = q
    ? `/posts/search?q=${encodeURIComponent(q)}&${query}`
    : tag
      ? `/posts/tag/${encodeURIComponent(tag)}?${query}`
      : `/posts?${query}`

  try {
    const data = await http(path)
    return {
      posts: data.posts.map(toPostSummary),
      total: data.total,
      page,
      pages: Math.max(1, Math.ceil(data.total / limit)),
      isFallback: false,
    }
  } catch (err) {
    if (!isOffline(err)) throw err
    const all = filterFallback({ q, tag })
    return {
      posts: all.slice(skip, skip + limit).map(toPostSummary),
      total: all.length,
      page,
      pages: Math.max(1, Math.ceil(all.length / limit)),
      isFallback: true,
    }
  }
}

/** A single post with its author and comments, fetched in parallel. */
export async function getPost(id) {
  if (String(id).startsWith('f')) return getFallbackPost(id)

  try {
    const post = await http(`/posts/${id}`)
    const [author, commentsRes] = await Promise.all([
      http(`/users/${post.userId}?select=firstName,lastName`).catch(() => null), // author is optional
      http(`/comments/post/${id}?limit=10`).catch(() => ({ comments: [] })),
    ])
    return {
      ...toPostSummary(post),
      body: post.body,
      author: author ? `${author.firstName} ${author.lastName}` : 'FlowDesk team',
      comments: (commentsRes.comments ?? []).map((c) => ({
        id: c.id,
        body: c.body,
        user: c.user?.fullName || c.user?.username || 'Reader',
        likes: c.likes ?? 0,
      })),
      isFallback: false,
    }
  } catch (err) {
    if (err.status === 404) err.message = 'Post not found'
    throw err
  }
}

function getFallbackPost(id) {
  const post = fallbackPosts.find((p) => p.id === id)
  if (!post) {
    const err = new Error('Post not found')
    err.status = 404
    throw err
  }
  const a = fallbackAuthors[post.userId]
  return {
    ...toPostSummary(post),
    body: post.body,
    author: `${a.firstName} ${a.lastName}`,
    comments: [],
    isFallback: true,
  }
}

export const postsKey = ({ q = '', tag = '', page = 1, limit = PAGE_SIZE }) => `posts:${q}:${tag}:${page}:${limit}`
export const postKey = (id) => `post:${id}`
