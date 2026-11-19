import './Card.css'

/** Generic surface container. `interactive` adds the hover lift. */
export default function Card({
  as: Tag = 'div',
  interactive = false,
  highlight = false,
  className = '',
  children,
  ...rest
}) {
  const classes = ['card', interactive && 'card--interactive', highlight && 'card--highlight', className]
    .filter(Boolean)
    .join(' ')
  return (
    <Tag className={classes} {...rest}>
      {children}
    </Tag>
  )
}
