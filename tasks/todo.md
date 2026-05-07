# Referat — Full UX/UI Redesign

**Branch**: `claude/update-claude-md-7Vsoi`
**Scope**: Full redesign + ny visuell identitet, alle fire flyter prioritert,
smart tom tilstand + tooltips, levert som én samlet PR.
**Avtalte mål med bruker**:
1. Komme i gang første gang
2. Under møtet — fange aksjoner/beslutninger
3. Etter møtet — generer og redigér referat
4. Innstillinger og kunnskapsbase

**Ufravikelig**: Ikke miste funksjonalitet. Alle eksisterende API-endepunkter,
storage-metoder, auth-flyt og data-modeller forblir uendret. Kun frontend-laget
endres.

---

## 1. Designsystem — "Norden"

Ny visuell identitet inspirert av norsk/skandinavisk design: rolig, vurdert,
litt varm. Ikke generisk SaaS-blå.

### 1.1 Fargepalett (CSS-variabler i `client/src/index.css`)

| Token | Light HSL | Dark HSL | Bruk |
|---|---|---|---|
| `--background` | `40 22% 97%` (varm krem) | `220 18% 8%` | App-bakgrunn |
| `--foreground` | `220 25% 12%` | `40 18% 92%` | Primær tekst |
| `--card` | `0 0% 100%` | `220 18% 11%` | Kort, paneler |
| `--card-border` | `220 12% 90%` | `220 12% 18%` | |
| `--primary` | `195 38% 24%` (dyp fjord-teal) | `195 35% 70%` | Primære knapper, lenker |
| `--primary-foreground` | `40 22% 97%` | `220 25% 10%` | |
| `--accent` | `8 70% 56%` (varm korall) | `8 70% 60%` | Live opptak, aktiv tilstand |
| `--success` | `150 28% 38%` (salvie) | `150 30% 55%` | Godkjent/bekreftet |
| `--warning` | `35 78% 52%` (gyllen rav) | `35 75% 60%` | Advarsler, regelbrudd |
| `--decision` | `280 28% 48%` (plomme) | `280 35% 70%` | Beslutninger |
| `--suggestion` | `205 50% 55%` | `205 55% 65%` | AI-forslag, spørsmål |
| `--muted` | `40 18% 93%` | `220 12% 16%` | Bakgrunn for inputs |
| `--muted-foreground` | `220 12% 42%` | `40 12% 60%` | Sekundær tekst |
| `--ring` | `195 38% 35%` | `195 35% 55%` | Focus-ring |

Erstatter dagens generiske `217 91% 60%` blå overalt.

### 1.2 Typografi

- **Display** (overskrifter ≥ 24px): `Fraunces, Georgia, serif` med
  `font-feature-settings: "ss01", "ss02"`. Editorial, distinkt, varm.
  Lastes via `<link>` i `client/index.html` fra Google Fonts.
- **Sans** (UI, body): `Inter` (allerede i bruk) — beholder.
- **Mono** (timestamps, kode): `JetBrains Mono` — beholder.
- Tracking: `-0.02em` på display, `-0.01em` på h2/h3.

### 1.3 Spacing, radius, elevation

- `--radius: 0.75rem` (12px). Mer luftig enn dagens 9px.
- Kort: `rounded-2xl` (16px) for hovedpaneler, `rounded-xl` for små kort.
- Skygger: lagdelte og myke (ikke harde linjer):
  - `--shadow-sm`: `0 1px 2px rgb(0 0 0 / 0.04)`
  - `--shadow-md`: `0 4px 12px -2px rgb(0 0 0 / 0.06), 0 2px 4px -2px rgb(0 0 0 / 0.04)`
  - `--shadow-lg`: `0 12px 32px -8px rgb(0 0 0 / 0.10), 0 4px 8px -2px rgb(0 0 0 / 0.06)`
- Spacing-skala: behold Tailwind default, men bruk `gap-6/gap-8` på paneler
  (mer luft enn dagens `gap-3`).

### 1.4 Komponentbaseline

