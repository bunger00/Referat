# Møtetranskripsjonsapp

## Oversikt
En live møtetranskripsjonsapplikasjon som bruker AI til å transkribere samtaler i sanntid og generere smarte spørsmålsforslag. All brukergrensesnitt er på norsk.

## Sikkerhet og autentisering
Applikasjonen er passordbeskyttet:
- **Passord**: "lean123" (bcrypt-hashet)
- **Sesjonshåndtering**: Express-session med MemoryStore
- **Login-side**: Enkel innlogging med passord-felt
- **Beskyttede ruter**: Alle API-endepunkter krever autentisering
- **Utlogging**: Via innstillingsmenyen på mobil eller i header

### Miljøvariabler for sikkerhet
- `APP_PASSWORD_HASH`: Bcrypt-hash av passordet
- `SESSION_SECRET`: Hemmelig nøkkel for express-session

## Hovedfunksjoner

### MVP-funksjoner
- **Live lydopptak**: Opptak fra nettleserens mikrofon med `getUserMedia` API
- **Sanntids transkripsjon**: OpenAI Whisper for lydtranskripsjon med simulert taleridentifikasjon
- **To-kolonners layout**: Live transkript til venstre, spørsmålsforslag til høyre
- **AI-genererte spørsmål**: Hvert minutt genereres 3 relevante spørsmål basert på samtalen
- **Spørsmålshåndtering**: Lagre (✓) eller slett (X) foreslåtte spørsmål
- **Lagrede spørsmål**: Samles øverst i høyre panel
- **Tidtaker**: Viser møtevarighet

### Beslutningsdeteksjon (AI-foreslåtte)
AI-en oppdager beslutninger som tas under møtet og foreslår dem for bekreftelse:
- **Automatisk deteksjon**: Hvert gang spørsmål genereres, analyserer AI-en transkriptet for beslutninger
- **Foreslåtte beslutninger**: Vises i lilla panel med kontekst-sitat fra samtalen
- **Bekreftelse**: Klikk "Bekreft" → beslutningen flyttes til bekreftet-listen
- **Avvisning**: Klikk "Avvis" → beslutningen forsvinner fra listen
- **Beslutningsliste**: Bekreftede beslutninger vises i lilla panel og inkluderes i møtereferatet
- **Persistering**: Lagres i localStorage, PostgreSQL-sesjoner, og gjenopprettes ved lasting

### Aksjonspunkter (AI-foreslåtte)
AI-en oppdager handlingspunkter fra transkriptet og foreslår dem for godkjenning:
- **Automatisk deteksjon**: Hvert gang spørsmål genereres, analyserer AI-en også transkriptet for aksjonspunkter
- **Foreslåtte aksjoner**: Vises i blått panel med foreslått ansvarlig og frist
- **Godkjenning**: Klikk "Godkjenn" → dialog for å bekrefte/redigere ansvarlig og frist → flyttes til grønt aksjonspanel
- **Avvisning**: Klikk "Avvis" → aksjonspunktet forsvinner fra listen
- **Aksjonsliste**: Godkjente aksjonspunkter vises i grønt panel og inkluderes automatisk i møtereferatet
- **Persistering**: Lagres i localStorage, PostgreSQL-sesjoner, og gjenopprettes ved lasting

### Fase 2-funksjoner
- **localStorage-persistering**: Data bevares ved sideinnlasting
- **Transkript-eksport**: Last ned som TXT-fil
- **Redigering av spørsmål**: Rediger tekst og legg til notater
- **Møtereferat**: AI-generert oppsummering via "Lag referat"-knappen
- **Filopplasting**: Last opp forhåndsinnspilte lydfiler for transkripsjon
- **Spørsmålstagging**: Hvert spørsmål viser hvilken AI-profil som genererte det
- **Sesjonslagring**: Lagre møter i databasen for å kunne fortsette senere
- **Tidligere møter**: Last inn tidligere lagrede sesjoner via "Tidligere møter"-dialogen
- **Navngiving**: Gi møter egne navn ved lagring
- **Omdøping**: Endre navn på lagrede sesjoner fra sesjonslisten

