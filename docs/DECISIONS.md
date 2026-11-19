# Architecture Decision Records

Short records of the significant technical choices: the context, the decision, and its consequences. New decisions get appended; old ones are never rewritten (they're superseded instead).

---

## ADR-001: Plain CSS with design tokens, no UI or CSS framework

**Context.** The brief requires React, JavaScript and CSS. UI kits (MUI, Chakra) and utility frameworks (Tailwind) add bundle weight and hide the CSS skills being assessed.

**Decision.** Plain CSS files next to each component, BEM-style class names, and design tokens as CSS custom properties.

**Consequences.** + Zero CSS runtime, full control, theming through variables. − Class name discipline is manual; shared patterns (`.chip`, `.btn`) live in global or component CSS.

---

## ADR-002: Feature-based folder structure

**Context.** Grouping by type (`components/`, `containers/`, `utils/`) scatters one feature across many folders as the app grows.

**Decision.** `features/<name>/` holds a feature's UI, logic, service and tests. Generic code lives in `components/ui`, `hooks` and `lib`.

**Consequences.** + A feature can be understood, changed or deleted in one place. + Ownership is clear. − You have to decide whether code is "generic" or "feature" code (rule: move it to shared folders once a second feature needs it).

---

## ADR-003: A small custom store instead of Redux, Zustand or Context-only

**Context.** Global UI state (theme, billing, toasts) and the board need to be shared. Context re-renders every consumer on any change; Redux brings boilerplate and a dependency for a small app.

**Decision.** `lib/createStore.js`: a ~60-line store on `useSyncExternalStore` with reducers, selector subscriptions and opt-in versioned persistence.

**Consequences.** + Fine-grained re-renders, predictable reducer updates, no dependency, and concurrent-rendering safe. + The API matches Zustand/Redux closely, so migrating later is mechanical. − No devtools extension (could be added through the same `subscribe` API).

---

## ADR-004: Server state is separate from client state

**Context.** Data from the API needs caching, staleness, de-duplication and loading/error states, which a UI store doesn't provide.

**Decision.** `lib/queryCache.js` + `hooks/useQuery.js`, modelled on TanStack Query's ideas, keep server data apart from UI state.

**Consequences.** + Revisiting a page is instant, concurrent requests are shared, pagination doesn't flicker. − It's a subset of TanStack Query (no garbage collection, no background refetch on focus). **If the app grows, replace it with TanStack Query**; `useQuery`'s API was kept close to make that a drop-in change.

---

## ADR-005: URL is the source of truth for blog filters

**Context.** Search, tag and page could be component state.

**Decision.** Keep them in the query string (`/blog?q=react&page=2`), validated on read.

**Consequences.** + Shareable and bookmarkable views, refresh-safe, back/forward work, and the command menu can link straight to a search. − Values must be validated (unknown tags and bad page numbers are ignored).

---

## ADR-006: Graceful offline fallback for the blog

**Context.** The demo API is third-party. If it's unreachable, an empty blog looks broken.

**Decision.** On **network** failure only, return bundled posts flagged `isFallback`, and show an "Offline copy" badge. Real HTTP errors (4xx/5xx) are still shown as errors.

**Consequences.** + The site never looks broken because of a third party. − Fallback content can be stale; it's clearly labelled.

---

## ADR-007: Router mode is configurable per deployment

**Context.** Clean URLs need server rewrites. GitHub Pages has none, and sandboxed previews block URL changes.

**Decision.** `VITE_ROUTER_MODE` selects `browser`, `hash` or `memory` routing at build time; everything else stays the same.

**Consequences.** + One codebase deploys anywhere. − Hash URLs on GitHub Pages are less pretty and slightly worse for SEO, so Vercel or Netlify are recommended.

---

## ADR-008: Vitest + Testing Library + axe-core; oxlint + Prettier

**Context.** The project needs fast feedback and an objective quality bar.

**Decision.** Vitest (same config as Vite), Testing Library (tests what users see), axe-core for automated accessibility audits, oxlint (very fast, with React/hooks/a11y/import/Vitest rules) and Prettier. CI enforces all of them plus a coverage threshold.

**Consequences.** + The suite runs in seconds, and accessibility regressions fail CI. − jsdom can't check colour contrast, so contrast is verified manually and with Lighthouse.

---

## ADR-009: Domain logic in a shared, framework-free package

**Context.** The workspace has rules that must never disagree between client and server (permissions, dependency cycles, approvals, automation).

**Decision.** Put them in `/shared` as pure functions with no I/O, imported by the React app (`@shared`) and by the server.

**Consequences.** + One implementation, one test suite, and the demo behaves exactly like the real service. + Easy to port to TypeScript first. − `/shared` must stay free of browser- and Node-only APIs.

---

## ADR-010: A local-first demo engine alongside the real backend

**Context.** Reviewers should be able to try everything in seconds, but the project also needs a real backend.

**Decision.** The UI depends on an `api` contract. The default implementation runs in the browser; `VITE_WORKSPACE_API_URL` swaps in the REST + WebSocket implementation.

**Consequences.** + Zero-setup demo and real architecture in one codebase. − Two implementations of the contract to keep in step; mitigated by the shared domain logic and tests on both.

---

## ADR-011: PostgreSQL as the job queue

**Context.** Webhooks, digests and scheduled work need retries and must survive restarts.

**Decision.** A `jobs` table, claimed with an atomic conditional `UPDATE … WHERE status = 'queued'`, rather than adding Redis/BullMQ.

**Consequences.** + No extra infrastructure; jobs are enqueued in the same transaction as the change that caused them. − Lower throughput than a dedicated broker; at higher volume use `FOR UPDATE SKIP LOCKED` batches or move to a broker.

---

## ADR-012: Short-lived JWTs + rotating, hashed refresh tokens

**Context.** Pure JWTs can't be revoked; pure sessions need a lookup on every request.

**Decision.** 15-minute JWT access tokens (stateless checks) plus refresh tokens that are stored as SHA-256 hashes, rotated on every use, and grouped in a family. Reusing an old refresh token revokes the family.

**Consequences.** + Stolen refresh tokens are detected; logout is real. − The client must handle 401 → refresh → retry (done in `remote/remoteWorkspace.js`).

---

## ADR-013: One bootstrap endpoint for the workspace

**Context.** The workspace pages need many collections at once; dozens of requests on load is slow.

**Decision.** `GET /orgs/:id/bootstrap` returns everything the current user may see in one response (sensitive audit fields are removed for non-admins). WebSocket events trigger a debounced refresh.

**Consequences.** + Fast first load, simple client. − Payload grows with org size; next step is pagination or per-collection deltas.
