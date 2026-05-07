# CLAUDE.md

Memory and conventions for this repo. Read this before making changes.

## What this app is

**Referat** — sanntids-møtetranskripsjon med AI-spørsmål, aksjons-/beslutnings-
ekstrahering og automatisk møtereferat. Norsk-først.

- **Stack**: Express + React (Vite) i monorepo-stil. TypeScript i alt.
- **Database**: Supabase Postgres via drizzle-orm
- **Auth**: Supabase Auth (epost/passord, Google, Microsoft)
- **Hosting**: Render (frontend + backend i samme service)
- **AI**: OpenAI (gpt-5 og whisper-1) + HuggingFace nb-whisper-medium/large

## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately — don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 3. Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes — don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests — then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

### Task Management
- **Plan First**: Write plan to `tasks/todo.md` with checkable items
- **Verify Plan**: Check in before starting implementation
- **Track Progress**: Mark items complete as you go
- **Explain Changes**: High-level summary at each step
- **Document Results**: Add review section to `tasks/todo.md`
- **Capture Lessons**: Update `tasks/lessons.md` after corrections

### Core Principles
- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.

## Repo-struktur

```
client/src/             React-frontend
  pages/login.tsx       OAuth + epost login
  pages/signup.tsx      Epost-registrering med verifisering
  pages/meeting.tsx     Hovedsiden — opptak, transkript, AI
  lib/supabase.ts       Supabase JS-klient (auth)
  lib/queryClient.ts    React Query + Authorization-header på alle requests
  App.tsx               Root + auth-state listener
server/                 Express-backend
  index.ts              Boot, middleware, statisk filserving
  auth.ts               JWT-validering med jose + JWKS
  storage.ts            Drizzle-queries, alle scoped på userId
  routes.ts             Alle /api/-endepunkter
  db.ts                 Postgres-pool
  env.ts                Validerer required env-vars ved boot
shared/schema.ts        Drizzle-schema + Zod-typer (delt klient/server)
script/build.ts         esbuild server + Vite client → dist/
docs/                   Reusable prompts og setup-guider
```

## Auth-arkitektur (les før du rører auth-kode)

**JWT-flyten**:
1. Frontend kaller `supabase.auth.signInWith*` → Supabase setter session i localStorage
2. Hvert API-kall henter `access_token` fra session og legger ved som
   `Authorization: Bearer <jwt>` (se [client/src/lib/queryClient.ts](client/src/lib/queryClient.ts))
3. Server-middleware [server/auth.ts](server/auth.ts) `requireAuth` validerer JWT
   lokalt med `jose` + remote JWKS (ECC P-256, ikke shared HS256-secret)
4. `req.user.id` blir tilgjengelig i protected routes via `getUserId(req)`

**Per-bruker datasikkerhet**:
- Hver "owned" tabell har `userId: uuid("user_id").notNull()`
- Hver storage-metode i [server/storage.ts](server/storage.ts) tar `userId` som
  første argument og legger `eq(table.userId, userId)` i `where`-clausen
- Hver protected route i [server/routes.ts](server/routes.ts) henter
  `const userId = getUserId(req)` ÅVERST i handleren, før storage-kall
- Det finnes ingen "global"-leseslige for bruker-data. Alt er user-scoped på
  storage-laget.

**Tabeller med user_id**:
meeting_sessions, meeting_series, meeting_documents, rule_documents,
extracted_rules, word_corrections, ai_preferences, summary_preferences,
feedback_log, summary_feedback. (`voice_profiles` er global, ubrukt.)

**Tabeller med UNIQUE user_id** (per-bruker upsert-mønster):
ai_preferences, summary_preferences

## Required env-vars

**På Render**:
- `DATABASE_URL` — Supabase pooler URI på port 5432 (session mode)
- `SUPABASE_URL` — `https://<ref>.supabase.co` (server-side JWKS-validering)
- `VITE_SUPABASE_URL` — samme verdi (Vite injecter på build-time)
- `VITE_SUPABASE_ANON_KEY` — publishable key fra Supabase API settings
- `OPENAI_API_KEY`
- `HUGGINGFACE_API_KEY`, `HF_NB_WHISPER_MEDIUM_URL`, `HF_NB_WHISPER_LARGE_URL`
- `DB_POOL_MAX=10`

**Sett av Render automatisk**: `NODE_ENV=production`, `PORT`

