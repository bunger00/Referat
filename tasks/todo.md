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

(Fylles ut etterhvert som arbeidet skjer)
