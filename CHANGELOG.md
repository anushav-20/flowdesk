# Changelog

All notable changes to this project are documented here. Format based on [Keep a Changelog](https://keepachangelog.com/).

## [3.1.0] – 2026-11-19

### Added

- Real GitHub integration: repository verified via the GitHub API, PRs and commits linked to tasks by key, PR status badges, configurable rules (opened → Review, merged → Completed), scheduled and manual sync; tokens encrypted at rest on the server
- Real Slack integration: connecting posts a test message; task completions and approval decisions are posted
- Automation triggers for approvals (requested / approved / rejected) and deadlines (due within 24 hours), with two example rules
- Consistent empty states with actions on Board, Dependencies, Docs, charts, webhooks and System health
- Readable field names and values in the audit change view

### Fixed

- Approvals page crashed in API mode (JSON fields returned as text by the bootstrap endpoint)
- Empty projects were reported as "Done" by the deadline prediction
- CORS in development now accepts any localhost port

## [3.0.0] – 2026-11-19

### Added

- **Workspace app at `/app`**: multi-tenant orgs with Owner/Admin/Member/Viewer roles, Kanban, calendar, dependency graph (cycle detection, critical path, deadline impact), docs with live co-editing, analytics, workload, activity and audit log with restore, approvals, automations, integrations, background jobs, observability dashboard
- AI assistant, AI task generator and smart deadline prediction
- Comments with mentions and attachments, smart notifications, focus mode with Pomodoro, gamification, recurring tasks, custom fields, saved searches, CSV/PDF/iCal export, keyboard shortcuts
- **Backend API** (`/server`): Node.js, Express 5, PostgreSQL, JWT with refresh-token rotation, zod validation, job queue with dead-letter, signed webhooks with SSRF protection, signed GitHub receiver, WebSockets, offline sync, OpenAPI spec, 30 API tests
- `/shared` domain logic used by both browser and server
- API mode for the frontend (`VITE_WORKSPACE_API_URL`), offline outbox, service worker
- Docker Compose (PostgreSQL + API + web), server Dockerfile, CI job against real PostgreSQL

## [2.1.0] – 2026-11-19

### Added

- Rename tasks inline on the board (double-click or Edit button; Enter saves, Escape cancels)
- "Recent activity" feed showing every status change on the board
- Stronger hero copy, a more prominent primary CTA and a trust note
- Link from home-page pricing to the full plan comparison and ROI calculator
- README: why I built it, screenshots and future improvements

## [2.0.0] – 2026-11-19

### Added

- Multi-page routing (Home, Pricing, Blog, Article, Contact, 404) with lazy-loaded pages
- Interactive Kanban board demo with drag and drop, keyboard alternatives and persistence
- Blog with live API data, debounced search, tag filters, pagination and URL-synced state
- Article pages with author and comments loaded in parallel, plus hover prefetching
- ROI calculator and plan comparison table on the pricing page
- Contact form with validation, error summary and bot protection
- ⌘K / Ctrl+K command menu
- Custom store (`createStore`), HTTP client with retry/timeout, query cache with `useQuery`
- 92 tests (unit, component, integration, axe accessibility) with a coverage gate
- CI pipeline, Docker image with nginx, SPA rewrites for Vercel/Netlify, configurable router mode
- Architecture docs, ADRs and a contributing guide

### Changed

- Reorganised the codebase into a feature-based structure
- Replaced React Context with selector-based stores to avoid unnecessary re-renders

## [1.0.0] – 2026-11-19

### Added

- Single-page responsive landing page with dark mode, animations, API-driven blog section and SEO tags
