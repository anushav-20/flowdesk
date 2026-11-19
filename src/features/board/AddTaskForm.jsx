import { useState } from 'react'
import Button from '@/components/ui/Button'
import { boardActions, MAX_TITLE, PRIORITIES } from './boardStore'

export default function AddTaskForm({ onAnnounce }) {
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState('medium')
  const [error, setError] = useState('')

  const submit = (e) => {
    e.preventDefault()
    const clean = title.trim()
    if (!clean) {
      setError('Give the task a name first.')
      return
    }
    boardActions.add(clean, priority)
    onAnnounce(`Added "${clean}" to To do.`)
    setTitle('')
    setError('')
  }

  return (
    <form className="add-task" onSubmit={submit} noValidate>
      <div className="add-task__field">
        <label htmlFor="new-task" className="sr-only">
          New task name
        </label>
        <input
          id="new-task"
          value={title}
          maxLength={MAX_TITLE}
          placeholder="Add a task… e.g. Review pull request"
          onChange={(e) => {
            setTitle(e.target.value)
            if (error) setError('')
          }}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'new-task-error' : undefined}
        />
        {error && (
          <p id="new-task-error" className="add-task__error" role="alert">
            {error}
          </p>
        )}
      </div>
      <label htmlFor="new-task-priority" className="sr-only">
        Priority
      </label>
      <select id="new-task-priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
        {PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {p[0].toUpperCase() + p.slice(1)} priority
          </option>
        ))}
      </select>
      <Button type="submit" iconLeft="plus">
        Add task
      </Button>
    </form>
  )
}