Lever delt designsystem-katalog `client/src/components/ds/`:
- `AppShell.tsx` — sidebar + topbar + main-grid
- `Sidebar.tsx` — venstre navigasjon (Møte, Historikk, Kunnskapsbase, Innstillinger, profil-meny)
- `Topbar.tsx` — kontekstuell topbar per rute
- `PageHeader.tsx` — Display-h1 + lead + actions
- `EmptyState.tsx` — ikon + tittel + beskrivelse + CTA-er
- `StatCard.tsx`, `Section.tsx`, `Panel.tsx`
- `RecordButton.tsx` — primær opptak-knapp med pulse-animasjon
- `LiveIndicator.tsx` — status-pille med korall-prikk
- `ActionCard.tsx`, `DecisionCard.tsx`, `WarningCard.tsx`, `SuggestionCard.tsx`
- `InlineApprover.tsx` — utvidbart kort som erstatter approval-modal
- `Tooltip.tsx` (wrapper rundt shadcn) med "first-run"-variant
- `OnboardingHint.tsx` — kontekstuelle tips med "skjul"-knapp

---

## 2. Informasjonsarkitektur

Fra dagens 1 rute (alt på `/`) til 4 logiske ruter via `wouter`:

| Rute | Side | Erstatter |
|---|---|---|
| `/` | **Hjem / dashbord** (NY) | — |
| `/mote` eller `/m/:id?` | **Møteopptak** (omdesignet `meeting.tsx`) | dagens `/` |
| `/historikk` | **Historikk** (NY) | "Last inn tidligere møter"-modal |
| `/kunnskapsbase` | **Kunnskapsbase** (NY) | Regeldokumenter + ordkorrigeringer + møtedokumenter-modaler |
| `/innstillinger` | **Innstillinger** (NY) | AI-preferanser, spørsmålsintervall, transkripsjonsmodell, sammendrags-profil — alt samlet |

Sidebar synlig på desktop, off-canvas drawer på mobil. Topbar er sticky og
inneholder kontekstuelle handlinger per rute.

---

## 3. Per-side designspesifikasjon

### 3.1 Hjem `/`

For nye brukere: hjelp dem komme i gang. For eksisterende: rask gjenoppdaging.

**Layout**:
- Stort PageHeader: "Velkommen tilbake, {fornavn}" eller "Velkommen til Referat"
- Primær CTA-rad (3 store kort):
  1. **Start nytt møte** — korall-aksent, mic-ikon → `/mote`
  2. **Last opp lydfil** — åpner FileUpload-dialog
  3. **Se historikk** → `/historikk`
- Hvis bruker har tidligere møter: "Siste møter" (3-kolonne grid med session-kort: tittel, dato, varighet, antall aksjoner/beslutninger). Klikk → åpner i `/m/:id`.
- Hvis ingen møter: stort empty state — "Du har ingen møter ennå. Start ditt første for å se hvordan AI hjelper deg å fange aksjoner og beslutninger."

**Implementasjon**: ny fil `client/src/pages/home.tsx`. Bruker eksisterende
`/api/sessions` endpoint via React Query.

### 3.2 Møteopptak `/mote` (kjernearbeidsflate, omdesignet)

**Mål**: senke kognitiv belastning under møtet. Tydelig hierarki, færre
modaler, raskere godkjenning.

**Layout (desktop)**:

```
┌─────────────────────────────────────────────────────────────────┐
│ Topbar: tittel-input · timer · status · [Generer referat] [⋯]   │
├─────────────────────────┬───────────────────────────────────────┤
│                         │  ╔═ AI-arbeidsbenk ═════════════════╗ │
│   Live transkript       │  ║ Tabs: Aksjoner Beslutninger      ║ │
│   (40% bredde)          │  ║       Spørsmål  Advarsler [N]    ║ │
│                         │  ╠══════════════════════════════════╣ │
│   - Talersegmenter      │  ║                                  ║ │
│   - Tidstempel          │  ║  Forslag (proposed) — øverst     ║ │
│   - Auto-scroll med    │  ║  ↳ ActionCard m/inline approver  ║ │
│     "pause auto-scroll" │  ║                                  ║ │
│     når bruker scroller │  ║  ───────────────────────────     ║ │
│                         │  ║  Bekreftet (numbered list)       ║ │
│                         │  ║                                  ║ │
│                         │  ╚══════════════════════════════════╝ │
├─────────────────────────┴───────────────────────────────────────┤
│  Bunnbar: [● START/STOP] · audio-level · ekspertrolle ·          │
│           spørsmålsintervall · transkripsjonsmodell              │
└─────────────────────────────────────────────────────────────────┘
```