### AI-ekspertprofiler
Velg ekspertprofil underveis i møtet for å få domenespesifikke spørsmål:
- **Bygg & Prosjekt**: VDC, Lean Construction, taktplanlegging, NS-kontrakter, risikostyring
- **HR & Arbeidsmiljø**: Roller, kapasitet, psykologisk trygghet, arbeidsmiljøloven
- **Jus & Kontrakt**: Entrepriserett, offentlige anskaffelser, GDPR, dokumentasjon
- **Djevelens advokat**: Utfordrer floskler, avdekker blindsoner med humor
- **Pappa-vitser**: Ordspill og lett humor for å lette stemningen, men fortsatt relevante spørsmål
- **Sure-Aud**: Pessimistisk og kritisk - peker på svakheter og worst-case scenarier

Profilen kan byttes når som helst via dropdown i header.

### Spørsmålsintervall
Velg hvor ofte AI-en skal generere spørsmål:
- **Hvert minutt**: Standard - spørsmål basert på siste minutt
- **Hvert 5. min**: Samler 5 minutters transkript, hele møtet som kontekst
- **Hvert 15. min**: Samler 15 minutters transkript, hele møtet som kontekst
- **Kun manuelt**: Ingen automatisk generering - bruk "Generer nå"-knappen

"Generer nå"-knappen tvinger frem spørsmål basert på hele møtet med ekstra fokus på siste 5 minutter.

### Ordkorrigeringer (egendefinert vokabular)
Lær appen de riktige stavemåtene for bransje- og prosjektspesifikke ord:
- **Definere korrigeringer**: Via "Ordkorrigeringer"-knappen i header (desktop) eller innstillingsmenyen (mobil)
- **Rask korrigering**: Marker tekst i transkriptet → popover vises → skriv inn korreksjon → lagres umiddelbart og retroaktivt
- **Retroaktiv**: Alle eksisterende segmenter oppdateres med nye korrigeringer etter lagring
- **Fremtidige transkripsjoner**: Korrigeringer brukes på alle nye transkriberte segmenter (live og filopplasting)
- **Persistering**: Lagres i PostgreSQL-databasen (`wordCorrections`-tabell), tilgjengelig på tvers av møter
- **Administrasjon**: Se og slett eksisterende korrigeringer fra dialogen

### Selvlærende AI (manuell registrering + feedback)
AI-en lærer av brukerens godkjenninger, avvisninger og tilbakemeldinger for å forbedre fremtidige forslag:
- **Feedback-logging**: Hvert godkjenn/avvis på aksjonspunkter og beslutninger logges automatisk i databasen
- **AI-profil**: Etter 5 feedback-signaler genererer GPT en oppsummerende profiltekst som brukes i neste analyze-kall
- **Referat-redigering → umiddelbar læring**: Når brukeren lagrer et redigert referat, kalles `POST /api/feedback/summary-diff` — GPT-4.1 sammenligner original vs. redigert og trekker ut strukturerte læringspoeng (seksjoner, stil, lengde, formuleringer). Profilen oppdateres UMIDDELBART og returneres til klienten.
- **Referat-profil**: Injiseres som "LÆRTE BRUKERPREFERANSER" øverst i summary-prompten ved neste generering
- **Strukturert diff-analyse**: Lagres som `STRUKTURERT DIFF-ANALYSE:` prefiks i `summary_feedback`-tabellen, skilles fra fritekst-kommentarer ved profil-regenerering
- **"Hva har appen lært?"**: Dialog viser begge profilerte med forklaring av hukommelsessystemet og sist oppdatert
- **Manuell registrering av aksjoner**: "+ Legg til manuelt"-knapp i aksjonspanelet (desktop), med felt for tekst, ansvarlig og frist. Vises med amber/gul border og "Manuelt" badge
- **Manuell registrering av beslutninger**: "+ Legg til beslutning manuelt"-knapp i beslutningspanelet (desktop), med felt for tekst og kontekst
- **Kilde-merking**: `source: "ai" | "manual"` på alle ActionItem og ProposedDecision
- **Persistering**: feedback_log, ai_preferences, summary_feedback, summary_preferences lagres i PostgreSQL