**Skal IKKE være satt**: `APP_PASSWORD_HASH`, `SESSION_SECRET`,
`SUPABASE_JWT_SECRET` (vi bruker JWKS, ikke shared secret)

## Rare ting i kodebasen

### Bundling-feller
- `script/build.ts` har en `allowlist` som esbuild-bundler. Pakker som leser
  filer via `__dirname` (f.eks. gammel `connect-pg-simple` med `table.sql`)
  knekker når de bundles. Hvis du legger til en pakke som leser ressursfiler,
  IKKE legg den i allowlisten — la den lastes fra `node_modules` runtime.

### Lydopptak
- Live opptak bruker AudioContext + ScriptProcessor for kontinuerlig PCM-fangst,
  encoder som WAV hvert 28. sekund, sender til `/api/transcribe` ([client/src/pages/meeting.tsx](client/src/pages/meeting.tsx) `flushPcmBuffer`)
- Tidligere brukte vi MediaRecorder med `stop()/start()` hvert 28. sekund —
  dette mistet ~50% av lyden pga. gap mellom recorders + WebM-fragment som
  startet mid-utterance og forvirret nb-whisper. AudioContext-pipelinen er
  rettelsen — IKKE bytt tilbake.
- Filopplasting (`/api/transcribe-file`) skriver til `uploads/audio-files/`
  midlertidig, slettes via `fs.unlinkSync` i både success- og error-stier.
  Lydfiler persisteres ALDRI.

### nb-whisper auto-fallback fjernet
- Tidligere falt `transcribeAudio` automatisk tilbake til OpenAI Whisper når
  nb-whisper feilet. Det skjulte at HF-endepunktene var pauset. Nå:
  ENDPOINT_PAUSED kastes som strukturert feil, klient viser actionable toast.
  Hvis du ser feilen igjen → start endepunktene på endpoints.huggingface.co.

### AI-prompt for aksjoner/beslutninger
- I [server/routes.ts](server/routes.ts) `combinedSystemPrompt`: aksjoner og
  beslutninger er gjensidig utelukkende. AI gjør først en REVIEW-PASS over
  eksisterende `proposed`-items mot full transkript, deretter NEW-PASS for
  nye. Items med status `approved`/`confirmed`/`rejected` er låst — kan ikke
  endres av AI. Klient-merge-løypa i [meeting.tsx](client/src/pages/meeting.tsx)
  hopper over ikke-`proposed` items.

### Dev-server gotcha
- `tsx` reloader IKKE server-kode automatisk når `routes.ts` endres. For å
  teste prompt-endringer lokalt må du restarte dev-serveren manuelt.
  Frontend-endringer reloades via Vite HMR.

## Eksterne ressurser

- **Supabase project**: https://supabase.com/dashboard/project/llrsxtypjmbczjljvppl
- **Render service**: https://dashboard.render.com/web/srv-d7ti6rkm0tmc73cpfpkg
- **GitHub**: https://github.com/bunger00/Referat
- **Live app**: https://referat-y767.onrender.com
- **Azure App registrations**: portal.azure.com → Referat (App ID `532cd138-4755-42ad-8f9b-ec5949c05cfc`)
- **Google Cloud Console**: prosjekt `mythic-display-495606-q5` (navn "Referat")
- **HuggingFace endpoints**: nb-whisper-medium og -large (krever resume hvis pauset)

## Hvis du skal sette opp auth fra null igjen

Se [docs/SUPABASE_AUTH_PROMPT.md](docs/SUPABASE_AUTH_PROMPT.md) — komplett
prompt + sjekkliste basert på fellene som ble gjort første gang.

## Build og test

```bash
npm run dev         # Dev-server (Express + Vite middleware) på port 5000
npm run build       # esbuild server + Vite client → dist/
npm run check       # tsc --noEmit
npm run db:push     # drizzle-kit push (apply schema changes)
npm start           # Production start (NODE_ENV=production node dist/index.cjs)
```

Render kjører `npm install --include=dev && npm run db:push && npm run build`
ved deploy. `--include=dev` er nødvendig fordi devDependencies (drizzle-kit,
esbuild, tsx, vite) brukes under bygg, og Render setter `NODE_ENV=production`
globalt som ellers ville hoppet over dem.

## Commit-stil

- Norsk i commit-meldinger
- 1-2 setninger om hva, deretter punktliste om hvordan om endringen er
  betydelig
- `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
  i co-author-tagg når Claude har bidratt