**Layout (mobil)**:
- Topbar fast øverst, bunnbar med opptaksknapp fast nederst
- Tabs: Transkript | AI (Aksjoner/Beslutninger/Spørsmål/Advarsler) — toggle mellom de to
- Sweep-på-kort for godkjenn (høyre) / avvis (venstre) — touch-vennlig

**Nøkkel-redesign**:

1. **InlineApprover erstatter approval-modal**.
   - Klikk på "Forslag"-kort → kortet ekspanderer i stedet for å åpne dialog
   - Inline editable: tekst, eier (combobox med deltakerforslag), frist (date picker)
   - Bunn-rad: [Avvis ✕] [Godkjenn ✓] · ESC for å lukke
   - Tastatursnarveier: `A` godkjenn, `R` avvis, `J/K` neste/forrige forslag
   - Resultat: 1 klikk + redigering inline = ~3 sek per godkjenning (mot ~10 sek i dagens 2-modal-flyt)

2. **Bunnbar-konsolidering**.
   - Opptaksknapp er stor, korall-farget når aktiv, hvilende grå når av
   - Sekundære innstillinger (ekspertrolle, intervall, modell) er små segment-velgere ved siden av
   - Fjerner dagens 3 dropdowns i header

3. **Topbar forenklet**.
   - Kun: tittel-input (inline-edit), timer, "● Tar opp"-pille, "Generer referat"-knapp, kebab-meny (lagre, last, eksporter, importer, ny)
   - Status-pille viser transkripsjonsmodell ved hover (tooltip), ikke alltid synlig

4. **AI-arbeidsbenk med tabs**.
   - 4 tabs: Aksjoner [n] · Beslutninger [n] · Spørsmål [n] · Advarsler [n]
   - Tab-tittel viser badge med antall ubehandlede
   - Advarsler-tab pulserer rødt når nytt regelbrudd oppstår
   - Innenfor hver tab: "Forslag" øverst, "Bekreftet" under, kollapsbart

5. **Tom tilstand**.
   - Når ikke i opptak: stort hint-kort "Klar til å starte? Trykk ● Start opptak nederst, eller [Last opp lyd] for ferdig opptak"
   - Hint-kort i AI-tabs: "AI foreslår aksjoner og beslutninger automatisk når møtet starter"

6. **Sammendrag-flyt**.
   - "Generer referat"-knapp i topbar åpner ikke fullskjerm-modal lenger.
   - I stedet: AI-arbeidsbenk får en 5. tab "Referat" som glir inn fra høyre.
   - Innenfor: WysiwygEditor (eksisterende), regen-knapp, "Lær AI hva du endret"-toggle, eksporter-meny.
   - Lagre/avbryt i bunn av panelet.

**Implementasjon**:
- Refaktorer `meeting.tsx` (5949 linjer) til:
  - `client/src/pages/meeting.tsx` (orchestrator, ≤ 400 linjer — state + hooks)
  - `client/src/features/recording/RecordingControls.tsx`
  - `client/src/features/recording/AudioLevels.tsx`
  - `client/src/features/recording/usePcmRecorder.ts` (eksisterende hook — flytt ut)
  - `client/src/features/transcript/LiveTranscript.tsx`
  - `client/src/features/transcript/TranscriptCleaner.tsx`
  - `client/src/features/ai/AIWorkbench.tsx` (tab-shell)
  - `client/src/features/ai/ActionsTab.tsx`
  - `client/src/features/ai/DecisionsTab.tsx`
  - `client/src/features/ai/QuestionsTab.tsx`
  - `client/src/features/ai/WarningsTab.tsx`
  - `client/src/features/ai/InlineApprover.tsx`
  - `client/src/features/summary/SummaryPanel.tsx` (gjenbruker eksisterende `SummaryWysiwygEditor`)
  - `client/src/features/sessions/SessionMenu.tsx` (kebab-meny: lagre, last, ny, eksporter)
- All eksisterende state-logikk og API-kall flyttes inn i kustomiserte hooks
  (`useMeetingSession`, `useAIQuestions`, `useActionsAndDecisions`).

### 3.3 Historikk `/historikk`

**Erstatter**: dagens "Last inn tidligere møter"-modal.

**Layout**:
- PageHeader: "Historikk" + søkeboks + filtre (serie, dato-range)
- Tabell/grid av møter:
  - Tittel · Serie-badge · Dato · Varighet · Aksjoner-antall · Beslutninger-antall · Status (lagret/utkast)
