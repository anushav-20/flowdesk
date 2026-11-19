import { memo } from 'react'
import Icon from '@/components/ui/Icon'
import { selectActivity, useBoard } from './boardStore'

const timeFmt = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit' })

/** Shows the latest status changes on the board (add, move, rename, delete). */
function ActivityFeed() {
  const activity = useBoard(selectActivity)

  return (
    <section className="activity" aria-labelledby="activity-title">
      <h3 id="activity-title" className="activity__title">
        <Icon name="refresh" size={16} /> Recent activity
      </h3>
      {activity.length === 0 ? (
        <p className="activity__empty">Changes you make to the board will appear here.</p>
      ) : (
        <ol className="activity__list">
          {activity.map((a) => (
            <li key={a.id}>
              <span className="activity__text">{a.text}</span>
              {a.at > 0 && <time dateTime={new Date(a.at).toISOString()}>{timeFmt.format(a.at)}</time>}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

export default memo(ActivityFeed)
