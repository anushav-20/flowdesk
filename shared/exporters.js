/**
 * Export helpers: CSV (safe against spreadsheet formula injection) and iCalendar (.ics).
 */

/**
 * Cells starting with = + - @ (or tab/CR) are executed as formulas by Excel/Sheets.
 * Prefixing a quote neutralises them (OWASP "CSV injection").
 */
export function csvCell(value) {
  if (value == null) return ''
  let s = String(value)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`
  return s
}

/** @param {string[]} headers @param {any[][]} rows */
export function toCSV(headers, rows) {
  return [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')
}

const icsEscape = (s) =>
  String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/[,;]/g, (m) => `\\${m}`)

const icsDate = (iso) => iso.replace(/-/g, '')

/** Fold long lines at 75 octets as required by RFC 5545. */
const fold = (line) => line.match(/.{1,74}/g).join('\r\n ')

/**
 * Builds an iCalendar file of all-day events (task deadlines, meetings, milestones),
 * importable into Google Calendar, Outlook and Apple Calendar.
 * @param {{ uid: string, title: string, date: string, description?: string }[]} events
 */
export function toICS(events, { name = 'FlowDesk', now = new Date() } = {}) {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FlowDesk//Tasks//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${icsEscape(name)}`,
  ]
  for (const e of events) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date ?? '')) continue
    const end = new Date(`${e.date}T00:00:00Z`)
    end.setUTCDate(end.getUTCDate() + 1)
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}@flowdesk`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(e.date)}`,
      `DTEND;VALUE=DATE:${icsDate(end.toISOString().slice(0, 10))}`,
      fold(`SUMMARY:${icsEscape(e.title)}`),
      ...(e.description ? [fold(`DESCRIPTION:${icsEscape(e.description)}`)] : []),
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}