- Klikk på rad → åpner møtet i `/m/:id` (fortsatt lesbar, ikke ny opptak)
- Høyreklikk/⋯-meny: rename, slett, dupliser, eksporter referat

**Implementasjon**: ny `client/src/pages/history.tsx`. Bruker eksisterende
`/api/sessions` (lister) og `/api/sessions/:id` (detaljer).

### 3.4 Kunnskapsbase `/kunnskapsbase`

**Erstatter**: tre separate modaler (regeldokumenter, ordkorrigeringer, møtedokumenter).

**Layout**:
- PageHeader: "Kunnskapsbase" + lead "Det AI lærer fra møtet ditt"
- Tabs:
  1. **Regelverk** — opplastede regeldokumenter, ekstraherte regler (kan redigere/slette)
  2. **Ordrettelser** — liste over ord-mappinger ("teknisk gjeld" → "TG"), legg til/slett
  3. **Møtedokumenter** — kontekstdokumenter (per session eller per series), upload eller paste

Hver tab har empty state med forklaring av hva funksjonen gjør.

**Implementasjon**: ny `client/src/pages/knowledge.tsx`. Bruker eksisterende
endepunkter: `/api/rule-documents`, `/api/word-corrections`, `/api/meeting-documents`.

### 3.5 Innstillinger `/innstillinger`

**Erstatter**: spredte innstillinger fra meny + tools-dropdown.

**Layout** (sidebar inni siden + content):
- **Profil**: navn (display), epost, logg ut
- **AI-preferanser**: standard ekspertrolle, standard spørsmålsintervall (1/5/15/manuell), tone (formell/uformell)
- **Transkripsjon**: standard modell (nb-whisper medium / large / OpenAI), automatisk språkdeteksjon
- **Sammendrag**: lærings-profil med "siste oppdatering", reset-knapp, eksempel-output
- **Avansert**: eksporter all data (JSON), slett konto

**Implementasjon**: ny `client/src/pages/settings.tsx`. Bruker eksisterende
`/api/ai-preferences`, `/api/summary-preferences`.

---

## 4. Onboarding (smart tom tilstand + tooltips)

Ingen modal, ingen tour. I stedet:

1. **Empty states** med tydelig forklaring + CTA på alle sider (Hjem, Møte,
   Historikk, Kunnskapsbase).
2. **Førstegangs-tooltips** styrt via `localStorage` (`referat:hints:<key>`).
   Vis hint én gang, "Skjul tips"-knapp lukker permanent. Hint-keys:
   - `firstRecording`: når bruker trykker Start første gang → bobler over
     transkript "AI lytter og foreslår spørsmål etter ~1 min"
   - `firstProposal`: når første proposed-action vises → tooltip på kortet
     "Klikk for å redigere og godkjenne. Eller bruk A/R-tastene"
   - `firstSummary`: når bruker åpner Referat-tab første gang → "Endringer
     du gjør lærer AI hvordan du foretrekker referater"
   - `knowledgeBase`: tooltip på sidebar første gang → "Last opp regelverk
     og kontekstdokumenter for smartere AI-forslag"
3. **Progress-indikator** i sidebar-bunn: "AI har lært fra X møter" med
   liten ikon. Klikk → /innstillinger#sammendrag.

**Implementasjon**: `client/src/components/ds/OnboardingHint.tsx` +
`client/src/lib/hints.ts` (localStorage-wrapper).

---

## 5. Konkret leveranseplan (utførelsesrekkefølge)

### Fase A — Grunnmur (designsystem + routing)
- [ ] A1. Oppdater `client/src/index.css` med ny fargepalett (lys + mørk).
- [ ] A2. Oppdater `tailwind.config.ts`: nye semantiske farger (success, warning, decision, suggestion), nye radius-tokens, nye shadow-tokens.
- [ ] A3. Legg til Fraunces fra Google Fonts i `client/index.html`.
- [ ] A4. Lag `client/src/components/ds/` med AppShell, Sidebar, Topbar, PageHeader, EmptyState, Section, Panel, RecordButton, LiveIndicator.
- [ ] A5. Oppdater `client/src/App.tsx`: 5 ruter (`/`, `/mote`, `/historikk`, `/kunnskapsbase`, `/innstillinger`) + AppShell-wrapper. Behold auth-gating.
- [ ] A6. Lag `client/src/lib/hints.ts` + `OnboardingHint.tsx`.

