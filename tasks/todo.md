# Erfaringsmøter + RAG-hjerne (MVP)

**Branch**: `claude/erfaringsmoter-mvp` (off main, etter at RLS-PR-en er merget)
**Scope**: Ny tredje modul ("erfaringsmøter") som transkriberer reflekterende
møter, ekstraherer lærdommer ved møteslutt, og bygger en RAG-aktivert "hjerne"
som brukeren kan chatte med på tvers av alle sine møtedata og dokumenter.

## Avtalte beslutninger (fra avklaringsrunde)

| Spørsmål | Svar |
|---|---|
| Granularitet | AI velger per case (korte kort + tematiske blokker) |
| Lesere | Både AI og mennesker (lesbar form + retrieval) |
| Lagring | Ny `lessons_learned`-tabell (ikke gjenbruk extracted_rules) |
| Inngang | Helt egen side `/erfaring` |
| Ekstraksjon | Kun ved møteslutt (ingen live forslag) |
| Kategorisering | Erstattes av RAG-embeddings |
| RAG-bruk i MVP | Kun chat-grensesnitt mot hjernen |
| Kilder | Lessons + referater + regler + transkripter + ad-hoc opplastede filer |

## Ufravikelig (per CLAUDE.md)

- Ikke rør AudioContext-pipelinen
- Ikke rør JWT/JWKS-auth
- Ikke rør `script/build.ts` allowlist
- Alle nye tabeller scopes på `userId`
- RLS auto-aktiveres via eksisterende `apply-rls.ts`

---

## 1. Database

### 1.1 Postgres-extensions
- [ ] Utvid `script/apply-rls.ts` (eller eget script) til å også kjøre `CREATE EXTENSION IF NOT EXISTS vector` ved deploy

### 1.2 Nye tabeller (`shared/schema.ts`)

**`experience_sessions`** (separat fra meeting_sessions for renere semantikk):
- id, userId, title, startedAt, endedAt, elapsedSeconds, transcript (jsonb),
  speakerMappings (jsonb), userNotes (text), lessonsExtractedAt (timestamp)

**`lessons_learned`**:
- id, userId, sessionId (fk experience_sessions, nullable), title, problem,
  solution, context, type ('short' | 'thematic'), tags (text[]),
  relatedScreenshotIds (integer[]), relatedDocumentIds (integer[]), createdAt

**`knowledge_chunks`** (RAG-hjernen):
- id, userId, sourceType, sourceId, sourceName, content (text),
  embedding (vector(1536)), metadata (jsonb), createdAt
- sourceType ∈ 'lesson' | 'meeting_summary' | 'meeting_transcript' |
  'experience_transcript' | 'rule' | 'uploaded_doc' | 'uploaded_image'

### 1.3 Indexes
- HNSW index på `knowledge_chunks.embedding` for fast cosine similarity
- B-tree på userId for alle tre

---

## 2. Backend

### 2.1 Embedding-tjeneste (`server/lib/embeddings.ts`)
- [ ] Wrapper rundt OpenAI text-embedding-3-small
- [ ] Batch-embedding (kostnadseffektivt)
- [ ] Chunker: ~500 ord med 50-ord overlap

### 2.2 Knowledge-pipeline (`server/lib/knowledge.ts`)
- [ ] `ingestLesson(userId, lesson)`
- [ ] `ingestMeetingSummary(userId, sessionId)` (backfill)
- [ ] `ingestRule(userId, ruleId)` (backfill)
- [ ] `ingestTranscriptChunks(userId, sessionId, sourceType, segments)`
- [ ] `ingestUploadedFile(userId, file, type)` — pdf-parse / mammoth / xlsx / vision
- [ ] `searchKnowledge(userId, query, topK=8)` — embed + cosine similarity

### 2.3 Endepunkter
- [ ] `server/routes/experience.ts`: CRUD + extract for experience_sessions
- [ ] `server/routes/lessons.ts`: CRUD for lessons_learned
- [ ] `server/routes/brain.ts`: chat + upload + backfill
  - `POST /api/brain/chat` — streamet svar med kilder
  - `POST /api/brain/upload` — ad-hoc fil-ingestion
  - `POST /api/brain/backfill` — idempotent ingestion av eksisterende data

