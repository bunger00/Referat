# Prompt: Sett opp Supabase Auth med epost/passord + Google + Microsoft

Lim inn dette i en ny chat når du vil lage en app med samme login-flyt.
Det fanger alle fellene jeg falt i første gang.

---

## Hva jeg vil ha

Jeg har et prosjekt med Express-backend og React-frontend (Vite), og bruker
Supabase Postgres som database. Jeg vil bytte ut nåværende auth med
**Supabase Auth**, slik at hver bruker kan registrere seg selv på forsiden
og logge inn med:

1. **Epost + passord** (med epost-bekreftelse via lenke)
2. **Google** (alle Google-kontoer)
3. **Microsoft** (alle jobb-, skole- og personlige Microsoft-kontoer)

Hver innlogget bruker skal ha sitt eget område — møter, dokumenter, regler
osv. skal være filtrert på `user_id` slik at en bruker aldri ser data fra
en annen.

## Faste valg jeg har tatt (slipp å spørre)

- **Eksisterende data**: drop alt og start rent
- **Email verification**: påkrevd (Supabase default, "Confirm email"-toggle på)
- **Sign-up**: åpent for alle
- **JWT-validering server-side**: lokal med jose + JWKS, IKKE shared HS256-secret
  (Supabase signer med ECC P-256 som default på nye prosjekter, og roterer
  legacy HS256 ut over tid — bruker man `jsonwebtoken` med `SUPABASE_JWT_SECRET`
  vil tokens slutte å validere når de roterer)
- **Frontend SDK**: `@supabase/supabase-js` med `persistSession: true`,
  `autoRefreshToken: true`, `detectSessionInUrl: true`

## Rekkefølge på arbeidet (følg nøyaktig — feil rekkefølge gir feil)

### Fase 1 – Skjema og storage

1. Legg til `userId: uuid("user_id").notNull()` på alle tabeller som eier
   bruker-data (sessions, series, documents, rules, word_corrections,
   ai_preferences, summary_preferences, feedback_log, summary_feedback osv.)
   - Tabeller med per-bruker upsert-mønster (én rad per bruker) får
     `.unique()` på user_id-kolonnen
2. Drop alle gamle data-tabeller via psql (den NOT NULL-kolonnen kan ikke
   legges til ellers)
3. Kjør `npm run db:push`
4. Refaktorer `server/storage.ts` så hver per-bruker-metode tar `userId`
   som første argument og legger `eq(table.userId, userId)` i `where`

### Fase 2 – Server-side JWT-validering

5. Installer `jose` (IKKE `jsonwebtoken`)
6. Lag `server/auth.ts` med `createRemoteJWKSet` + `jwtVerify` mot
   `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`. Valider også
   `issuer: ${SUPABASE_URL}/auth/v1` og `audience: "authenticated"`
7. Eksponer `req.user.id` via TypeScript-augmentation av Express Request
8. Erstatt all gammel auth-middleware med nye `requireAuth`
9. På hver protected route: hent `userId = getUserId(req)` ÅVERST i
   handleren, før storage-kall

### Fase 3 – Server-side opprydning

10. Slett `/api/auth/login`, `/api/auth/logout`, `/api/auth/session` —
    Supabase JS SDK håndterer alt på klient
11. Fjern `bcrypt`, `express-session`, `connect-pg-simple`, `memorystore`
    fra package.json
12. Ikke bundle `connect-pg-simple` med esbuild — den leser `table.sql` via
    `__dirname` og knekker (ikke aktuelt lenger siden vi fjerner den, men
    husk regelen for andre pakker)
13. Oppdater `env.ts`: krev `SUPABASE_URL`, fjern `APP_PASSWORD_HASH` og
    `SESSION_SECRET`. **IKKE** krev `SUPABASE_JWT_SECRET` — JWKS trenger
    den ikke.

### Fase 4 – Frontend

14. `client/src/lib/supabase.ts` med `createClient` og lese
    `import.meta.env.VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`
15. `client/src/lib/queryClient.ts`: alle requests skal hente
    `data.session?.access_token` fra `supabase.auth.getSession()` og legge
    ved som `Authorization: Bearer <token>`. **Ikke** `credentials: include`
16. `pages/login.tsx`: tre knapper (Google, Microsoft, epost), Microsoft
    bruker `provider: "azure"`, ikke "microsoft"
17. `pages/signup.tsx`: epost+passord, vis "sjekk eposten"-skjerm etter
    submit
18. `App.tsx`: bruk `supabase.auth.onAuthStateChange` til auth-state, kall
    `queryClient.clear()` ved hver state-flip så cachet data fra forrige
    bruker forsvinner

### Fase 5 – Render env-vars

Legg til i Render Dashboard → Environment:
- `SUPABASE_URL` = `https://<project-ref>.supabase.co`
- `VITE_SUPABASE_URL` = samme verdi
- `VITE_SUPABASE_ANON_KEY` = publishable key fra Supabase Project Settings →
  API (det nye formatet `sb_publishable_*` virker som drop-in for legacy
  anon-key)

Fjern utdaterte: `APP_PASSWORD_HASH`, `SESSION_SECRET`.

### Fase 6 – Supabase Dashboard