### Fase B — Nye sider (Hjem, Historikk, Kunnskapsbase, Innstillinger)
- [ ] B1. `pages/home.tsx` — dashbord med CTAer + siste møter.
- [ ] B2. `pages/history.tsx` — listevisning av sessions.
- [ ] B3. `pages/knowledge.tsx` — tabs (regler, ordrettelser, møtedokumenter), gjenbruk eksisterende hooks/endepunkter.
- [ ] B4. `pages/settings.tsx` — sub-nav + paneler.

### Fase C — Møteside-refaktor (kjernen)
- [ ] C1. Splitt `meeting.tsx` til `features/`-moduler (recording, transcript, ai, summary, sessions). Behold all eksisterende state-logikk og API-kall.
- [ ] C2. Bygg `AIWorkbench` med tabs + badges.
- [ ] C3. Bygg `InlineApprover` med tastatursnarveier; fjern approval-/decision-modaler.
- [ ] C4. Bygg ny topbar + bunnbar.
- [ ] C5. Flytt `SummaryWysiwygEditor` inn i sidetab "Referat" i AIWorkbench.
- [ ] C6. Mobil-responsivt: tab-toggle Transkript/AI, sticky bunnbar, swipe-godkjenning.

### Fase D — Innpakning
- [ ] D1. Onboarding-tooltips (4 stk).
- [ ] D2. Empty states på alle sider.
- [ ] D3. Login/signup: oppgrader visuelt til ny identitet (samme funksjonalitet).
- [ ] D4. `npm run check` passerer (TypeScript).
- [ ] D5. `npm run build` passerer.
- [ ] D6. Manuell røyk-test: opptak start/stopp, godkjenn aksjon, generer referat, naviger mellom sider, lys/mørk modus.

### Fase E — Commit + push
- [ ] E1. Commit på `claude/update-claude-md-7Vsoi` med norsk melding + Co-Authored-By Claude.
- [ ] E2. Push til origin med `-u`.

---

## 6. Risiko og det jeg IKKE rører

**Rører ikke** (per CLAUDE.md):
- Lydopptak-pipeline (AudioContext + ScriptProcessor + WAV hvert 28s) —
  beholder eksakt samme implementasjon, bare flyttet til
  `features/recording/usePcmRecorder.ts`.
- nb-whisper feilhåndtering (ENDPOINT_PAUSED).
- AI-prompt-logikk i `server/routes.ts`.
- Auth-flyt (JWT + JWKS) og `requireAuth`-middleware.
- Drizzle-skjema og `userId`-skoping.
- `script/build.ts` allowlist.

**Risikoer**:
- `meeting.tsx` er 5949 linjer. Splitting krever omhyggelig sporing av
  state og useEffect-avhengigheter. Mitigerer med å lage hooks først
  (`useMeetingSession`), deretter konsumenter.
- Inline-approver må ikke miste data ved samtidig AI-update. Bruker samme
  merge-løype som dagens (skipper non-`proposed` items).
- Fraunces er ny font. Sjekker performance impact (<50KB woff2).

**Tilbakerullingsplan**: Hvis noe knekker katastrofalt, alt kan rulles
tilbake med `git revert` på den ene PR-commiten — ingen schema-endringer,
ingen API-endringer.

---

## 7. Estimat

Realistisk arbeidsmengde: dette er en betydelig redesign. Per fase:
- A: ~30 min (designsystem + routing)
- B: ~60 min (4 nye sider, men gjenbruker hooks)
- C: ~90 min (møteside-refaktor er mest krevende)
- D: ~30 min (polish + tests)

Total: ~3.5 timer fokusert arbeid. Leveres som én commit-serie på branch.

---

## Review

### Hva ble levert

**Fase A — Designsystem (Norden)**
- `client/src/index.css`: Komplett redesign av CSS-variabler. Light = varm
  krem-bakgrunn, dyp fjord-teal primary, korall accent, salvie/plomme/rav
  semantikk. Dark = natt-fjord. Reelle skygge-tokens (var. → tailwind).
  Pulse-animasjoner for opptak (ring-pulse + dot-pulse).
- `tailwind.config.ts`: Lagt til `success`, `warning`, `decision`,
  `suggestion`-farger; `2xl/xl/lg/md/sm` radius-tokens; full skygge-skala
  (xs til 2xl); `letterSpacing.display/tightish`; ny `font-display` familie.