### 2.4 AI-prompts
- [ ] `server/lib/lesson-extractor.ts` — ekstraksjon ved møteslutt → JSON-array av lærdommer
- [ ] `server/lib/brain-chat.ts` — RAG-prompt med kontekst-formatering + kildehenvisninger

---

## 3. Frontend

### 3.1 `/erfaring` (`client/src/pages/experience.tsx`)
- [ ] Gjenbruk LiveTranscript + opptaks-bottombar fra `meeting.tsx`
- [ ] Ingen AI-arbeidsbenk under opptak (kun transkript + skjermbilde-pane)
- [ ] Topbar: tittel + timer + "Avslutt og ekstraher lærdommer"
- [ ] Lærdom-godkjenningspanel etter ekstraksjon (rediger inline, godkjenn/avvis)
- [ ] `client/src/components/experience/LessonProposalCard.tsx`

### 3.2 `/hjernen` (`client/src/pages/brain.tsx`)
- [ ] Chat-grensesnitt med meldingsliste + input
- [ ] Streaming via fetch + ReadableStream
- [ ] Kilde-kort under svar (klikkbare → opphavs-møte/dokument)
- [ ] Empty state med eksempel-spørsmål

### 3.3 `/kunnskapsbase` (utvidelse)
- [ ] Ny tab "Lærdommer" (søk + slett)
- [ ] "Last opp i hjernen"-knapp (PDF/Word/Excel/bilde)

### 3.4 Routing + navigasjon
- [ ] App.tsx: nye ruter `/erfaring`, `/e/:id`, `/hjernen`
- [ ] Sidebar: to nye lenker
- [ ] Home: to nye CTA-kort

---

## 4. Verifisering

- [ ] `npm run check` passerer
- [ ] `npm run build` passerer
- [ ] Lokal røyk-test: erfaringsmøte → lærdommer ekstrahert
- [ ] Lokal røyk-test: spør hjernen → svar med kilder
- [ ] Lokal røyk-test: PDF-upload → spør om innhold → svar
- [ ] Eksisterende møtereferat- og intervju-funksjonalitet urørt

---

## 5. Tilbakerullingsplan

Alle endringer i nye filer + nye tabeller. Eksisterende kode minimalt rørt.
En `git revert` på MVP-commiten ruller tilbake alt uten å påvirke produksjon.
Knowledge_chunks-tabellen blir bare stående tom — ingen data tapt.

---

## 6. Estimat

~1.5 dag fokusert arbeid:
- Schema + embeddings + knowledge-lib: ~2t
- Backend endpoints (experience + lessons + brain): ~4t
- /erfaring side: ~3t
- /hjernen side: ~2t
- Kunnskapsbase-utvidelse: ~1t
- Test + polish: ~2t

---

## Review

### Hva ble levert (MVP)

**Fase 1 — Schema + RAG-grunnmur**
- ✓ `shared/schema.ts`: 3 nye tabeller (`experience_sessions`,
  `lessons_learned`, `knowledge_chunks` med pgvector(1536)).
- ✓ `script/apply-extensions.ts`: idempotent oppsett av `vector`-extension
  og HNSW-indeks med `vector_cosine_ops` på `knowledge_chunks.embedding`.
  Hektet på `npm run db:push`.
- ✓ `server/lib/embeddings.ts`: OpenAI text-embedding-3-small wrapper med
  batch-støtte (100 inputs per request), word-basert chunker (~500 ord,
  50 overlap), kostnads-tracking i `ai_usage_log`.
- ✓ `server/lib/knowledge.ts`: lavnivå `ingestText` med idempotent
  re-ingestion (sletter eksisterende chunks før insert), domene-wrappers
  (`ingestLesson`, `ingestMeetingSummary`, `ingestMeetingTranscript`,
  `ingestRule`), og `searchKnowledge` med Drizzle `cosineDistance`-helper.

