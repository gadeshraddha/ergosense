# M1: Foundation + Auth + App Shell

**Tool: Claude Code** (foundation mistakes cascade, so use your best tool)

## Paste this prompt
> Read CLAUDE.md and CONTEXT.md. Then implement docs/modules/M1-foundation-auth.md. First show me a short plan (the files you'll create) and wait for my OK. Then build it, run it, and tell me exactly how to start and test it. Update CONTEXT.md at the end.

## Goal
A clean project that boots both servers, with real accounts and a protected multi-page app shell. Nothing fake.

## Build
1. **Restructure** into the layout in CLAUDE.md. The old attempt's Python code is in `reference/qwen_old/`. Leave it there as reference only. Do not import from it yet.
2. **Backend:** FastAPI app factory, CORS for the Vite dev origin, `GET /api/health`, config via `.env` (see `.env.example`).
3. **Database (SQLAlchemy + SQLite):** models `User`, `Baseline`, `Sample`, `Event`, `WorkSession`, `UserSetting`. Every table except `User` has `user_id`. Create tables on startup.
4. **Auth:** `POST /api/auth/register`, `POST /api/auth/login` (returns JWT), `GET /api/auth/me`. bcrypt hashing, 12 h JWT, validate email and minimum password length. Provide a reusable `get_current_user` dependency.
5. **Frontend:** Vite + React + TS + Tailwind + React Router.
   - `Login` and `Register` pages: polished centered card with the ErgoSense wordmark, inline validation, API error messages, loading state.
   - `AuthContext` (token in localStorage), `ProtectedRoute`, auto-redirect to `/login` on 401.
6. **App shell:** collapsible sidebar (Dashboard, Posture, Lighting, Sessions, History, Alerts & Settings, Calibration), top bar with user menu + logout, light/dark toggle, mobile drawer. Every page is a clear placeholder titled with its module for now ("Coming in M4").
7. `scripts/run_dev` (`.bat` for Windows and `.sh`) starting backend and frontend. `README` quick-start.

## Acceptance (check these yourself)
- [ ] Backend starts with no errors; `/api/health` returns ok; `/docs` (Swagger) opens.
- [ ] Register → login → refresh the page → still logged in. Logout works.
- [ ] Opening `/dashboard` while logged out redirects to `/login`.
- [ ] Wrong password shows a clear error. Two users exist independently.
- [ ] A backend test covers register / login / me / 401.
- [ ] `grep -r "Math.random" frontend/src` finds nothing.

## Commit
`git add . && git commit -m "M1: foundation, auth, app shell" && git push`
