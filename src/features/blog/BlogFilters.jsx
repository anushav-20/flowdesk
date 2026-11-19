import { useId } from 'react'
import Icon from '@/components/ui/Icon'
import { blogTags } from '@/data/content'

/** Search box + tag chips. Fully controlled by the parent (state lives in the URL). */
export default function BlogFilters({ query, onQueryChange, tag, onTagChange }) {
  const searchId = useId()

  return (
    <div className="blog-filters">
      <form className="blog-filters__search" role="search" onSubmit={(e) => e.preventDefault()}>
        <label htmlFor={searchId} className="sr-only">
          Search articles
        </label>
        <Icon name="search" size={18} />
        <input
          id={searchId}
          type="search"
          value={query}
          maxLength={100}
          placeholder="Search articles…"
          autoComplete="off"
          onChange={(e) => onQueryChange(e.target.value)}
        />
        {query && (
          <button
            type="button"
            className="blog-filters__clear"
            onClick={() => onQueryChange('')}
            aria-label="Clear search"
          >
            <Icon name="close" size={16} />
          </button>
        )}
      </form>

      <div className="blog-filters__tags" role="group" aria-label="Filter by topic">
        <button
          type="button"
          className={`chip ${!tag ? 'is-active' : ''}`}
          aria-pressed={!tag}
          onClick={() => onTagChange('')}
        >
          All topics
        </button>
        {blogTags.map((t) => (
          <button
            key={t}
            type="button"
            className={`chip ${tag === t ? 'is-active' : ''}`}
            aria-pressed={tag === t}
            onClick={() => onTagChange(t)}
          >
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
    </div>
  )
}
