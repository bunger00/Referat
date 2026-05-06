# Møtetranskripsjonsapp

En norsk møtetranskripsjons-app som lytter live, transkriberer i sanntid,
foreslår spørsmål, fanger opp aksjonspunkter og beslutninger, sjekker mot
opplastede regelverk, og genererer ferdig møtereferat.

Stack: **React + Vite + TypeScript** (frontend), **Express + TypeScript**
(backend), **PostgreSQL + Drizzle ORM** (data), **OpenAI GPT-4o + Whisper**
(AI), valgfritt **NbAiLab nb-whisper** via HuggingFace for norsk
transkripsjon.

---

## Hurtigstart — lokal kjøring på Mac

### Forutsetninger

- **Node.js 20+** (`node -v`)
- **PostgreSQL 14+** (`psql --version`) — installer via Homebrew:
  ```bash
  brew install postgresql@16
  brew services start postgresql@16
  ```
- **ffmpeg** for splitting av store lydfiler (`ffmpeg -version`):
  ```bash
  brew install ffmpeg
  ```
- En **OpenAI API-nøkkel** ([platform.openai.com](https://platform.openai.com/api-keys))

### Oppsett (én gang)

```bash
# 1. Klon og installer
git clone https://github.com/bunger00/Referat.git
cd Referat
npm install

# 2. Opprett database
createdb referat

# 3. Lag .env med passord-hash + session-secret
cp .env.example .env
npm run setup        # spør om app-passord, genererer hash + secret

# 4. Åpne .env og fyll inn OPENAI_API_KEY
# (HuggingFace-feltene kan stå tomme — appen bruker OpenAI Whisper som fallback)

# 5. Push DB-skjema
npm run db:push

# 6. Start dev-server
npm run dev
```

Åpne <http://localhost:5000> og logg inn med passordet du valgte.

> **Mikrofon-tips:** `localhost` regnes som "secure context" av nettleseren,
> så mikrofonopptak fungerer. Hvis du tester fra et annet domene må det være
> HTTPS.

### Daglig bruk

```bash
npm run dev          # start utviklingsserveren med live reload
npm run check        # TypeScript-typesjekk
npm run db:push      # synkroniser DB-skjema etter endringer i shared/schema.ts
```

---

## Deploy til Render

Repoet er klargjort for Render via [`render.yaml`](render.yaml). Render
kjenner igjen denne fila og setter opp Postgres-database + web-tjeneste i én
operasjon.

### Steg-for-steg

1. **Push repoet til GitHub** (allerede gjort hvis du leser dette på
   <https://github.com/bunger00/Referat>).
2. **Logg inn på [Render](https://dashboard.render.com)** og velg
   **New → Blueprint**.
3. **Koble til repoet** `bunger00/Referat` og klikk *Apply*.
4. Render leser `render.yaml`, oppretter databasen `referat-db`, og bygger
   web-tjenesten `referat`.
5. **Sett de hemmelige variablene** (Render åpner et skjema for `sync: false`
   variabler):

   | Variabel | Hva | Hvor du får tak i den |
   |----------|-----|------------------------|
   | `APP_PASSWORD_HASH` | Bcrypt-hash av app-passordet | Kjør `npm run setup` lokalt og kopier verdien fra `.env` |
   | `OPENAI_API_KEY` | OpenAI API-nøkkel | <https://platform.openai.com/api-keys> |
   | `HUGGINGFACE_API_KEY` | (Valgfritt) HuggingFace-nøkkel | <https://huggingface.co/settings/tokens> |
   | `HF_NB_WHISPER_MEDIUM_URL` | (Valgfritt) Privat HF Inference Endpoint | HF Inference Endpoints UI |
   | `HF_NB_WHISPER_LARGE_URL` | (Valgfritt) Privat HF Inference Endpoint | HF Inference Endpoints UI |

6. **`SESSION_SECRET`** og **`DATABASE_URL`** settes automatisk av Render.
7. **Første deploy** kjører automatisk: `npm install && npm run db:push && npm run build`,
   deretter `npm start`. Helsejekk treffer `/api/health`.

### Etter deploy

- App-URL: `https://referat.onrender.com` (eller det Render gir deg)
- Helsejekk: `https://<din-app>.onrender.com/api/health`
- For å bytte passord: kjør `npm run setup` lokalt, kopier ny
  `APP_PASSWORD_HASH` til Render-dashboardet.

### Render free-tier — viktige forbehold

- **Web-tjenesten sover etter 15 min inaktivitet** og bruker ~30 sek på å
  våkne. For produksjonsbruk, oppgrader til *Starter* ($7/mnd).
- **Postgres free-tier slettes etter 90 dager.** Oppgrader til *Starter*
  ($7/mnd) for å beholde data permanent.
- **Filsystemet er flyktig.** Lydfiler i `uploads/` slettes ved hver deploy.
  Det er greit fordi de bare brukes midlertidig under transkripsjon — alt
  varig lagres i Postgres.
- **HuggingFace nb-whisper-endepunkter koster penger** når de kjører. Hvis
  du ikke bruker dem, la `HF_NB_WHISPER_*_URL` stå tomme — appen bruker
  OpenAI Whisper som er rimelig og krever ingen ekstra oppsett.

---

## Miljøvariabler

| Variabel | Påkrevd? | Beskrivelse |
|----------|----------|-------------|
| `DATABASE_URL` | **Ja** | Postgres connection string |
| `OPENAI_API_KEY` | **Ja** | OpenAI nøkkel for GPT-4o + Whisper-fallback |
| `APP_PASSWORD_HASH` | **Ja** (for login) | Bcrypt-hash. Genereres av `npm run setup` |
| `SESSION_SECRET` | Ja (for sikkerhet) | Hemmelig nøkkel for sesjons-cookies |
| `PORT` | Nei | Server-port (default 5000, settes av Render) |
| `NODE_ENV` | Nei | `development` eller `production` |
| `HUGGINGFACE_API_KEY` | Nei | Bare hvis du bruker nb-whisper |
| `HF_NB_WHISPER_MEDIUM_URL` | Nei | Privat HF Inference Endpoint |
| `HF_NB_WHISPER_LARGE_URL` | Nei | Privat HF Inference Endpoint |

Server logger ved oppstart hvilke variabler som er satt. Hvis `DATABASE_URL`
eller `OPENAI_API_KEY` mangler, avbrytes oppstarten med tydelig feilmelding.

---

## Arkitektur (kortversjon)

```
client/src/        React-app (Vite)
  pages/meeting.tsx    hovedsiden (transkript, spørsmål, aksjoner, beslutninger)
  pages/login.tsx      enkel passord-login
  components/ui/       shadcn/ui-komponenter

server/
  index.ts             oppstart, sesjon, /api/health
  routes.ts            alle API-endepunkter (transcribe, analyze, summary, ...)
  storage.ts           database-laget (Drizzle)
  db.ts                Postgres-pool
  static.ts            statisk filserving i prod
  vite.ts              Vite-middleware i dev

shared/schema.ts       Drizzle-tabeller + Zod-skjemaer (delt mellom front og back)

script/
  build.ts             kompiler klient (Vite) + server (esbuild → CJS)
  setup.ts             generer APP_PASSWORD_HASH + SESSION_SECRET interaktivt

render.yaml            Render Blueprint
```

### API-endepunkter

| Endepunkt | Metode | Beskrivelse |
|-----------|--------|-------------|
| `/api/health` | GET | Helsejekk (DB + AI-konfig) |
| `/api/auth/login` | POST | Logg inn med passord |
| `/api/auth/logout` | POST | Logg ut |
| `/api/auth/session` | GET | Sjekk om innlogget |
| `/api/transcribe` | POST | Transkriber lyd-chunk |
| `/api/transcribe-file` | POST | Transkriber opplastet fil |
| `/api/analyze` | POST | Generer spørsmål + aksjoner + beslutninger |
| `/api/summary` | POST | Generer møtereferat |
| `/api/sessions` | GET/POST/PATCH/DELETE | CRUD for lagrede møter |
| `/api/series` | GET/POST/PATCH/DELETE | Møteserier |
| `/api/rules/*` | flere | Regeldokumenter |
| `/api/meeting-documents/*` | flere | Møtedokumenter (kunnskapsbase) |
| `/api/word-corrections` | GET/POST/DELETE | Custom vokabular |
| `/api/feedback`, `/api/learning/*` | flere | Selvlærende AI |

Alle ruter unntatt `/api/auth/*` og `/api/health` krever innlogging.

---

## Kjente begrensninger og fremtidig arbeid

- **`server/routes.ts` er 2500+ linjer** — bør splittes i moduler.
- **`client/src/pages/meeting.tsx` er 5700+ linjer** — bør splittes i
  komponenter.
- **Ingen tester.** Manuell testing kun.
- **Rate limiting mangler.** Innlogget bruker kan i prinsippet brenne mye
  OpenAI-kvote. Vurder `express-rate-limit` på `/api/analyze`,
  `/api/transcribe-file` og `/api/summary`.
- **Ingen migrasjonshistorikk.** `drizzle-kit push` brukes direkte mot
  databasen — fint i utvikling, men du burde bruke `drizzle-kit generate` +
  `drizzle-kit migrate` for produksjon.

---

## Lisens

MIT.