**Fase 2 — Backend-endepunkter**
- ✓ `server/routes/experience.ts`: CRUD + `POST /:id/extract` som kjører
  AI-ekstraksjon og samtidig ingester rå-transkriptet (best-effort) til
  RAG-hjernen.
- ✓ `server/routes/lessons.ts`: CRUD med auto-embedding ved insert/update
  (best-effort, ikke-blokkerende).
- ✓ `server/routes/brain.ts`: chat (RAG over knowledge_chunks),
  upload (PDF/Word/bilde/tekst, vision-pipeline for bilder), backfill
  (idempotent ingestion av eksisterende referater + lærdommer).
- ✓ `server/lib/lesson-extractor.ts`: AI-prompt på norsk som returnerer
  JSON-strukturert `ProposedLesson[]` med per-case granularitet.
- ✓ `server/lib/brain-chat.ts`: RAG-prompt med eksplisitte [Kilde N]-
  referanser og når-i-tvil-si-jeg-vet-ikke-instruks.
- ✓ Storage utvidet med eksperience_sessions + lessons_learned CRUD.

**Fase 3 — Frontend**
- ✓ `/erfaring`: liste + start-nytt-flyt. Hver session har upload-audio,
  manuell tekst-input, redigerbar tittel/transkript, inline-godkjenning
  av AI-foreslåtte lærdommer.
- ✓ `/hjernen`: chat-grensesnitt med kilder + eksempel-spørsmål +
  upload-kort + backfill-knapp.
- ✓ Sidebar og MobileNav fikk to nye lenker. Hjemmesiden fikk
  "Erfaring og kunnskap"-seksjon.
- ✓ Routing: `/erfaring`, `/erfaring/:id`, `/hjernen` (alle lazy-loadet).

### Hva ble bevisst utelatt i MVP

- **Live-opptak på `/erfaring`**: Krever refaktor av meeting.tsx
  AudioContext-pipeline til en delt hook. CLAUDE.md advarer eksplisitt
  mot å røre dette. MVP løses med filopplasting + manuelt input.
  Follow-up: extract usePcmRecorder-hook i en separat PR.
- **Excel-støtte i brain-upload**: Krever ny `xlsx`-dep. Droppet for å
  unngå dep-økning før MVP. Følges opp ved behov.
- **Streaming av chat-svar**: Ble fullført som enkelt-respons. Klar for
  oppgradering med SSE i framtidig PR.
- **Rules-backfill**: `extracted_rules` ingestes ikke automatisk ennå —
  skipped med log-melding for synlighet. Følges opp.

### Verifisering

- ✓ `npm run check`: alle TS-feil borte.
- ✓ `npm run build`: vellykket, 5 pre-eksisterende warnings i vite.config.ts.
- ⚠ Manuell røyk-test (UI + ende-til-ende) ikke utført i dette miljøet
  (har ikke DATABASE_URL/OPENAI_API_KEY i container). Anbefales kjørt
  lokalt eller på Render staging før merge.

### Tilbakerullingsplan

Alle endringer er i nye filer eller minimalt rørt eksisterende.
- 3 nye tabeller (pgvector-aktivert)
- 3 nye route-grupper
- 2 nye frontend-sider
- 5 ny lib-filer
- Eksisterende meeting.tsx, interview.tsx, auth-flyt, schema URØRT.

En `git revert` på MVP-commitene ruller tilbake alt uten datatap.
knowledge_chunks-tabellen blir stående tom hvis vi reverter — ingen
eksisterende data går tapt.

### Neste skritt (etter merge)

1. RLS auto-aktiveres på de nye tabellene via `apply-rls.ts` (separat PR).
2. Manuell røyk-test på Render staging.
3. Live-opptak på `/erfaring` (extract usePcmRecorder-hook).
4. Excel-støtte i brain-upload.
5. Streaming chat-svar med SSE.
6. Rules backfill-løype.