19. **Authentication → URL Configuration**:
    - Site URL: `https://<deployed-app>.com`
    - Redirect URLs: `https://<deployed-app>.com/**` (med wildcard)
20. **Authentication → Email → Templates → Confirm sign up**:
    - Skriv om til norsk hvis aktuelt, design med inline CSS, stort
      lilla-button (`#4f46e5`), fallback-lenke under
21. (Valgfritt) Bytt fra built-in SMTP til custom hvis prod

### Fase 7 – Google OAuth (≈10 min)

22. Google Cloud Console → opprett **nytt prosjekt** (ikke gjenbruk
    eksisterende — consent-skjermen blir delt og forvirrer brukere)
23. APIs & Services → OAuth consent screen → Get started:
    - App name: ditt app-navn
    - Audience: External
    - Trykk gjennom alle stegene, godta User Data Policy
24. APIs & Services → Credentials → Create OAuth Client ID:
    - Type: Web application
    - **Authorized redirect URI**:
      `https://<project-ref>.supabase.co/auth/v1/callback`
25. **VIKTIG**: Når secret vises etter creation — kopier den umiddelbart.
    Den kan IKKE leses senere. Hvis du mister den må du opprette en ny.
26. Audience → "Publish app" → Confirm. Uten dette ser brukere "unverified
    app"-advarsel hver gang.
27. Supabase → Authentication → Providers → Google → enable, lim inn
    Client ID og Secret.

### Fase 8 – Microsoft OAuth (≈10 min, har en lumsk felle)

28. Azure Portal → App registrations → New registration:
    - Name: ditt app-navn
    - **Supported account types**: "Any Entra ID Tenant + Personal Microsoft
      accounts" (ikke "Single tenant" — gir kun din egen org)
    - Redirect URI: Web → `https://<project-ref>.supabase.co/auth/v1/callback`
29. Certificates & secrets → New client secret → kopier verdien (Value, ikke
    Secret ID) UMIDDELBART. Denne kan ikke leses senere.

30. **🚨 LUMSK FELLE 🚨** API permissions → Add permission → Microsoft Graph
    → Delegated permissions, søk og legg til:
    - `email` (View users' email address)
    - `profile` (View users' basic profile)
    - `offline_access` (Maintain access)
    - `openid` (kan ligge under "Other granted")
    - `User.Read` er der by default

    **Uten `email`-scope feiler hele Microsoft-login-flyten med
    `500: Error getting user email from external provider` og brukeren
    ender tilbake på login-siden uten feilmelding.** Du vil tro alt er ok
    fordi consent-skjermen vises, men token-utvekslingen dør.

31. Trykk "Grant admin consent for <Org Name>" så jobb-brukere slipper
    individuell consent-skjerm.

32. Supabase → Authentication → Providers → Azure → enable, lim inn:
    - Application (client) ID
    - Secret Value (NB: Value, ikke Secret ID)
    - Azure Tenant URL: `https://login.microsoftonline.com/common`
      (`common` for multitenant + personal — ikke tenant-spesifikk URL
      med mindre du valgte single-tenant)

### Fase 9 – Verifiser

33. Hard-reload deployed app → registrer en testkonto med epost
34. Sjekk at verifiserings-mailen kommer
35. Logg inn med Google → verifiser i appen at sesjonen settes
36. Logg inn med Microsoft → samme
37. Hvis Microsoft feiler: gå til Supabase Dashboard → Logs → Auth Logs.
    Hvis du ser `/callback | 500: Error getting user email from external
    provider` betyr det fortsatt manglende email-scope — gjenta steg 30.
38. Verifiser per-bruker isolasjon: registrer en konto B, opprett data,
    logg inn som A, sjekk at data fra B ikke vises.

## Hva du ALDRI gjør (lærte det på den harde måten)

- ❌ Bruk `jsonwebtoken` med `SUPABASE_JWT_SECRET` — ikke compat med ECC.
  Bruk `jose` + JWKS.
- ❌ Bundle `connect-pg-simple`, `pdf-parse` eller andre pakker som leser
  filer relativt til `__dirname` — esbuild knekker dem.
- ❌ Glem å legge til `email`-scope i Azure API permissions. Uten den
  feiler Microsoft-login lydløst.
- ❌ Gjenbruk Google Cloud-prosjekt mellom apper — consent-skjermen er
  prosjekt-global og brukerne ser feil app-navn.
- ❌ Skriv per-bruker-data (meetings, etc.) uten `user_id`. Skjema må ha
  det fra dag én, ellers blir migrering vondt.
- ❌ Lagre lydfiler permanent. Skriv til disk midlertidig om nødvendig
  (ffmpeg trenger det), men `fs.unlinkSync` i både success- og error-stier.

## Hva DETTE prosjektet (Referat) konkret bruker

- Supabase project ref: `llrsxtypjmbczjljvppl`
- Render service: https://referat-y767.onrender.com
- Render service ID: `srv-d7ti6rkm0tmc73cpfpkg`
- GitHub: `bunger00/Referat`
- Azure App ID: `532cd138-4755-42ad-8f9b-ec5949c05cfc`
- Google Cloud project: `mythic-display-495606-q5` (Referat)
- Google OAuth Client ID: `628473287173-qqost0vusnfdd190p8jqecarl11qaae3.apps.googleusercontent.com`
