# Contributing

## Workflow

1. Create a branch from `main`: `feat/board-due-dates`, `fix/blog-pagination`, `docs/readme`.
2. Make your change with tests.
3. Run `npm run check`. It runs exactly what CI runs (lint, format, tests, build).
4. Open a pull request using the checklist below.

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `feat: add due dates to board tasks`, `fix: keep search input in sync with URL`.

## Where does my code go?

| You're adding…                             | Put it in                                                         |
| ------------------------------------------ | ----------------------------------------------------------------- |
| A new page / route                         | `src/pages/` + one line in `src/app/router.jsx`                   |
| A product feature                          | `src/features/<feature>/` (UI, logic, service and tests together) |
| A generic UI component used by 2+ features | `src/components/ui/`                                              |
| Reusable React logic                       | `src/hooks/`                                                      |
| Framework-agnostic logic (no JSX)          | `src/lib/`                                                        |
| Copy / content                             | `src/data/content.js`                                             |
| Colours, spacing, motion                   | `src/styles/variables.css`                                        |

## Conventions

- **Components**: function components, one per file, `PascalCase.jsx`, with their CSS next to them.
- **Imports**: use the `@/` alias for anything outside the current folder.
- **Logic**: keep business rules in pure functions and test them directly.
- **Network**: call APIs only through a service file that uses `lib/http`.
- **State**: follow the decision tree in `docs/ARCHITECTURE.md` §4.1.
- **Styling**: use tokens (`var(--brand)`), never hard-coded colours; BEM-style class names.
- **Accessibility**: every interactive element is reachable and usable by keyboard, has an accessible name, and has a visible focus state.

## Pull request checklist

- [ ] `npm run check` passes
- [ ] New logic has unit tests; new UI behaviour has component tests
- [ ] Works by keyboard only; tested with a screen reader for significant UI
- [ ] Works at 375px, 768px and 1440px, in light and dark mode
- [ ] No new `console.log`, secrets, or `dangerouslySetInnerHTML`
- [ ] Docs updated if behaviour or architecture changed