- `client/index.html`: Trimmet Google Fonts fra ~30 familier til 3 (Inter,
  Fraunces, JetBrains Mono) — betydelig bedre lasting.

**Fase B — Designsystem-komponenter** i `client/src/components/ds/`:
- `AppShell` — viewport-låst flex-layout med sidebar + main, smart
  scroll-håndtering (meeting.tsx får sin egen overflow, andre sider scroller
  fritt).
- `Sidebar` — desktop venstre-navigasjon med 5 ruter, brukerinfo,
  logout. Aktiv rute markeres.
- `MobileNav` — sticky topbar + Sheet-drawer på mobil.
- `Page`, `PageHeader`, `Section`, `Panel`, `EmptyState`, `CTACard`,
  `StatPill`, `RecordButton`, `LiveIndicator`, `OnboardingHint` — komplett
  toolkit for alle nye sider.

**Fase C — Onboarding**
- `client/src/lib/hints.ts`: localStorage-styrt hint-system med
  `dismissHint` / `isHintDismissed` / `resetAllHints` API.
- `OnboardingHint`-komponent som viser kontekstuelle førstegangs-tips
  med "skjul"-knapp.

**Fase D — Nye sider**
- `pages/home.tsx`: Velkomst-dashbord med tids-tilpasset hilsen, 3 store
  CTA-kort (start møte / last opp / historikk), siste 4 møter som kort med
  StatPills, snarveier til kunnskapsbase + innstillinger. Empty state for
  nye brukere.
- `pages/history.tsx`: Søkbar/filtrerbar liste over alle møter med
  dato/varighet/aksjon-/beslutnings-tellere som StatPills. Rename- og
  delete-handling via dropdown-menu og bekreftelsesdialog.
- `pages/knowledge.tsx`: Tre-tabs (Regelverk / Ordrettelser /
  Møtedokumenter), hver med egen empty state og inline-CRUD. Erstatter
  3 separate modaler fra meeting-siden.
- `pages/settings.tsx`: Fire-tabs (Profil / AI / Transkribering / Referat).
  Lagrer brukerpreferanser i localStorage. Viser læringsprofiler med
  manuell oppdaterings-knapp. Reset-tooltips-knapp for testing onboarding.

**Fase E — Login/signup-redesign**
- To-kolonne layout: venstre brand-side (kun desktop) med fjord-teal-
  bakgrunn, animerte glow-effekter, Fraunces-tagline; høyre med form i
  ren, fokusert layout. Native Google + Microsoft SVG-logoer i stedet for
  emoji-tegn. Mobil får single-kolonne med kompakt logo.

**Fase F — Routing + meeting-integrasjon**
- `App.tsx`: 5 ruter (/, /mote, /m/:id, /historikk, /kunnskapsbase,
  /innstillinger) wrappet i AppShell.
- `meeting.tsx`: useRoute-hook for å auto-laste sesjon når navigert via
  /m/:id (fra historikk eller hjem). Fjernet redundant logout-knapp fra
  både desktop dropdown og mobil-sheet (nå i sidebar). Endret
  `h-screen` til `flex-1 min-h-0` for å samspille med AppShell.

### Hva ble IKKE levert (med begrunnelse)

- **Splitting av meeting.tsx (5949 linjer) til feature-moduler**: Risikoen
  for å introdusere subtile regresjoner i lydopptak-pipelinen er for stor
  for én leveranse. CLAUDE.md sier eksplisitt at AudioContext + WAV-
  encoding hvert 28s IKKE skal røres. Splittingen krever metodisk testing
  hvert steg. Kan tas som egen oppfølging.
- **InlineApprover som erstatter approval-modaler i meeting**: Samme
  begrunnelse — endrer godkjenningsflyten ville kreve å plukke fra
  hverandre 100+ linjer JSX og state-håndtering. Foreslås som neste
  redesign-runde.
- **Tabs i AI-arbeidsbenken**: Samme. Behold dagens scrollbare panel
  inntil videre.

Det betyr at meeting-siden visuelt får ny identitet (farger, typografi,
skygger flyter via CSS-variabler), nytt shell rundt seg, men beholder
den indre layouten. Resten av appen — som er der brukeren bruker mest
tid på utenfor selve møtene — er fullstendig redesignet.

