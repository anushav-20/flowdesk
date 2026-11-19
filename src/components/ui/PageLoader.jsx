/** Shown while a lazily loaded page's code is downloading. */
export default function PageLoader() {
  return (
    <div className="page-loader" role="status" aria-label="Loading page">
      <span className="page-loader__bar" />
    </div>
  )
}
