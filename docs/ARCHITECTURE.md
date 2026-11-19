# Architecture

This document explains how FlowDesk is put together and why. The [README](../README.md) gives the overview; this is the deeper reference for someone about to change the code.

## 1. Goals

1. **Easy to change**: a new page, feature or API resource should touch as few files as possible.
2. **Predictable state**: every piece of state has one owner and one way to change it.
3. **Fast by default**: ship little JavaScript up front, avoid unnecessary renders and requests.
4. **Accessible and secure by default**: built into shared building blocks, not bolted on per page.
5. **Testable**: business logic is pure, and the UI is tested through what users see.

## 2. Layers

```
┌──────────────────────────────────────────────────────────────────────┐
│ app/          Shell: router, layout, error boundaries, route effects │
├──────────────────────────────────────────────────────────────────────┤
│ pages/        One per route. Set SEO meta, compose features. Thin.   │
├──────────────────────────────────────────────────────────────────────┤
│ features/     Product features: UI + feature logic + service + tests │
├──────────────────────────────────────────────────────────────────────┤
│ components/   Generic UI (Button, Card, FormField, Pagination…)       │
│ hooks/        Reusable React logic (useQuery, useForm, useHotkey…)    │
│ store/        Global app state                                       │
├──────────────────────────────────────────────────────────────────────┤
│ lib/          Framework-agnostic core: createStore, http,            │
│               queryCache, validators, storage, monitoring            │
│ config/       Validated environment config                           │
└──────────────────────────────────────────────────────────────────────┘
```

Dependencies point **downwards only**. `lib/` never imports from `features/`, and `components/ui` never imports from `features/`. `oxlint`'s `import/no-cycle` rule prevents circular imports.

## 3. Routing

`app/router.jsx` holds a single route table. The router type is chosen per deployment:

| Mode      | URL style       | Used for                                                          |
| --------- | --------------- | ----------------------------------------------------------------- |
| `browser` | `/pricing`      | Vercel, Netlify, Docker (they rewrite every path to `index.html`) |
| `hash`    | `/#/pricing`    | GitHub Pages (no rewrites available)                              |
| `memory`  | (no URL change) | Sandboxed previews/embeds                                         |

Every page except Home is **lazy-loaded** (`React.lazy`). `AppLayout` wraps the `<Outlet/>` in an `ErrorBoundary` (keyed by path, so an error resets when you navigate away) and a `Suspense` boundary that shows a thin loading bar.

`RouteEffects` handles what a multi-page site gets for free and an SPA doesn't:

- **Scroll**: to the top on a new page, or to `#section` targets. It waits for lazy sections to mount, giving up after 3s.
- **Focus**: moves to the new page's `<h1>`, so keyboard and screen-reader users start at the content.
- **Announcement**: a polite live region reads "Navigated to Pricing · FlowDesk".

## 4. State

### 4.1 Choosing where state lives

```
Is it data from the server? ──yes──▶ query cache (useQuery)
        │ no
Should it survive refresh / be shareable as a link? ──yes──▶ URL search params
        │ no
Is it needed by several unrelated components? ──yes──▶ a store (createStore)
        │ no
Local component state (useState / useReducer / useForm)
```

### 4.2 `createStore` (lib/createStore.js)

A small external store built on React 18+'s `useSyncExternalStore`:

```
component ──useStore(selector)──▶ subscribe() ◀── listeners notified ── dispatch(action)
                                                                          │
                                                       reducer(state, action) → new state
                                                                          │
                                                       (optional) persist slice to localStorage
```

- **Reducers** keep updates predictable and easy to test (`boardStore.test.js`).
- **Selectors** mean a component re-renders only when its slice changes.
- **Persistence** is opt-in, saves only the slice you choose, and is versioned, so a schema change can't load incompatible data.

### 4.3 Board state shape (normalised)

```js
{
  tasks:   { t1: { id, title, priority }, t2: {...} },  // data
  columns: { todo: ['t1','t2'], progress: [...], done: [...] }, // order
  filter:  'all'
}
```

Moving `t1` from _todo_ to _done_ creates new arrays for those two columns only; `progress` keeps its reference, so that column doesn't re-render. Each `TaskCard` subscribes to `tasks[id]` only.

## 5. Data flow for a request

Example: the user opens page 2 of the blog.

```
BlogPage
  └─ update({ page: 2 })                         → URL becomes /blog?page=2
  └─ useQuery('posts:::2:6', () => getPosts(...))
        ├─ cache fresh?          yes → return instantly, no request
        ├─ request in flight?    yes → share the same promise (de-duplication)
        └─ otherwise fetchQuery  → cache entry { status: 'loading' }
              └─ blogService.getPosts  → maps API → UI shape; offline → fallback posts
                    └─ http('/posts?limit=6&skip=6')  → timeout, retry with backoff on 5xx/network
        ◀─ cache entry { status: 'success', data } → subscribers re-render
  (meanwhile keepPreviousData shows page 1, dimmed, so the layout never jumps)
```

Hovering an article card calls `prefetchQuery('post:7')`, so the article is often already cached by the time the user clicks.

## 6. Forms

`useForm` gives each form the same behaviour:

1. No errors while the user first types.
2. Validate a field when it **loses focus**.
3. After that, re-validate it **live**, so the error disappears as soon as it's fixed.
4. On submit, validate everything, show the **error summary**, and **focus the first invalid field**.
5. Prevent double submits; expose a `status` of `idle | submitting | success | error`.