### Regeldokumenter og automatisk regelsjekking
Last opp regeldokumenter (1-5 stk) for automatisk regelsjekking:
- **Støttede filtyper**: PDF, TXT, DOCX, eller lim inn tekst direkte
- **Regelekstraksjon**: AI analyserer dokumenter og trekker ut alle regler/krav
- **Automatisk sjekking hvert 10. sekund**: Under opptak sjekkes transkriptet mot opplastede regler
- **Persistent lagring**: Regler lagres i PostgreSQL-databasen og er tilgjengelige på tvers av møter
- **Manuell sletting**: Brukeren må eksplisitt slette regler - de følger med til alle møter
- **Advarsler**: Vises øverst i spørsmålspanelet med to nivåer:
  - **Brudd (violation)**: Klar motsetning mot en regel
  - **Risiko (risk)**: Potensielt konflikt som bør avklares
- **Detaljer**: Hver advarsel viser regelreferanse, sitat fra samtalen, og foreslåtte oppfølgingsspørsmål

Regler åpnes via "Regeldokumenter"-knappen i innstillingsmenyen eller header.

## Design
- **Mobile-first**: Responsiv layout som prioriterer mobilopplevelse
- **Mobil**: Delt visning - transkript øverst (55%), spørsmål nederst (45%), begge alltid synlige
- **Desktop**: To-kolonners layout med transkript til venstre (2/3), spørsmål til høyre (1/3)
- **Header**: Tidtaker og Start/Stopp-knapp alltid synlig, innstillinger i meny på mobil
- **Spørsmålsrekkefølge**: Nyeste spørsmål vises øverst (sortert synkende etter minutt)

## Teknisk stack
- **Frontend**: React med TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: Express.js med TypeScript
- **AI**: OpenAI GPT-4o og Whisper
- **State management**: React hooks med localStorage

## API-endepunkter

### POST /api/transcribe
Transkriberer lyddata med OpenAI Whisper (whisper-1, norsk språk satt eksplisitt).
Byttet til NbAiLab/nb-whisper-medium via HuggingFace Inference API (mer stabil enn large for live transkripsjon).
- **Request**: `{ audio: string }` (base64-kodet lyd)
- **Response**: `{ segments: TranscriptSegment[] }`

### POST /api/transcribe-file
Transkriberer opplastet lydfil (MP3, M4A, WAV, WEBM, OGG, FLAC).
- **Merk**: Store filer (>20 MB) deles automatisk opp med ffmpeg og transkriberes i deler
- **Request**: FormData med `audio`-fil
- **Response**: `{ segments: TranscriptSegment[], duration: string, totalSeconds: number, filename: string }`

### POST /api/analyze
Genererer spørsmålsforslag basert på transkript, og sjekker mot opplastede regler.
- **Request**: `{ transcript: string, fullTranscript?: string, expertRole?: "bygg" | "hr" | "jus" | "uformell" | "pappa" | "sureaud" }`
- **Response**: `{ questions: string[], warnings?: Warning[] }`

### Rules API
Håndterer opplasting og sjekking av regeldokumenter.
- **POST /api/rules/upload**: Laster opp dokument (PDF/TXT/DOCX) og ekstraherer regler
- **GET /api/rules**: Henter alle opplastede dokumenter og ekstraherte regler
- **DELETE /api/rules**: Sletter alle regler og dokumenter
- **DELETE /api/rules/document/:id**: Sletter spesifikt dokument og tilhørende regler

### POST /api/summary
Genererer møtesammendrag.
- **Request**: `{ transcript: string, savedQuestions: string[] }`
- **Response**: `{ summary: string }`

### Learning / Feedback API
Håndterer feedback-logging og AI-læring.
- **POST /api/feedback**: Logger godkjenn/avvis-signal for aksjonspunkter og beslutninger; trigger async profil-oppdatering etter 5 nye signaler
- **POST /api/feedback/summary**: Logger brukerkommentar på referat; trigger async profil-oppdatering etter 3 nye tilbakemeldinger
- **GET /api/learning/profiles**: Returnerer begge lærte profiler + antall signaler/tilbakemeldinger
- **POST /api/learning/update-profile**: Tvinger oppdatering av AI-profilen for aksjoner/beslutninger
- **POST /api/learning/update-summary-profile**: Tvinger oppdatering av referat-profilen

