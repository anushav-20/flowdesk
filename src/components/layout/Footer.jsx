import { Link } from 'react-router'
import { footerLinks } from '@/data/content'
import Logo from '../ui/Logo'
import './Footer.css'

const YEAR = new Date().getFullYear()

export default function Footer() {
  return (
    <footer className="footer" aria-labelledby="footer-heading">
      <h2 id="footer-heading" className="sr-only">
        Footer
      </h2>
      <div className="container footer__grid">
        <div className="footer__brand">
          <Logo />
          <p>The calm, all-in-one workspace for teams that ship.</p>
        </div>

        {footerLinks.map((col) => (
          <nav key={col.heading} aria-label={col.heading} className="footer__col">
            <h3>{col.heading}</h3>
            <ul>
              {col.links.map((link) => (
                <li key={link.label}>
                  <Link to={link.to}>{link.label}</Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="container footer__bottom">
        <p>© {YEAR} FlowDesk — a demo product. Built with React.</p>
        <p className="footer__hint">
          Tip: press <kbd>Ctrl</kbd> + <kbd>K</kbd> to open the command menu
        </p>
      </div>
    </footer>
  )
}
