/**
 * Conflict resolution for collaborative docs and offline sync.
 *
 * threeWayMerge: line-based merge of two edits made from the same base version
 * (the approach `git merge` uses, simplified). Non-overlapping edits merge
 * automatically; overlapping edits produce a conflict and keep both versions.
 */

/** Longest common subsequence table → list of matched index pairs. */
function lcsPairs(a, b) {
  const n = a.length
  const m = b.length
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const pairs = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j])
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++
    else j++
  }
  return pairs
}

/**
 * Aligns `other` to `base`: which base lines survive, and which new lines belong at each position.
 * New lines are anchored at the START of the gap they fill, so replacing line k is recorded at k —
 * not at k+1 — and doesn't collide with the other side appending after line k.
 */
function diffToBase(base, other) {
  const pairs = lcsPairs(base, other)
  const kept = new Array(base.length).fill(false)
  const inserted = Array.from({ length: base.length + 1 }, () => [])
  let oi = 0
  let gapStart = 0
  for (const [b, o] of pairs) {
    while (oi < o) inserted[gapStart].push(other[oi++])
    kept[b] = true
    oi = o + 1
    gapStart = b + 1
  }
  while (oi < other.length) inserted[gapStart].push(other[oi++])
  return { kept, inserted }
}

/**
 * @returns {{ merged: string, conflicts: number }}
 */
export function threeWayMerge(baseText, oursText, theirsText) {
  if (oursText === theirsText) return { merged: oursText, conflicts: 0 }
  if (oursText === baseText) return { merged: theirsText, conflicts: 0 }
  if (theirsText === baseText) return { merged: oursText, conflicts: 0 }

  const base = baseText.split('\n')
  const ours = diffToBase(base, oursText.split('\n'))
  const theirs = diffToBase(base, theirsText.split('\n'))
  const out = []
  let conflicts = 0

  for (let k = 0; k <= base.length; k++) {
    const a = ours.inserted[k]
    const b = theirs.inserted[k]
    if (a.length && b.length && a.join('\n') !== b.join('\n')) {
      conflicts++
      out.push('<<<<<<< your version', ...a, '=======', ...b, '>>>>>>> their version')
    } else {
      out.push(...(a.length ? a : b))
    }
    if (k < base.length) {
      // A base line survives only if neither side deleted/changed it
      if (ours.kept[k] && theirs.kept[k]) out.push(base[k])
    }
  }
  return { merged: out.join('\n'), conflicts }
}

/**
 * Optimistic concurrency for offline sync: a client mutation carries the version it was based on.
 * Field-level merge: fields only the client changed are applied; fields both changed differently → conflict (server wins).
 */
export function mergeRecord(base, client, server) {
  if (server.version === base.version)
    return { record: { ...server, ...diffFields(base, client), version: server.version + 1 }, conflicts: [] }
  const mine = diffFields(base, client)
  const theirs = diffFields(base, server)
  const conflicts = Object.keys(mine).filter(
    (k) => k in theirs && JSON.stringify(mine[k]) !== JSON.stringify(theirs[k]),
  )
  const applied = Object.fromEntries(Object.entries(mine).filter(([k]) => !conflicts.includes(k)))
  return { record: { ...server, ...applied, version: server.version + 1 }, conflicts }
}

function diffFields(a, b) {
  const out = {}
  for (const k of Object.keys(b)) {
    if (k === 'version' || k === 'updatedAt') continue
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out[k] = b[k]
  }
  return out
}