Validation rules are plain functions (`lib/validators.js`) composed into a schema (`contactSchema.js`). They're pure, so the same schema could validate on a server.

## 7. Styling

- **Design tokens** in `styles/variables.css`: colours, radii, shadows, motion. The dark theme overrides the same variables under `[data-theme='dark']`.
- **One CSS file per component**, placed next to it, with BEM-style class names (`plan__price`, `task--high`) to avoid collisions without a CSS-in-JS runtime.
- Fluid sizing with `clamp()`, mobile-first breakpoints at roughly 540 / 900 / 1000 px.
- Motion uses `transform` and `opacity` only, and is disabled under `prefers-reduced-motion`.

## 8. Error handling

| Failure                      | What the user sees                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| Render error in a page       | Page-level `ErrorBoundary` with "Try again" / "Reload page"; the navbar and footer stay usable |
| Lazy chunk fails to download | Same boundary                                                                                  |
| Router-level error           | `RouteError` screen                                                                            |
| API unreachable              | Blog shows bundled posts with an "Offline copy" badge                                          |
| API 4xx/5xx                  | Inline error with a **Try again** button (re-fetches)                                          |
| Article not found / bad id   | The 404 page                                                                                   |
| Form submit fails            | Inline error; the user's input is kept                                                         |

All errors go through `lib/monitoring.js` (`reportError`), the one place to connect Sentry or a similar service.

## 9. Testing strategy

```
           ▲  fewer, slower, more realistic
           │   Integration: full app + routes (App.test.jsx)
           │   Accessibility: axe-core audits
           │   Components: user-level behaviour (Testing Library)
           │   Hooks
           │   Unit: pure functions & reducers
           ▼  many, fast, precise
```

Only the network (`fetch`) is mocked. Each test starts with fresh stores, cache and `localStorage` (`src/test/setup.js`).

---

## Workspace app and backend (v3)

### Three layers, one set of rules

```
shared/          pure domain logic (no I/O): graph, automation, approvals, permissions, analytics, assistant, merge, jobs
   ▲        ▲
   │        └── server/       Express + PostgreSQL: the real multi-user service
   └─────────── src/workspace/engine/   in-browser engine for the zero-setup demo
```

Because the rules live in `shared/`, "a blocked task can't start", "a Viewer can't edit", "this dependency would create a cycle" and "tasks need approval before completion" behave identically in demo mode and API mode. They are tested once, in `shared/__tests__`.

### One API contract, two implementations

The UI never calls `fetch` directly. It calls `api.moveTask(id, status)`, `api.approvalAction(...)` and so on. `getWorkspace()` picks the implementation at start-up:

|           | `engine/` (demo mode)                                     | `remote/` (API mode)                 |
| --------- | --------------------------------------------------------- | ------------------------------------ |
| Storage   | Copy-on-write DB in `localStorage`                        | PostgreSQL via REST                  |
| Auth      | PBKDF2 hashes, per-tab session                            | JWT access + rotating refresh tokens |
| Real time | `BroadcastChannel` between tabs                           | WebSocket rooms per org              |
| Jobs      | In-tab runner                                             | Server worker                        |
| Webhooks  | Signed and logged (browser can't post to arbitrary hosts) | Real HTTP delivery with SSRF checks  |

Both expose the same store shape, so every page works unchanged in either mode.

### Request lifecycle on the server

```
HTTP request
  → helmet, CORS allow-list, rate limit, JSON body limit
  → requireAuth            (verify JWT)
  → requireMembership      (404 if the user isn't in this org — tenant isolation)
  → authorize('task:update') (shared/permissions.can)
  → validate(zodSchema)
  → withWrite(async (tx) => …)
        BEGIN
          change rows
          insert audit_logs (before/after)
          insert notifications
        COMMIT
        then publish events on the bus ──▶ automations (may write again, depth ≤ 3)
                                       ──▶ webhooks   (enqueued as jobs)
                                       ──▶ realtime   (pushed to the org's WebSocket room)
```

Events are published **after commit** so no listener ever sees data that was rolled back.

### Job queue

`jobs` table: `status` (queued → running → done | failed → dead), `priority`, `run_at`, `attempts`, `max_attempts`, `last_error`.

A worker claims a job with one statement:

```sql
UPDATE jobs SET status = 'running', locked_at = now(), attempts = attempts + 1
WHERE id = $1 AND status = 'queued'
RETURNING *
```

Only one worker can win that update, so jobs are never run twice. Failures are retried with exponential backoff (`shared/jobs.backoff`); after `max_attempts` the job moves to the dead-letter state and can be retried from the UI.

### Offline sync

In API mode, if a task edit fails because the network is down, the change is stored in an outbox (with the version the user started from) and applied optimistically. On `online`, the outbox is sent to `POST /orgs/:id/sync`. The server runs `mergeRecord(base, server, client)` per field: fields only the client changed are applied; fields both sides changed differently are reported as conflicts and the server value is kept. The user sees a toast with the result.

### Docs collaboration

Shared docs save with the version the editor started from. If someone else saved in between, the server runs a line-based **three-way merge** (`shared/merge.threeWayMerge`). Non-overlapping edits merge cleanly; overlapping ones get conflict markers and are counted in the response.
