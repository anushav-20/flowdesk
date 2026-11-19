/**
 * Builds a compact page list like [1, '…', 4, 5, 6, '…', 20].
 */
export function getPageItems(current, total, siblings = 1) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const start = Math.max(2, current - siblings)
  const end = Math.min(total - 1, current + siblings)
  const items = [1]
  if (start > 2) items.push('…')
  for (let i = start; i <= end; i++) items.push(i)
  if (end < total - 1) items.push('…')
  items.push(total)
  return items
}
