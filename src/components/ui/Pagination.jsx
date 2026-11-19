import { getPageItems } from '@/lib/pagination'
import Icon from './Icon'
import './Pagination.css'

export default function Pagination({ page, pages, onChange, label = 'Pagination' }) {
  if (pages <= 1) return null
  const items = getPageItems(page, pages)

  return (
    <nav className="pagination" aria-label={label}>
      <button type="button" onClick={() => onChange(page - 1)} disabled={page === 1} aria-label="Previous page">
        <Icon name="arrowLeft" size={18} />
      </button>
      <ul>
        {items.map((item, i) =>
          item === '…' ? (
            <li key={`gap-${i}`} aria-hidden="true" className="pagination__gap">
              …
            </li>
          ) : (
            <li key={item}>
              <button
                type="button"
                className={item === page ? 'is-active' : ''}
                aria-current={item === page ? 'page' : undefined}
                aria-label={`Page ${item}`}
                onClick={() => onChange(item)}
              >
                {item}
              </button>
            </li>
          ),
        )}
      </ul>
      <button type="button" onClick={() => onChange(page + 1)} disabled={page === pages} aria-label="Next page">
        <Icon name="arrowRight" size={18} />
      </button>
    </nav>
  )
}
