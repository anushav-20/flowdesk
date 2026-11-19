import './PageHeader.css'

/** Top banner for inner pages. Renders the page's single <h1>. */
export default function PageHeader({ eyebrow, title, subtitle, children }) {
  return (
    <header className="page-header">
      <div className="page-header__bg" aria-hidden="true" />
      <div className="container page-header__inner">
        {eyebrow && <p className="section-heading__eyebrow">{eyebrow}</p>}
        <h1 className="page-header__title">{title}</h1>
        {subtitle && <p className="page-header__subtitle">{subtitle}</p>}
        {children}
      </div>
    </header>
  )
}
