import { NAV } from '../nav'
import { Modal } from '../ui/primitives'
import { ui } from '../uiStore'

const GENERAL = [
  ['C', 'New task'],
  ['/', 'Search everything'],
  ['.', 'Open / close AI assistant'],
  ['F', 'Toggle focus mode'],
  ['?', 'Show this help'],
  ['Ctrl/⌘ K', 'Command menu (website)'],
  ['Esc', 'Close dialog'],
]

export default function ShortcutsDialog() {
  return (
    <Modal title="Keyboard shortcuts" onClose={() => ui.close('shortcuts')}>
      <div className="shortcuts">
        <section>
          <h3>General</h3>
          <dl>
            {GENERAL.map(([k, d]) => (
              <div key={k}>
                <dt>
                  <kbd>{k}</kbd>
                </dt>
                <dd>{d}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section>
          <h3>Go to (press G, then…)</h3>
          <dl>
            {NAV.flatMap((g) => g.items).map((i) => (
              <div key={i.to}>
                <dt>
                  <kbd>G</kbd> <kbd>{i.key.toUpperCase()}</kbd>
                </dt>
                <dd>{i.label}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </Modal>
  )
}