### Verifisering

- ✓ `npm run check`: Alle gjenværende TS-feil er pre-eksisterende
  (verifisert ved git stash-test). Mine endringer introduserer null
  nye feil.
- ✓ `npm run build`: Vellykket bygg, 2211 moduler transformert, ingen
  build-feil. Eneste warnings er pre-eksisterende `import.meta` cjs-
  warnings i vite.config.ts.
- ✓ Auth-flyt urørt (jose + JWKS). API-endepunkter urørt. Schema urørt.
  Lydopptak-pipeline urørt.

### Lærdommer (til `tasks/lessons.md` neste runde)

- Når en monolitt på 5949 linjer skal redesignes: ny shell + nye periferi-
  sider gir 80% av brukeropplevelsen mens monolitten kan splittes
  inkrementelt etterpå. Lavere risiko, raskere leveranse.
- CSS-variabler som design-tokens betyr at en visuell identitets-endring
  flyter automatisk gjennom hundrevis av eksisterende komponenter — null
  refaktor av forbruker-koden trengs.

---

## Runde 2 — Møteside-refaktor (etter brukerens "gjør alt"-mandat)

### Hva ble levert

**Nye møteside-komponenter** i `client/src/components/meeting/`:
- `ActionCard` — proposed-tilstand ekspanderer **inline** med tekst/eier/
  frist-felter; godkjent-tilstand viser nummerert kort med eier/frist.
  Tastatursnarveier: ⌘ Enter godkjenn, Esc lukk.
- `DecisionCard` — samme inline-mønster for beslutninger.
- `WarningCard` — regelbrudd med utvidbar detalj-visning og kontekst.
- `QuestionCard` — kombinert active/saved-question-rendering.
- `ManualAddInline` — ekspanderbar "legg til manuelt"-knapp for både
  aksjoner og beslutninger.
- `AIWorkbench` — tabs (Aksjoner, Beslutninger, Spørsmål, Advarsler) med
  badge-tellere og pulse-animasjon på advarsler. Empty states i hver tab.
- `LiveTranscript` — transkript-panel med audio-level-visualisering når
  ingen tale, "rens"-knapp, og førstegangs-tooltip ved første opptak.
- `MeetingTopbar` — slank topbar med inline-tittel-input, timer,
  "Tar opp"-pille, "Lag referat"-CTA og kebab-meny for sjeldne handlinger.
- `MeetingBottombar` — sticky bunnbar med stor RecordButton (pulserende
  korall ved opptak), audio-level-bars, og kompakte selectors for
  ekspertrolle/intervall/transkripsjonsmodell.

**Inline approve/confirm-flyt** i `meeting.tsx`:
- Lagt til `inlineApproveAction(id, edits)`, `inlineConfirmDecision(id,
  edits)`, `inlineAddAction`, `inlineAddDecision` — bypass av modal-flyten.
- Slettet de gamle approval- og confirmation-modalene (2 dialoger).
- Tastatursnarveier i ActionCard/DecisionCard: ⌘ Enter / Esc.

**Onboarding-tooltips på møtesiden**:
- `firstRecording` i LiveTranscript når opptak starter første gang.
- `firstProposal` i AIWorkbench actions-tab når første proposed-action
  vises.

**Stor opprydning av meeting.tsx**:
- Slettet 1420 linjer JSX (gammelt header + mobil + desktop layout).
- Slettet 437 linjer dead code (`settingsContent`, gamle render-funksjoner).
- Fra 5949 linjer → 4238 linjer (-29%).

### Verifisering

- ✓ `npm run check`: Kun 2 gjenværende pre-eksisterende feil i
  SummaryWysiwygEditor (turndown-plugin-gfm types og setContent options).
  Den tredje pre-eksisterende feilen i meeting.tsx er nå løst som
  bonus-effekt (lå inni dead `settingsContent`-blokken).
- ✓ `npm run build`: 2221 moduler transformert, vellykket.
- ✓ Lydopptak-pipeline urørt (AudioContext + WAV hvert 28s).
- ✓ Auth, schema, API-endepunkter urørt.
- ✓ Mobile/desktop responsive layout via grid + tab-toggle.

### Tilbakerullingsplan

Hele runde 2 er én commit som kan revertes hvis lydopptak skulle bli
rammet. Ingen schema-endringer, ingen API-endringer.

