// Runs before React loads so the correct theme is painted immediately (no flash).
;(function () {
  var theme
  try {
    var saved = JSON.parse(localStorage.getItem('flowdesk-app') || 'null')
    theme = saved && saved.state && saved.state.theme
  } catch {
    /* storage unavailable */
  }
  if (theme !== 'light' && theme !== 'dark') {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  document.documentElement.dataset.theme = theme
})()