### Sessions API
Håndterer lagring og henting av møtesesjoner.
- **GET /api/sessions**: Henter alle lagrede sesjoner
- **GET /api/sessions/:id**: Henter en spesifikk sesjon
- **POST /api/sessions**: Oppretter ny sesjon
- **PATCH /api/sessions/:id**: Oppdaterer en sesjon (transkript, spørsmål, referat, osv.)
- **DELETE /api/sessions/:id**: Sletter en sesjon

### Møteserie-funksjon
Møter kan knyttes til en møteserie for AI-basert kryssreferering på tvers av møter:
- **Opprettelse**: Velg "Opprett ny serie..." i lagredialog — serie opprettes automatisk ved lagring
- **Kobling**: Velg eksisterende serie fra dropdown i lagredialog
- **Historikk**: Sessionsdialogen grupperer møter etter serie med blå overskrifter og møtenummer-badge
- **Kryssmøte-spørsmål (live)**: Hvert minutt hentes referater fra tidligere møter i serien → AI genererer spørsmål som avdekker motsetninger/endringer → vises med rød markering, rød kant, varselsikon og badge "Motstrid fra tidligere møte"
- **Motstrid i referatet**: Referatgenerering sender nå også serie-referater → GPT-4.1 skriver en dedikert "## 6. Motstrid og avvik fra tidligere møter" seksjon med strukturert analyse av hva som er endret/motstrides fra hvilke møter
- **Forutsetning for begge**: Tidligere møter i serien MÅ ha et lagret referat (summary) for å inkluderes i motstrid-analysen
- **Persistering**: `seriesId` og `seriesName` lagres i localStorage og PostgreSQL

### Møtedokumenter (kunnskapsbase per møte/serie)
Last opp dokumenter AI-en skal bruke som referanse og sjekke mot:
- **Støttede filtyper**: PDF, TXT, DOCX, eller lim inn tekst direkte
- **Nøkkelpunktekstraksjon**: AI (GPT-4.1) leser dokumentet og trekker ut inntil 20 nøkkelpunkter
- **Omfang**: Dokumentet kan knyttes til enten "dette møtet" (sessionId) eller "hele serien" (seriesId)
- **Automatisk sjekking**: Ved hver analyse injiseres nøkkelpunkter i prompten → AI genererer `cross_meeting`-spørsmål ved motsetninger
- **Rød markering**: Dokument-motsetninger vises med samme røde stil som kryssmøte-spørsmål
- **Dialog**: Åpnes via "Møtedokumenter"-knapp i header (desktop) eller innstillingsmenyen (mobil)
- **Persistering**: Lagres i `meetingDocuments`-tabellen i PostgreSQL; hentes automatisk når sessionId/seriesId endres
- **Sletting**: Enkeltdokumenter slettes fra dialogen

## Miljøvariabler
- `OPENAI_API_KEY`: OpenAI API-nøkkel (påkrevd)

## Kjøring
```bash
npm install
npm run dev
```

Applikasjonen kjører på port 5000.

## Prosjektstruktur
```
client/src/
├── pages/
│   └── meeting.tsx       # Hovedkomponent for møtetranskripsjonsappen
├── components/ui/        # shadcn/ui komponenter
└── lib/                  # Hjelpefunksjoner

server/
├── routes.ts             # API-ruter
└── index.ts              # Express server

shared/
└── schema.ts             # TypeScript-typer og Zod-skjemaer
```

## Brukeropplevelse
1. Klikk "Start møte" for å begynne opptak
2. Tale transkriberes automatisk med 10-sekunders intervaller
3. Hvert minutt genereres 3 spørsmålsforslag
4. Lagre viktige spørsmål med hake-knappen
5. Eksporter transkript eller generer sammendrag når møtet er ferdig
6. Data lagres automatisk i nettleseren
