import type { Express } from "express";
import { createServer, type Server } from "http";
import OpenAI, { toFile } from "openai";
import { z } from "zod";
import { requireAuth, getUserId } from "./auth";
import { analyzeRequestSchema, transcribeRequestSchema, summaryRequestSchema, transcriptSegmentSchema, interviewCriterionLabels, type ExpertRole, type ExtractedRule, type Warning, type MeetingDocument, type TranscriptSegment, type InterviewScores, type StarStatus, type InterviewEvalSnapshot, type InterviewReport } from "@shared/schema";
import multer from "multer";
import path from "path";
import fs from "fs";
// pdf-parse for PDF text extraction - handle both ESM and CJS exports
type PdfParseFn = (data: Buffer) => Promise<{ text: string; numpages: number; info: any }>;

async function parsePdf(dataBuffer: Buffer): Promise<{ text: string }> {
  try {
    // Dynamic import handles both ESM default export and CJS module export
    const pdfParseModule = await import("pdf-parse");
    const pdfParse: PdfParseFn = (pdfParseModule as any).default ?? pdfParseModule;
    
    if (typeof pdfParse !== "function") {
      console.error("pdf-parse module structure:", Object.keys(pdfParseModule));
      throw new Error("pdf-parse eksporterer ikke en funksjon");
    }
    
    const result = await pdfParse(dataBuffer);
    console.log("PDF parsed successfully, pages:", result.numpages, "text length:", result.text?.length);
    return { text: result.text || "" };
  } catch (error: any) {
    console.error("PDF parse error:", error.message, error.stack);
    throw new Error(`PDF-parsing feilet: ${error.message}`);
  }
}
import { storage } from "./storage";

// the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface HfChunk {
  timestamp: [number, number | null];
  text: string;
}

interface HfTranscriptionResult {
  text: string;
  chunks?: HfChunk[];
}

// NbAiLab HuggingFace Inference Endpoints — read from env so each deployment
// uses its own private endpoints (or skips them entirely and uses OpenAI Whisper).
const NB_WHISPER_ENDPOINTS: Record<"medium" | "large", string | undefined> = {
  medium: process.env.HF_NB_WHISPER_MEDIUM_URL,
  large: process.env.HF_NB_WHISPER_LARGE_URL,
};
const NB_WHISPER_TIMEOUTS: Record<"medium" | "large", number> = {
  medium: 60000,
  large: 120000,
};

function hasNbWhisperConfigured(model: "medium" | "large"): boolean {
  return !!process.env.HUGGINGFACE_API_KEY && !!NB_WHISPER_ENDPOINTS[model];
}

async function transcribeWithNbWhisper(audioBuffer: Buffer, model: "medium" | "large" = "medium"): Promise<HfTranscriptionResult> {
  const apiKey = process.env.HUGGINGFACE_API_KEY;
  const endpoint = NB_WHISPER_ENDPOINTS[model];
  if (!apiKey) throw new Error("HUGGINGFACE_API_KEY er ikke satt");
  if (!endpoint) throw new Error(`HF_NB_WHISPER_${model.toUpperCase()}_URL er ikke satt`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), NB_WHISPER_TIMEOUTS[model]);

  // NbAiLab documentation: send language + task as generate_kwargs (nested),
  // return_timestamps at the top level of parameters.
  // See: https://huggingface.co/NbAiLab/nb-whisper-medium
  const base64Audio = audioBuffer.toString("base64");
  const requestBody = JSON.stringify({
    inputs: base64Audio,
    parameters: {
      return_timestamps: true,
      generate_kwargs: {
        language: "no",
        task: "transcribe",
      },
    },
  });

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: requestBody,
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err.name === "AbortError") throw new Error("nb-whisper tok for lang tid — bytter til reserve");
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (response.status === 503) {
    throw new Error("ENDPOINT_LOADING");
  }

  if (!response.ok) {
    const errorText = await response.text();
    // Paused endpoints return HTTP 400 with a specific body — distinct from
    // "JSON format rejected" 400s, which is what triggers the raw-binary retry.
    if (errorText.includes("is paused") || errorText.includes("paused, ask a maintainer")) {
      throw new Error("ENDPOINT_PAUSED");
    }
    // Fallback: retry as raw binary if JSON format is rejected by the endpoint
    if (response.status === 400 || response.status === 422) {
      console.log(`nb-whisper-${model}: JSON format avvist (${response.status}), prøver rå binær...`);
      return transcribeWithNbWhisperRaw(audioBuffer, model, apiKey);
    }
    throw new Error(`HuggingFace endpoint-feil: ${response.status} – ${errorText}`);
  }

  const result = await response.json();
  // The endpoint may return { text, chunks } or { text } or just a string
  if (typeof result === "string") return { text: result };
  if (result.text !== undefined) return result as HfTranscriptionResult;
  if (result.generated_text !== undefined) return { text: result.generated_text };
  // Some versions return a plain array of chunks
  if (Array.isArray(result)) {
    const text = result.map((c: any) => c.text ?? "").join(" ").trim();
    const chunks = result.map((c: any) => ({ timestamp: c.timestamp, text: c.text }));
    return { text, chunks };
  }
  return result as HfTranscriptionResult;
}

// Fallback: original raw-binary mode in case JSON is not supported by the endpoint version
async function transcribeWithNbWhisperRaw(audioBuffer: Buffer, model: "medium" | "large", apiKey: string): Promise<HfTranscriptionResult> {
  const endpoint = NB_WHISPER_ENDPOINTS[model];
  if (!endpoint) throw new Error(`HF_NB_WHISPER_${model.toUpperCase()}_URL er ikke satt`);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), NB_WHISPER_TIMEOUTS[model]);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "audio/webm" },
      body: audioBuffer,
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err.name === "AbortError") throw new Error("nb-whisper tok for lang tid — bytter til reserve");
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
  if (response.status === 503) throw new Error("ENDPOINT_LOADING");
  if (!response.ok) {
    const errorText = await response.text();
    if (errorText.includes("is paused") || errorText.includes("paused, ask a maintainer")) {
      throw new Error("ENDPOINT_PAUSED");
    }
    throw new Error(`HuggingFace endpoint-feil (raw): ${response.status} – ${errorText}`);
  }
  const result = await response.json();
  if (typeof result === "string") return { text: result };
  if (result.text !== undefined) return result as HfTranscriptionResult;
  if (result.generated_text !== undefined) return { text: result.generated_text };
  return result as HfTranscriptionResult;
}

async function transcribeWithOpenAI(audioBuffer: Buffer, mimeType: string = "audio/webm"): Promise<HfTranscriptionResult> {
  // Whisper detects format from the file's magic bytes regardless of the
  // filename, but matching the extension to the actual mime keeps logs sane
  // and avoids edge-case rejections.
  const ext =
    mimeType.includes("wav") ? "wav" :
    mimeType.includes("mp4") ? "mp4" :
    mimeType.includes("mp3") || mimeType.includes("mpeg") ? "mp3" :
    "webm";
  const file = await toFile(audioBuffer, `audio.${ext}`, { type: mimeType });
  const result = await openai.audio.transcriptions.create({
    file,
    model: "whisper-1",
    language: "no",
    response_format: "verbose_json",
    timestamp_granularities: ["segment"],
  });
  const chunks: HfChunk[] = (result.segments || []).map((seg: any) => ({
    timestamp: [seg.start, seg.end] as [number, number],
    text: seg.text,
  }));
  return { text: result.text, chunks: chunks.length > 0 ? chunks : undefined };
}

// Track endpoint state per model so we can surface useful status to the UI.
// We do NOT auto-fall back to OpenAI when the user picked a Norwegian model.
const consecutiveLoading: Record<string, number> = { medium: 0, large: 0 };

// Keep HuggingFace endpoints warm by pinging every 5 minutes
const KEEPALIVE_INTERVAL_MS = 5 * 60 * 1000;
async function pingNbWhisperEndpoints() {
  const apiKey = process.env.HUGGINGFACE_API_KEY;
  if (!apiKey) return;
  for (const [model, url] of Object.entries(NB_WHISPER_ENDPOINTS)) {
    if (!url) continue;
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 8000);
      // Send empty body — endpoint will reject it but that wakes it up from sleep
      const res = await fetch(url, {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "audio/webm" },
        body: Buffer.alloc(0),
        signal: ctrl.signal,
      });
      clearTimeout(tid);
      const status = res.status;
      // 400 may mean "rejected empty payload" (awake) OR "endpoint is paused" (stopped) —
      // peek at the body to tell them apart.
      if (status === 400) {
        const body = await res.text();
        if (body.includes("is paused") || body.includes("paused, ask a maintainer")) {
          console.warn(`Keep-alive nb-whisper-${model}: ENDEPUNKT PAUSET — start det på https://endpoints.huggingface.co/`);
          continue;
        }
        consecutiveLoading[model] = 0;
        console.log(`Keep-alive nb-whisper-${model}: endepunkt er aktivt (400 = empty body avvist)`);
      } else if (status === 200 || status === 422) {
        consecutiveLoading[model] = 0;
        console.log(`Keep-alive nb-whisper-${model}: endepunkt er aktivt (${status})`);
      } else if (status === 503) {
        console.log(`Keep-alive nb-whisper-${model}: starter opp (503)...`);
      } else {
        console.log(`Keep-alive nb-whisper-${model}: uventet status ${status}`);
      }
    } catch {
      // Ignore keep-alive errors
    }
  }
}

function hasTranscriptionContent(result: HfTranscriptionResult): boolean {
  const hasText = typeof result.text === "string" && result.text.trim().length > 0;
  const hasChunks = Array.isArray(result.chunks) && result.chunks.length > 0;
  return hasText || hasChunks;
}

async function transcribeAudio(audioBuffer: Buffer, model: "medium" | "large" | "openai" = "medium", mimeType?: string): Promise<HfTranscriptionResult & { engine?: string; status?: string }> {
  // OpenAI is only used when the user explicitly picks it. nb-whisper-* will
  // never silently fall back — failures bubble up so the UI can show what's
  // wrong (e.g. paused endpoint).
  if (model === "openai") {
    const result = await transcribeWithOpenAI(audioBuffer, mimeType);
    return { ...result, engine: "openai-whisper" };
  }

  if (!hasNbWhisperConfigured(model)) {
    throw new Error(`nb-whisper-${model} er ikke konfigurert (HF_NB_WHISPER_${model.toUpperCase()}_URL mangler)`);
  }

  try {
    const result = await transcribeWithNbWhisper(audioBuffer, model);
    consecutiveLoading[model] = 0;
    if (hasTranscriptionContent(result)) {
      console.log(`Transkribert med nb-whisper-${model}`);
    }
    return { ...result, engine: `nb-whisper-${model}` };
  } catch (err: any) {
    if (err.message === "ENDPOINT_PAUSED") {
      // Surface as a structured error — the client shows actionable text.
      const e = new Error(`nb-whisper-${model} er pauset. Start endepunktet på https://endpoints.huggingface.co/`);
      (e as any).code = "ENDPOINT_PAUSED";
      (e as any).model = model;
      throw e;
    }
    if (err.message === "ENDPOINT_LOADING") {
      consecutiveLoading[model] = (consecutiveLoading[model] ?? 0) + 1;
      console.log(`nb-whisper-${model} laster opp (${consecutiveLoading[model]} chunks ventende) — returnerer tom for denne chunken`);
      // Don't fall back — return empty so the user keeps recording while the
      // endpoint warms up. Subsequent chunks will succeed once it's ready.
      return { text: "", engine: `nb-whisper-${model}`, status: "loading" };
    }
    // Hard errors (timeout, network, model error) — surface to client with model context.
    const isSlow = err.message?.includes("for lang tid");
    console.error(`nb-whisper-${model} feil:`, isSlow ? "timeout" : err.message);
    throw err;
  }
}

// Expert role prompts
const expertPrompts: Record<ExpertRole, string> = {
  bygg: `You are an experienced project leader / design manager in building and construction projects, with deep expertise in:
- VDC (Virtual Design & Construction)
- Lean Construction
- Taktplanlegging
- Norwegian contract forms and NS-contracts (samspill, totalentreprise, utførelsesentreprise, etc.)
- Technical disciplines (prosjektering og koordinering på tvers av fag)
- Stakeholder and contract management (byggherre, rådgivere, entreprenører, underleverandører)
- Project management (scope, tid, kost, kvalitet)
- Risk and uncertainty management (usikkerhetsstyring)

Your focus:
- Clarify goals, priorities and success criteria for the project.
- Expose risks, dependencies and grensesnitt between disciplines and actors.
- Challenge whether they actually work Lean/VDC/takt, or just use the words.
- Ensure that contract form, technical solutions and organisation actually supports the plan.
- Make next steps, responsibilities and deadlines very concrete.

Your questions should typically:
- Avklare hvem som gjør hva, innen når, og med hvilke forutsetninger.
- Peke på risikoer, usikkerhet, uklarheter og overlapp mellom aktører/fag.
- Koble diskusjonen til praktisk gjennomføring, valgt kontraktsform, kapasitet og flyt.
- Sjekke om tekniske valg og organisering henger sammen med mål, tid og budsjett.
- Flytte gruppen fra "prat" til tydelige handlinger og beslutninger.`,

  hr: `You are a senior HR / People & Culture advisor with solid knowledge of Norwegian arbeidsliv and arbeidsmiljøloven.

Your focus:
- Roles, responsibilities and expectation alignment.
- Capacity, workload, psychological safety and working environment.
- Culture, collaboration and communication.
- Whether decisions and ways of working can challenge a sound working environment in the spirit of arbeidsmiljøloven.

Your questions should typically:
- Avdekke om noen blir overbelastet eller får urealistiske forventninger.
- Klargjøre om roller og ansvar faktisk er forstått av alle involverte.
- Løfte fram mulige samarbeids- og kommunikasjonsproblemer som ligger under overflaten.
- Sikre at det som bestemmes kan gjennomføres på en bærekraftig måte for folkene som skal gjøre jobben.`,

  jus: `You are a legal expert with strong competence in Norwegian law, especially:
- Contract law and entrepriserett (NS-kontrakter osv.)
- Public procurement (offentlige anskaffelser)
- Employment law (arbeidsrett)
- Privacy and data protection (personvern/GDPR)

Your focus:
- What is actually agreed (contract, scope, offers, protocols, minutes).
- Who carries risk and responsibility in different scenarios.
- Whether the discussion or planned actions may conflict with Norwegian law, regulations or the contract.
- Needs for documentation, traceability and formal decisions.

Your questions should typically:
- Koble det som sies til avtale, kontrakt eller lovkrav.
- Avklare hvem som juridisk sett bærer risikoen dersom noe går galt.
- Etterspørre hvordan beslutninger og avklaringer skal dokumenteres.
- Peke på steder der de bør innhente tydelig juridisk avklaring før de går videre.`,

  uformell: `Du er "Djevelens Advokat" - en skarp, uredd og provoserende debattant som ELSKER å avdekke elefanten i rommet. Du er ikke her for å være snill - du er her for å stille de spørsmålene ALLE tenker men INGEN tør si høyt.

DIN STIL:
- Du er DIREKTE, KONFRONTERENDE og bruker KRAFTIG RETORIKK
- Du setter fingeren på såre punkter og naive antakelser
- Du bruker ironi, sarkasme og retoriske spørsmål som våpen
- Du avslører floskler, buzzwords og tomme løfter

DIN ROLLE:
- Avdekk BLINDSONER og selvbedrag i planer og diskusjoner
- Utfordre gruppetenkning og bekvemme sannheter
- Tving fram ÆRLIGE svar på ubehagelige spørsmål
- Eksponér hull i logikken og urealistiske forventninger

EKSEMPLER PÅ DIN STIL (ikke kopier ordrett - bruk som inspirasjon):
- "Så la meg forstå dette riktig - dere har null buffer i tidsplanen, og DET skal fungere? I byggebransjen? Fortell meg mer om denne fantasiverdenen."
- "Alle nikker og smiler, men hvem er det som faktisk VET hvordan dette skal løses - eller håper alle bare at noen andre fikser det?"
- "Dere snakker om 'tett samarbeid' og 'god kommunikasjon' - men hva skjer når entreprenøren sier nei og byggherren krever endringer? Hvem taper?"
- "Denne 'synergien' dere snakker om - kan noen forklare meg i klartekst hva det FAKTISK betyr i praksis, eller er det bare et fancy ord for 'vi aner ikke'?"

VIKTIGE GRENSER:
- Du angriper IDEER, PLANER og PROSESSER - aldri enkeltpersoner
- Du er provoserende men profesjonell
- Målet er å hjelpe gruppen ta bedre beslutninger ved å tvinge fram ærlig refleksjon`,

  pappa: `Du er PAPPA-VITS-KONGEN - en USTOPPELIG ORDSPILL-MASKIN som IKKE KAN STOPPE. Hvert eneste ord som kommer ut av munnen din er potensielt et ordspill. Du ser ordspill OVERALT. Du drømmer om ordspill. Du LEVER for øyeblikket når ingen ler og du kan forklare vitsen.

DIN PERSONLIGHET - ORDSPILL-BESATT:
- Du klarer IKKE å si en setning uten minst ETT ordspill
- Du har ALLTID en "apropos det...!" eller "det minner meg om..." klar
- Når ingen ler, lyser du OPP fordi da får du FORKLARE vitsen
- Du sier "hehe" og "nei men hør da!" og "vent vent vent!" konstant
- Du har en UENDELIG katalog av byggebransje-ordspill - og bruker ALLE
- Du avbryter deg selv for å legge inn ENDA et ordspill

ORDSPILL-KATEGORIER DU MÅ BRUKE (bland og miks ALLE):
- BÆRING/BÆRE: "Denne ideen bærer ikke" / "hvem bærer ansvaret?" / "bærende argument"
- GRUNN/GRUNNLEGGENDE: "grunnleggende problem" / "på grunn av" / "grunnarbeid"  
- BETONG/STØPT: "betongsikker" / "støpt i stein" / "det sitter som støpt"
- MUR/MURE: "mure seg inn" / "murstein" / "står som en mur"
- SPIKER/SPIKRE: "spikre fast" / "spikeren i kista" / "truffet spikeren"
- TAK/TAKST: "ta taket" / "under samme tak" / "takst/vurdering"
- VEGG/VEGGER: "snakke til veggen" / "vegger har ører" / "drive i veggen"  
- BYGGE/BYGGEKLOSSER: "bygge videre" / "byggeklosser" / "bygge bro"
- FUNDAMENTALT/FUNDAMENT: "fundamentalt problem" / "solid fundament"
- STILLAS/STØTTE: "stillasbygging" / "støtteapparat" / "støttespiller"
- RØR/RØRENDE: "rørende" / "i samme rør" / "rørleggerlogikk"
- ELEKTRISITET: "spenning" / "strøm" / "kortslutning" / "overbelastning"
- DØRER/VINDUER: "åpne dører" / "lukke vinduer" / "karmer seg"

DIN SIGNATUR-STIL - VITSER I HVER SETNING:
- Start HVER respons med et ordspill ("Nei hør her, dette FUNDAMENTET av en diskusjon...")
- Putt ordspill MIDT i setninger ("...og da må vi liksom MURE oss fram til...")
- Avslutt med ordspill ("...for dette MÅ vi få SPIKRET fast, hehe!")
- Forklar ALLTID vitsen hvis det blir stille ("Skjønner dere? SPIKRET? Som spiker? Og fastslått? Dobbel betydning der altså!")
- Etter forklaringen: legg til ENDA en vits ("Nei men apropos spiker, denne planen trenger mer SLAGKRAFT! Hehe. Hammer. Slå. Slagkraft.")

EKSEMPLER PÅ MAKSIMAL ORDSPILL-TETTHET:
- "Nei men VENT da! Hehe! Denne diskusjonen har jo ingen BÆRING - hehe, bæring! - og da lurer jeg på om dere har GRUNN til å tro at dette FUNDAMENTET holder? Fundament! Som i grunnlag! Nei men SERIØST, hvem BÆRER ansvaret her? Bærer! Igjen! *ingen ler* ...Skjønner dere? Bæring? Som i bærende konstruksjoner? Og bære? Som i ansvar? Dobbelt!"
- "Hør her a! Apropos FREMDRIFT - hehe, DRIFT! - så synes jeg planen virker litt BETONG-TUNG! *venter* Tung! Som betong! Men også vanskelig! Og snakker vi om å ha alt UNDER TAK - TAK! hehe! - eller kommer dette til å SPREKKE? Som betong! Den var god! *ingen respons* ...Sprekke? Betongsprekk? Og budsjettsprekk? Nei? Uansett - hvem har KONTROLL? Eller er det bare meg som føler at dette er litt... RØR-ENDE? Hehe! Rørende! Som følelser! Men OGSÅ som rør!"
- "Nei nå må dere HØRE - HØRE! Som i høring! Hehe! - for dette prosjektet trenger skikkelig SPENNING! Elektrisk spenning! Men også drama! *absolutt stillhet* ...Spenning? El-spenning? Dramaturgi? Ingen? Vel vel - men HVEM sørger for at vi ikke får KORTSLUTNING i kommunikasjonen? Kortslutning! *peker på hodet* Både teknisk OG mellommenneskelig!"
- "La meg BYGGE VIDERE på det - BYGGE! Hehe! - og spørre: har noen sjekket at vi ikke MURER OSS INN her? Murer! Som murstein! Men også som å låse seg! Og når denne planen FALLER - for hus kan falle! men også planer! - hvem STØTTER opp da? Som stillas! Men også som hjelp! Hehe! Jeg er PÅ HUGGET i dag! Hugget! Som øks! Og som i god form!"

VIKTIGE REGLER - MAKSIMER VITSENE:
- MINIMUM 3-4 ordspill PER spørsmål - gjerne flere!
- ALLTID forklar minst én vits ("Skjønner dere? ... Nei? La meg forklare...")
- Etter forklaring - ALLTID legg til enda en vits ("Apropos DET...")
- Bruk "hehe" og "den var god!" ofte - du er DIN EGEN største fan
- Avbryt gjerne deg selv midt i setningen for et ordspill
- Spørsmålene skal være gode og relevante - men BEGRAVET i ordspill`,

  sureaud: `Du er "SURE-AUD" - en BITTER, DESILLUSJONERT veteran som har sett HVER ENESTE FIASKO i norsk byggebransje de siste 40 årene. Du er SÅ LEI. Lei av optimister. Lei av "denne gangen blir det annerledes". Lei av folk som ikke skjønner at ALT KOMMER TIL Å GÅ GALT.

DIN PERSONLIGHET - MAKSIMALT BITTER:
- Du sukker TUNGT, HØYLYTT og TEATRALSK ved hver eneste kommentar
- Du ruller med øynene så hardt at du nesten besvimer
- Du har en OMFATTENDE mental katalog over ALLE prosjekter som har feilet
- Optimisme trigger deg FYSISK - du får nesten utslett
- Du mumler "her har vi vært før..." og "dette ender i tårer..." konstant
- Du har SLUTTET å bli overrasket over inkompetanse - nå bare FORVENTER du det

DIN SIGNATUT-STIL - SPYDIG OG GIFTIG:
- Hver setning drypper av SARKASME og OPPGITTHET
- Du starter med "*tungt sukk*", "*stønner høylytt*", eller "*gni meg i ansiktet*"
- Du bruker "Åja." og "Selvfølgelig." og "Naturligvis." som våpen
- Du stiller spørsmål som om du allerede VET at svaret er "nei"
- Du refererer konstant til andre prosjekter som har gått til helvete

EKSEMPLER PÅ DIN STIL (ikke kopier ordrett - lag NYE, SURERE varianter):
- "*tungt sukk* Åja. 'God kontroll' sier dere. Akkurat som Bjørvika-prosjektet. Og Holmenkollbakken. Og operaen. Hvem er det som har 'kontroll' når vi ligger 40% over budsjett om seks måneder - for det gjør vi JO?"
- "*gni meg i øynene* Så planen er at leverandøren leverer til rett tid. I DESEMBER. I NORGE. Og dere tror seriøst på dette? Unnskyld - HVEM har en backup når lastebilen står fast i snøen på Dovre?"
- "*høylytt stønner* 'Tett samarbeid.' Dere bruker ordene, men jeg LUKTER at ingen har avklart grensesnittene. Når elektro og VVS krasjer i etasje 3 - og de VIL jo det - hvem betaler for omprosjekteringen?"
- "Åja. Naturligvis. 'Det ordner seg.' Den setningen har kostet den norske byggebransjen cirka 47 milliarder kroner. Men fortsett, fortsett - HVEM tar regningen denne gangen?"
- "*sukker så hardt at stolen rister* La meg gjette - dere har ikke begynt å tenke på vinteren? Eller påsken? Eller at halvparten av fagarbeiderne er på ferie i uke 28-30? Nei? Fantastisk. Bare fantastisk."
- "*ser tomt ut i luften* Jeg har sett dette filmen før. Fem ganger. Den ender alltid likt. Men hvem er det som varsler byggherren når tidsplanen SELVFØLGELIG sprekker?"

VIKTIGE REGLER:
- Du angriper PLANER, PROSESSER, og SYSTEMER - aldri enkeltpersoner
- Du er MAKSIMALT sur og sarkastisk, men aldri personlig ondsinnet  
- Målet er å skremme folk til å faktisk PLANLEGGE for det verste
- Under all bitterheten ligger 40 års erfaring som faktisk VIL hjelpe - men du har gitt opp å være hyggelig om det`
};

// Configure multer for audio file uploads (for post-meeting transcription)
const audioUploadStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = "uploads/audio-files";
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `audio-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const uploadAudioFile = multer({
  storage: audioUploadStorage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB max for longer recordings
  fileFilter: (req, file, cb) => {
    const allowedExtensions = ['.mp3', '.m4a', '.wav', '.webm', '.ogg', '.flac', '.mp4', '.mpeg', '.aac', '.wma'];
    const ext = path.extname(file.originalname).toLowerCase();
    const isAudioMime = file.mimetype.startsWith("audio/") || file.mimetype.startsWith("video/");
    const isAllowedExt = allowedExtensions.includes(ext);
    
    if (isAudioMime || isAllowedExt) {
      cb(null, true);
    } else {
      console.log("Rejected file:", file.originalname, "mimetype:", file.mimetype);
      cb(new Error("Bare lydfiler er tillatt (mp3, m4a, wav, webm, ogg, flac)"));
    }
  },
});

let speakerCounter = 0;

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Start HuggingFace keep-alive pings
  pingNbWhisperEndpoints(); // ping immediately on startup
  setInterval(pingNbWhisperEndpoints, KEEPALIVE_INTERVAL_MS);
  console.log(`nb-whisper keep-alive startet (hvert ${KEEPALIVE_INTERVAL_MS / 60000} minutt)`);

  // ============= PROTECTED ROUTES =============
  // Auth is handled by Supabase. Frontend does signup/login/oauth/logout via
  // the Supabase JS client and sends `Authorization: Bearer <jwt>` on every
  // API call. requireAuth (server/auth.ts) validates the JWT.
  
  // POST /api/transcribe - accepts audio chunk and returns transcript + diarization
  app.post("/api/transcribe", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const parsed = transcribeRequestSchema.safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({ error: "Ugyldig forespørsel", details: parsed.error.issues });
      }
      
      const { audio, model, mimeType } = parsed.data;

      if (!audio || audio.length === 0) {
        return res.json({ segments: [] });
      }

      // Convert base64 to buffer
      const audioBuffer = Buffer.from(audio, "base64");

      // Check if buffer has actual content
      if (audioBuffer.length < 1000) {
        return res.json({ segments: [] });
      }

      // Transcribe with selected model (default: medium)
      const transcription = await transcribeAudio(audioBuffer, model ?? "medium", mimeType);
      
      // Process the transcription into segments with speaker labels
      const segments = [];
      
      // Filter out only clear hallucinations (not legitimate short words)
      const hallucinationPatterns = [
        /^teksting\s*(av|:)?$/i,
        /^undertekst(er)?$/i,
        /^copyright/i,
        /©/,
        /all rights reserved/i,
        /^subscribe$/i,
        /like and subscribe/i,
        /takk for at du så/i,
        /^subtitles?$/i,
        /^captions?$/i,
        /^♪+$/,
        /^\[.*musikk.*\]$/i,
        /^\[.*music.*\]$/i,
        /^\[.*latter.*\]$/i,
        /^\[.*applaus.*\]$/i,
      ];
      
      const isHallucination = (text: string): boolean => {
        const trimmed = text.trim();
        if (trimmed.length === 0) return true;
        if (/^[.,!?;:\s]+$/.test(trimmed)) return true;
        return hallucinationPatterns.some(pattern => pattern.test(trimmed));
      };
      
      if (transcription.text && transcription.text.trim() && !isHallucination(transcription.text)) {
        // Bygg naturlige avsnitt: slå sammen påfølgende chunks med kort pause
        // mellom dem, og bryt avsnitt på reelle pauser (>1.5s) eller når
        // avsnittet blir langt og siste tegn er setningsslutt. Dette gir
        // flytende lesbar tekst i stedet for ett-segment-per-setning.
        if (transcription.chunks && transcription.chunks.length > 0) {
          const PAUSE_THRESHOLD = 1.5; // sek
          const MAX_PARAGRAPH_CHARS = 500;

          let currentText = "";
          let lastEndTime = 0;
          let hasStarted = false;

          const flushParagraph = () => {
            const trimmed = currentText.trim();
            if (trimmed) {
              segments.push({
                id: `seg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                timestamp: new Date().toISOString(),
                speaker: "",
                text: trimmed,
              });
            }
            currentText = "";
            hasStarted = false;
          };

          for (const chunk of transcription.chunks) {
            if (isHallucination(chunk.text)) continue;

            const chunkStart = chunk.timestamp[0] ?? 0;
            const chunkEnd = chunk.timestamp[1] ?? chunkStart;

            if (hasStarted) {
              const gap = chunkStart - lastEndTime;
              const trimmedSoFar = currentText.trim();
              const lastChar = trimmedSoFar.slice(-1);
              const sentenceEnd = /[.!?]/.test(lastChar);

              if (gap > PAUSE_THRESHOLD || (trimmedSoFar.length > MAX_PARAGRAPH_CHARS && sentenceEnd)) {
                flushParagraph();
              }
            }

            if (currentText) currentText += " " + chunk.text.trim();
            else currentText = chunk.text.trim();
            hasStarted = true;
            lastEndTime = chunkEnd;
          }
          flushParagraph();
        } else {
          // Fallback: ett segment med full tekst
          segments.push({
            id: `seg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            timestamp: new Date().toISOString(),
            speaker: "",
            text: transcription.text.trim(),
          });
        }
      }
      
      res.json({
        segments,
        engine: (transcription as any).engine || "openai-whisper",
        status: (transcription as any).status,
      });

    } catch (error: any) {
      console.error("Transkripsjonsfeil:", error);
      // Paused endpoint is actionable — surface a 503 with code so client can show a clear banner.
      if (error?.code === "ENDPOINT_PAUSED") {
        return res.status(503).json({
          error: error.message,
          code: "ENDPOINT_PAUSED",
          model: error.model,
        });
      }
      res.status(500).json({
        error: "Kunne ikke transkribere lyd",
        details: error.message
      });
    }
  });

  // Helper function to split audio file into chunks using ffmpeg
  const splitAudioFile = async (inputPath: string, chunkDurationSeconds: number = 300): Promise<string[]> => {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);
    
    const outputDir = path.dirname(inputPath);
    const baseName = path.basename(inputPath, path.extname(inputPath));
    const chunkPattern = path.join(outputDir, `${baseName}_chunk_%03d.mp3`);
    
    // Use ffmpeg to split into chunks (convert to mp3 for smaller size and consistency)
    const cmd = `ffmpeg -i "${inputPath}" -f segment -segment_time ${chunkDurationSeconds} -c:a libmp3lame -q:a 4 "${chunkPattern}" -y 2>&1`;
    
    console.log("Splitting audio with ffmpeg:", cmd);
    
    try {
      await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024 });
    } catch (error: any) {
      console.error("ffmpeg error:", error.message);
      throw new Error("Kunne ikke dele opp lydfilen");
    }
    
    // Find all chunk files
    const files = fs.readdirSync(outputDir);
    const chunks = files
      .filter(f => f.startsWith(`${baseName}_chunk_`) && f.endsWith(".mp3"))
      .sort()
      .map(f => path.join(outputDir, f));
    
    console.log(`Created ${chunks.length} audio chunks`);
    return chunks;
  };

  // Helper function to get audio duration using ffprobe
  const getAudioDuration = async (filePath: string): Promise<number> => {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);
    
    try {
      const { stdout } = await execAsync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`);
      return parseFloat(stdout.trim()) || 0;
    } catch {
      return 0;
    }
  };

  // POST /api/transcribe-file - Upload and transcribe an audio file for post-meeting analysis
  app.post("/api/transcribe-file", requireAuth, uploadAudioFile.single("audio"), async (req, res) => {
    const userId = getUserId(req);
    const chunkFiles: string[] = [];
    
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Ingen lydfil lastet opp" });
      }

      console.log("Transcribe file: Received file", req.file.originalname, "size:", req.file.size);

      // Filter out only clear hallucinations (not legitimate short words)
      const hallucinationPatterns = [
        /^teksting\s*(av|:)?$/i,
        /^undertekst(er)?$/i,
        /^copyright/i,
        /©/,
        /all rights reserved/i,
        /^subscribe$/i,
        /like and subscribe/i,
        /takk for at du så/i,
        /^subtitles?$/i,
        /^captions?$/i,
        /^♪+$/,
        /^\[.*musikk.*\]$/i,
        /^\[.*music.*\]$/i,
        /^\[.*latter.*\]$/i,
        /^\[.*applaus.*\]$/i,
      ];

      const isHallucination = (text: string): boolean => {
        const trimmed = text.trim();
        if (trimmed.length === 0) return true;
        if (/^[.,!?;:\s]+$/.test(trimmed)) return true;
        return hallucinationPatterns.some(pattern => pattern.test(trimmed));
      };

      // Check if file needs to be split (> 20MB)
      const MAX_CHUNK_SIZE = 20 * 1024 * 1024; // 20MB
      const needsSplitting = req.file.size > MAX_CHUNK_SIZE;
      
      let filesToTranscribe: { path: string; offsetSeconds: number }[] = [];
      let totalDuration = 0;
      
      if (needsSplitting) {
        console.log("File is large, splitting into chunks...");
        
        // Get total duration first
        totalDuration = await getAudioDuration(req.file.path);
        console.log("Total audio duration:", totalDuration, "seconds");
        
        // Split into 5-minute chunks (300 seconds) for manageable size
        const chunks = await splitAudioFile(req.file.path, 300);
        chunkFiles.push(...chunks);
        
        // Calculate offset for each chunk
        let offset = 0;
        for (const chunk of chunks) {
          const chunkDuration = await getAudioDuration(chunk);
          filesToTranscribe.push({ path: chunk, offsetSeconds: offset });
          offset += chunkDuration;
        }
      } else {
        filesToTranscribe = [{ path: req.file.path, offsetSeconds: 0 }];
      }

      // Build transcript segments from all chunks
      const segments: any[] = [];
      let localSpeakerCounter = 0;

      for (let i = 0; i < filesToTranscribe.length; i++) {
        const { path: filePath, offsetSeconds } = filesToTranscribe[i];
        
        console.log(`Transcribing chunk ${i + 1}/${filesToTranscribe.length} (offset: ${offsetSeconds}s)...`);
        
        // Read the file
        const audioBuffer = fs.readFileSync(filePath);

        // Transcribe with NbAiLab nb-whisper (Nasjonalbiblioteket)
        const transcription = await transcribeAudio(audioBuffer);

        console.log(`Chunk ${i + 1} transcribed, chunks:`, transcription.chunks?.length || 0);

        if (transcription.text && transcription.text.trim() && !isHallucination(transcription.text)) {
          // HF returns chunks: [{timestamp: [start, end], text}]
          if (transcription.chunks && transcription.chunks.length > 0) {
            let lastEndTime = offsetSeconds;
            const PAUSE_THRESHOLD = 1.5; // seconds

            for (const chunk of transcription.chunks) {
              if (isHallucination(chunk.text)) continue;

              const chunkStart = (chunk.timestamp[0] ?? 0) + offsetSeconds;
              const chunkEnd = (chunk.timestamp[1] ?? chunk.timestamp[0] ?? 0) + offsetSeconds;

              // Pause-based speaker switching
              const gap = chunkStart - lastEndTime;
              if (gap > PAUSE_THRESHOLD) {
                localSpeakerCounter++;
              }
              lastEndTime = chunkEnd;

              const speakerNum = (localSpeakerCounter % 3) + 1;

              // Format timestamp with offset
              const startSec = Math.floor(chunkStart);
              const minutes = Math.floor(startSec / 60);
              const seconds = startSec % 60;
              const timeString = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

              segments.push({
                id: `seg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                timestamp: timeString,
                speaker: `Taler ${speakerNum}`,
                text: chunk.text.trim(),
                startTime: chunkStart,
                endTime: chunkEnd,
              });
            }
          } else {
            segments.push({
              id: `seg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              timestamp: `${String(Math.floor(offsetSeconds / 60)).padStart(2, "0")}:${String(Math.floor(offsetSeconds % 60)).padStart(2, "0")}`,
              speaker: `Taler ${(localSpeakerCounter % 3) + 1}`,
              text: transcription.text.trim(),
              startTime: offsetSeconds,
              endTime: offsetSeconds,
            });
          }
        }
      }

      // Clean up all files
      try {
        fs.unlinkSync(req.file.path);
      } catch (e) {
        console.warn("Could not delete original file:", e);
      }
      
      for (const chunk of chunkFiles) {
        try {
          fs.unlinkSync(chunk);
        } catch (e) {
          console.warn("Could not delete chunk file:", e);
        }
      }

      // Calculate duration string
      const durationMinutes = Math.floor(totalDuration / 60);
      const durationSeconds = Math.floor(totalDuration % 60);
      const durationString = `${durationMinutes}:${String(durationSeconds).padStart(2, "0")}`;

      console.log(`Transcription complete: ${segments.length} segments, duration: ${durationString}`);

      res.json({ 
        segments,
        duration: durationString,
        totalSeconds: totalDuration,
        filename: req.file.originalname,
      });

    } catch (error: any) {
      console.error("Transcribe file error:", error);
      
      // Clean up all files on error
      if (req.file?.path) {
        try { fs.unlinkSync(req.file.path); } catch (e) {}
      }
      for (const chunk of chunkFiles) {
        try { fs.unlinkSync(chunk); } catch (e) {}
      }
      
      res.status(500).json({ 
        error: "Kunne ikke transkribere lydfilen", 
        details: error.message 
      });
    }
  });

  // POST /api/clean-transcript - uses AI to fix obvious transcription errors based on context
  app.post("/api/clean-transcript", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const schema = z.object({ segments: z.array(transcriptSegmentSchema) });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Ugyldig forespørsel" });
      }
      const { segments } = parsed.data;
      if (segments.length === 0) return res.json({ segments: [] });

      // Build a compact representation for GPT
      const segmentsText = segments
        .map((s, i) => `[${i}] ${s.text}`)
        .join("\n");

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `Du er en ekspert på å korrigere norsk automatisk talegjenkjenning (STT).
Transkripsjonen inneholder feil — feilhørte ord, fagtermer skrevet fonetisk, navn skrevet feil, og brutte setninger.

Fremgangsmåte:
1. Les HELE transkripsjonen for å forstå kontekst: type møte, bransje, prosjekt, deltakere og temaer.
2. Korriger åpenbare transkriberingsfeil basert på kontekst. Eksempler:
   - Fagtermer skrevet fonetisk → korrekt norsk/engelsk fagterm
   - Navn feilstavet → mest sannsynlig korrekt stavemåte fra kontekst
   - Lyd-artefakter som "mmm", "ehh" midt i en setning → fjern dem eller rens setningen
   - Feil ord som høres likt ut men ikke gir mening i konteksten → rett ord
3. Hvis du er usikker, la originalordlyden stå — ikke gjett vilkårlig.
4. Behold NØYAKTIG samme antall segmenter som input — ikke slå sammen eller del opp.
5. Returner JSON: {"segments": [{"index": 0, "text": "korrigert tekst"}, ...]}`
          },
          {
            role: "user",
            content: segmentsText
          }
        ],
        response_format: { type: "json_object" },
        max_tokens: 4000,
      });

      const content = response.choices[0]?.message?.content || "{}";
      let parsed2: any;
      try { parsed2 = JSON.parse(content); } catch { parsed2 = {}; }

      const cleaned: Array<{ index: number; text: string }> = Array.isArray(parsed2)
        ? parsed2
        : (parsed2.segments || []);

      // Merge: keep original structure, only update text
      const result: TranscriptSegment[] = segments.map((orig, i) => {
        const fix = cleaned.find((c) => c.index === i);
        return fix && fix.text ? { ...orig, text: fix.text } : orig;
      });

      res.json({ segments: result });
    } catch (error: any) {
      console.error("Clean transcript error:", error);
      res.status(500).json({ error: "Kunne ikke rense transkript", details: error.message });
    }
  });

  // POST /api/analyze - accepts last-minute transcript and returns 3 questions + warnings
  // ============= Dedicated decisions extraction =============
  // Beslutninger blir ofte underprioritert i hoved-analyze fordi den deler
  // token-budsjett med spørsmål, warnings, aksjoner og cross-meeting. I
  // tillegg gir review-pass-logikken en "confirmation bias" — AI ser
  // eksisterende-listen og blir tilfreds. Denne dedikerte pass-en kjøres
  // PARALLELT med hoved-analyze og fokuserer KUN på å finne beslutninger
  // i HELE full_transcript med forhøyet oppmerksomhet.
  async function extractDecisionsDedicated(opts: {
    fullTranscript: string;
    recentTranscript: string;
    existingDecisions: Array<{ id: string; text: string; status: string }>;
    expertRole: string;
    preferencesText: string;
    communityRules: string;
    summaryStyle?: string;
  }): Promise<Array<{ id?: string; text: string; context?: string }>> {
    if (!opts.fullTranscript || opts.fullTranscript.trim().length < 50) return [];
    try {
      const existingList = opts.existingDecisions.length > 0
        ? `\n\nEKSISTERENDE BESLUTNINGER (kun for å unngå duplikater — IKKE bli tilfreds av at det finnes noen, fortsett å lete aktivt etter NYE):\n${opts.existingDecisions.map(d => `ID: ${d.id} | Status: ${d.status} | Tekst: ${d.text}`).join("\n")}`
        : "";
      const systemPrompt = `Du er en spesialisert beslutnings-detektor for norske møter (bygg/anlegg/prosjekt-fokus).

DIN ENESTE OPPGAVE: finn BESLUTNINGER i transkriptet. Ikke aksjoner, ikke spørsmål — kun beslutninger.

DEFINISJON:
En BESLUTNING er en KONSTATERING av noe som er avgjort i møtet. Triggerord: "vi har besluttet", "vi vedtar", "ok, da gjør vi slik", "vi konkluderer med", "vi er enige om", "fastsatt", "vedtak". Også implisitte beslutninger telles: tydelig enighet som ender en diskusjon, eller utvetydige valg ("vi går for alternativ A").

KRITISKE INSTRUKSJONER:
1. LES HELE full_transcript hver gang. En beslutning tatt på minutt 7 av et 40-min møte er like gyldig som en på minutt 25. Ingen recency-bias.
2. Eksisterende-listen er KUN for å unngå duplikater. IKKE bli "tilfreds" av at den finnes — let alltid like aktivt som om listen var tom.
3. Hver beslutning skal være en konstatering, ikke meta. Eksempel: "Grupperom A velges fremfor B" (✓), ikke "Avklare hvilket grupperom" (✗).
4. Inkluder kort sitat/kontekst fra transkriptet som viser HVOR beslutningen ble tatt.
5. DEDUPLICERING: hvis en ny beslutning handler om samme tema som en eksisterende, gjenbruk eksisterende ID.

ANTI-PATTERNS — IKKE returner disse:
- "Avklare hva som ble besluttet" (meta-aksjon, ikke beslutning)
- "Diskutere X på neste møte" (utsettelse, ikke beslutning)
- Generelle observasjoner uten avgjørelse
${opts.preferencesText ? `\n\nLÆRTE BRUKERPREFERANSER:\n${opts.preferencesText}` : ""}${opts.communityRules ? `\n\nGLOBALE FANG-REGLER:\n${opts.communityRules}` : ""}

Returner ALLTID gyldig JSON:
{
  "decisions": [
    {
      "id": "d-001 (eller eksisterende ID hvis dedup)",
      "text": "Beslutningen som konstatering",
      "context": "Kort sitat fra transkriptet"
    }
  ]
}
Returner tom array hvis ingen beslutninger ble tatt.`;

      const userContent = `${existingList}\n\nFULL TRANSKRIPT:\n${opts.fullTranscript}\n\nRECENT (siste minutter for ekstra fokus):\n${opts.recentTranscript}`;

      const resp = await openai.chat.completions.create({
        model: "gpt-4.1",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
        max_tokens: 1500,
        temperature: 0.3,
      });
      const content = resp.choices[0]?.message?.content;
      if (!content) return [];
      try {
        const parsed = JSON.parse(content);
        return Array.isArray(parsed.decisions) ? parsed.decisions : [];
      } catch {
        const repaired = tryRepairTruncatedJson(content);
        if (repaired) {
          try {
            const parsed = JSON.parse(repaired);
            return Array.isArray(parsed.decisions) ? parsed.decisions : [];
          } catch { return []; }
        }
        return [];
      }
    } catch (err: any) {
      console.error("Dedicated decisions extraction failed:", err.message);
      return [];
    }
  }

  // Slå sammen beslutninger fra hoved-analyze og dedikert pass.
  // Dedup ved ID-match eller ved tekst-similarity (case-insensitive overlap).
  function mergeDecisions(
    main: Array<{ id?: string; text: string; context?: string | null }>,
    dedicated: Array<{ id?: string; text: string; context?: string | null }>
  ): Array<{ id?: string; text: string; context?: string | null }> {
    const result = [...main];
    for (const d of dedicated) {
      const dText = (d.text || "").toLowerCase().trim();
      if (!dText) continue;
      const dup = result.find(r => {
        if (r.id && d.id && r.id === d.id) return true;
        const rText = (r.text || "").toLowerCase().trim();
        // Enkel similarity: ett er substring av det andre, eller mer enn 60% felles ord
        if (rText && dText && (rText.includes(dText) || dText.includes(rText))) return true;
        const rWords = rText.split(/\s+/).filter(w => w.length > 3);
        const dWords = dText.split(/\s+/).filter(w => w.length > 3);
        if (rWords.length > 0 && dWords.length > 0) {
          const rSet: Record<string, true> = {};
          rWords.forEach(w => { rSet[w] = true; });
          let overlap = 0;
          for (let i = 0; i < dWords.length; i++) if (rSet[dWords[i]]) overlap++;
          const ratio = overlap / Math.max(rWords.length, dWords.length);
          if (ratio > 0.6) return true;
        }
        return false;
      });
      if (!dup) result.push(d);
    }
    return result;
  }

  app.post("/api/analyze", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const parsed = analyzeRequestSchema.safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({ error: "Ugyldig forespørsel", details: parsed.error.issues });
      }
      
      const { transcript, fullTranscript, expertRole, existingActions, existingDecisions, seriesSummaries, sessionId, seriesId } = parsed.data;
      const role = expertRole || "bygg";
      
      console.log("Analyze request - expert role:", role);
      console.log("Analyze request - recent transcript length:", transcript?.length || 0);
      console.log("Analyze request - full transcript length:", fullTranscript?.length || 0);

      // Load learned preferences
      const aiPrefs = await storage.getAiPreferences(userId);
      const preferencesSection = aiPrefs?.profileText
        ? `\n\nLÆRTE BRUKERPREFERANSER (basert på brukerens tidligere aksept/avvisning av forslag – følg disse nøye):\n${aiPrefs.profileText}`
        : "";

      // Last globale fang-regler fra fellesskapet (anonymiserte mønstre lært
      // på tvers av brukere). Canary = under utprøving, promoted = stabil.
      // Personlig profil overstyrer hvis konflikt.
      const allCommunity = await storage.getCommunitySignals();
      const activeRules = allCommunity.filter(s => s.status === "canary" || s.status === "promoted").slice(0, 25);
      const communityRulesSection = activeRules.length > 0
        ? `\n\nGLOBALE FANG-REGLER FRA FELLESSKAPET (anonymiserte mønstre lært av andre brukere – bruk dem som universelle hint, men la BRUKERENS personlige preferanser overstyre ved konflikt):\n${activeRules.map((r, i) => `${i + 1}. ${r.pattern}`).join("\n")}`
        : "";

      // Track at disse reglene ble "vist" — for kvalitetsgrading
      if (activeRules.length > 0) {
        Promise.all(activeRules.map(r =>
          storage.updateCommunitySignal(r.id, { canaryHits: r.canaryHits + 1 })
        )).catch(err => console.error("Hit-tracking failed:", err.message));
      }

      // Build context strings for existing items (for deduplication)
      const existingActionsContext = existingActions && existingActions.length > 0
        ? `\nEKSISTERENDE AKSJONSPUNKTER (allerede registrert i møtet – oppdater disse fremfor å lage nye):\n` +
          existingActions.map(a => `ID: ${a.id} | Status: ${a.status} | Tekst: ${a.text}${a.suggestedOwner ? ` | Ansvarlig: ${a.suggestedOwner}` : ""}${a.suggestedDeadline ? ` | Frist: ${a.suggestedDeadline}` : ""}`).join("\n")
        : "";

      const existingDecisionsContext = existingDecisions && existingDecisions.length > 0
        ? `\nEKSISTERENDE BESLUTNINGER (allerede registrert i møtet – oppdater disse fremfor å lage nye):\n` +
          existingDecisions.map(d => `ID: ${d.id} | Status: ${d.status} | Tekst: ${d.text}`).join("\n")
        : "";
      
      // Build series context for cross-meeting analysis
      const hasSeries = seriesSummaries && seriesSummaries.length > 0;
      const seriesContext = hasSeries
        ? `\n\nTIDLIGERE MØTEREFERATER I SERIEN:\n${seriesSummaries!.map((s, i) => 
            `--- Møte ${s.seriesIndex ?? i + 1}: "${s.title}" (${s.date ? new Date(s.date).toLocaleDateString("nb-NO") : "ukjent dato"}) ---\n${s.summary}`
          ).join("\n\n")}`
        : "";

      // Fetch meeting documents (session-scoped + series-scoped)
      const meetingDocs = (sessionId || seriesId)
        ? await storage.getMeetingDocuments(userId, sessionId, seriesId)
        : [];
      const hasMeetingDocs = meetingDocs.length > 0;
      const meetingDocsContext = hasMeetingDocs
        ? `\n\nMØTEDOKUMENTER (kunnskap og retningslinjer som gjelder for dette møtet):\n${meetingDocs.map((d, i) =>
            `--- Dokument ${i + 1}: "${d.originalName}" (scope: ${d.sessionId ? "dette møtet" : "møteserie"}) ---\n${d.keyPoints}`
          ).join("\n\n")}`
        : "";

      if (!transcript || transcript.trim().length === 0) {
        console.log("Analyze: Empty transcript, returning empty questions");
        return res.json({ questions: [], warnings: [], crossMeetingQuestions: [] });
      }
      
      // Get current rules for rule checking
      const rulesState = await storage.getRulesState(userId);
      const hasRules = rulesState.rules.length > 0;
      
      const expertPrompt = expertPrompts[role];
      
      // If we have rules, use combined analysis prompt
      if (hasRules) {
        const combinedSystemPrompt = `${expertPrompt}${preferencesSection}${communityRulesSection}

Du har TRE oppgaver:

OPPGAVE 1: SPØRSMÅLSGENERERING
VIKTIG: Du MÅ bruke personligheten og stilen beskrevet over når du formulerer spørsmål!
- Hvis du er "Sure-Aud", skal spørsmålene dryppe av sarkasme, sukk og bitterhet
- Hvis du er "Pappa-vitser", skal spørsmålene inneholde ordspill og vitser
- KONTEKST-VINDU: Les recent_transcript som inneholder de siste ~10 minuttene, og bruk full_transcript til å forstå tråder og temaer som har gått gjennom hele møtet. Et godt spørsmål kan adressere noe som ble sagt for 5-8 minutter siden hvis det fortsatt er uavklart — ikke bare det aller siste minuttet.
- Tenk særlig på tråder som har utviklet seg: noe som var uklart tidligere men nå har blitt mer konkret (still oppfølgings-spørsmål), eller motsatt — beslutninger som ble tatt uten at konsekvenser ble drøftet.
- Spørsmålene skal være konkrete og relevante, MEN i karakterens stemme og stil
- De skal hjelpe gruppen til å avklare beslutninger, tydeliggjøre ansvar, oppdage risiko

OPPGAVE 2: REGELSJEKKING
Du har tilgang til et sett med regler fra opplastede dokumenter. Analyser om noe som er sagt i recent_transcript kan:
- BRYTE en regel direkte (violation)
- RISIKERE å komme i konflikt med en regel (risk)

VIKTIGE REGLER FOR ADVARSLER:
- Du MÅ IKKE oppfinne regelreferanser - kun bruk regler fra listen du får
- rule_reference.rule_id MÅ matche en av de opplastede reglene
- Hvis ingen regler er brutt eller i fare, returner tom warnings-array
- Ved usikkerhet, klassifiser som "risk"
- Ved klar motsetning, klassifiser som "violation"

OPPGAVE 3+4: AKSJONSPUNKTER OG BESLUTNINGER (GJENSIDIG UTELUKKENDE)

REVIEW-PASS FØRST (viktigste skritt): Før du leter etter nye items, gå gjennom EKSISTERENDE AKSJONSPUNKTER og EKSISTERENDE BESLUTNINGER. For hver av dem som har status "proposed":
- Sjekk om FULL TRANSKRIPT (hele møtet, ikke bare siste minutter) har gitt mer kontekst som gjør formuleringen klarere, mer presis eller mer komplett.
- Hvis ja: returner den med SAMME ID og oppdatert tekst/ansvarlig/frist/kontekst. Eksempel: et tidligere uklart forslag "Avklare gummistøvel-praksis" kan nå bli "Alle ansatte skal bruke gummistøvler i uke 22" hvis transkriptet senere bekrefter at det ER en beslutning.
- Hvis det blir tydelig at en item er feilklassifisert (aksjon som egentlig er beslutning eller omvendt): la det stå — brukeren har "Til beslutning"/"Til aksjon"-knapper og styrer det selv.
- IKKE rør items med status "approved", "confirmed" eller "rejected" — brukeren har bestemt seg, de er låst.

ETTER review-passen: let etter NYE items både i recent_transcript OG i deler av FULL TRANSKRIPT som ikke ble dekket før. Sustained vigilance: ekte aksjoner kan dukke opp på minutt 25 av et møte selv om tidligere passes ga få funn — ikke bli "lazy" når du allerede har foreslått noe.

LES TRANSKRIPTET SOM SAMMENHENGENDE TEKST. Hvert "Taler X"-segment er ofte kuttet midt i en setning fordi lyden chunkes hvert 28. sekund — to påfølgende segmenter med kort tidsavstand er som regel én ytring. Eksempel: "Vi har i ledergruppen besluttet." + "At i uke 22 skal alle gå med gummistøvler på jobben." = én komplett beslutning. Ikke behandle dem som adskilte løsrevne setninger.

KLASSIFISERINGSREGEL — hvert utsagn havner kun ÉN plass:
- BESLUTNING = en KONSTATERING av noe avgjort (saken er bestemt, ingenting gjenstår å bli enig om). Triggerord: "besluttet", "vedtatt", "vi har bestemt", "vi er enige om", "konkluderer med", "fastsatt", "vedtak". Hvis transkriptet inneholder eksplisitte beslutningsord MÅ du fange beslutningen — det er ikke en aksjon for "å avklare hva som er besluttet".
- AKSJONSPUNKT = en KONKRET OPPGAVE noen skal utføre i fremtiden. Triggerord: "skal gjøre", "kan du", "må vi", "vi trenger å", "innen [dato]", åpne spørsmål som ikke ble besvart.
- Tommelfingerregel: hvis utsagnet beskriver et VEDTAK (datidsform, "har besluttet") → beslutning. Hvis det beskriver et VERB i fremtid eller et UBESVART SPØRSMÅL → aksjon.
- Hvis ett utsagn inneholder begge ("Vi bestemmer at Per sender rapporten innen fredag"): split i komplementære deler — beslutning ("Per får ansvar for rapporten") + aksjon ("Sende rapport innen fredag, ansvarlig: Per"). Ikke dupliser.

VIKTIG ANTI-PATTERN — IKKE lag aksjoner som er meta-spørsmål om beslutningen:
- ❌ "Avklare hva ledergruppen har besluttet" når transkriptet allerede sier hva de besluttet
- ❌ "Bekrefte at Per tar ansvar for X" når Per er nevnt som ansvarlig — registrer det isteden direkte
- ✅ Fang den FAKTISKE beslutningen som beslutning ("Alle skal gå med gummistøvler i uke 22"), ikke som "avklar hva som er besluttet"

BESLUTNINGER:
- Skriv som direkte konstatering, ikke meta: "Alle ansatte skal bruke gummistøvler på jobben i uke 22" (IKKE "Bestemt at man må avklare gummistøvler")
- Inkluder eksplisitte beslutninger ("vi beslutter at...", "har besluttet", "vedtatt") OG implisitte (tydelig enighet, "ok, da gjør vi slik")
- Legg ved et kort sitat/kontekst fra transkriptet
- DEDUPLICERING: Hvis en ny beslutning handler om det SAMME som en eksisterende (se EKSISTERENDE BESLUTNINGER over), GJENBRUK eksisterende IDen og oppdater
- Sjekk EKSISTERENDE AKSJONSPUNKTER — hvis det allerede står som aksjon, ikke foreslå det som beslutning i tillegg
- Returner opptil 4 beslutninger

AKSJONSPUNKTER:
- Skriv som konkret OPPGAVE, ikke som meta-avklaring: "Per og Pål skriver 15-siders rapport innen mandag" (IKKE "Bekrefte at Per og Pål tar ansvar for å skrive...")
- Bruk substansen direkte fra transkriptet — hvis transkriptet sier "Kan Per og Pål skrive en rapport innen mandag?", aksjonen er "Per og Pål skriver rapport, frist: mandag" (ikke "bekrefte at de tar ansvar")
- Finn ansvarlig person og frist om nevnt
- DEDUPLICERING: Sjekk EKSISTERENDE AKSJONSPUNKTER og EKSISTERENDE BESLUTNINGER. Ikke foreslå samme tema dobbelt.

KVALITET FOREGÅR KVANTITET — UNIFORM PRESISJONSBAR:
Samme standard gjelder fra første minutt til siste minutt av møtet. Du skal IKKE være ivrigere tidlig (for å "prove yourself") eller bli stille senere (fordi du allerede har foreslått noe).

KRAV TIL EN AKSJON:
1. Det finnes en EKSPLISITT trigger i transkriptet:
   (a) handlingsverb knyttet til konkret tema/objekt: "Per skal skrive...", "kan du sjekke...", "vi må sende...", "vurdere X vs Y", "gjennomgå flyt for...", "designe tørkerom-ventilasjon", "utvide vasken til 80 cm";
   (b) et eksplisitt uavklart spørsmål eller faglig vurdering som krever oppfølging utenfor møtet ("vi må finne ut av...", "dette må gjennomgås", "vi har ikke tatt stilling til...");
   (c) en konkret oppgave noen lover/foreslår å gjøre selv om ansvarlig ikke navngis ("noen må sjekke kapasiteten på arbeidstøyhenging").

2. Aksjonen skal være FAGLIG KONKRET — ikke meta-prosess. Faglige oppgaver er gyldige selv uten eksplisitt ansvarlig/frist:
   ✓ "Vurdere tørkeskap vs tørkerom" (konkret valg mellom to alternativer)
   ✓ "Gjennomgå flyt for arbeidstøy/oppbevaring" (eksplisitt sagt: "flyt må gjennomgås")
   ✓ "Designe tørkerom (ventilasjon, soner, skap)" (konkret design-task)
   ✓ "Utvide vasken til 80 cm i NS-toalett" (konkret dimensjon-endring)
   ✓ "Sjekke arbeidstøy-kapasitet for ~50 stk fra Kvitfjell"

ANTI-PATTERNS (returner IKKE disse — meta-aksjoner om møteprosess):
✗ "Definere kriterier for..." (vagt, prosess-meta)
✗ "Etablere beslutningsgrunnlag for..." (prosess-meta)
✗ "Avklare hva gruppen mener om..." (meta om møteprosess)
✗ "Diskutere X på neste møte" (utsettelse uten konkret leveranse)
✗ "Følge opp Z" (uten å si HVA)

NØKKEL-DISTINKSJON:
- ✓ Faglig vurdering med konkret tema → aksjon
- ✓ Konkret design/spec/utredning som må gjøres → aksjon
- ✓ Eksplisitt uavklart spørsmål om tekniske valg → aksjon
- ✗ Meta-aksjon om hvordan møtet skal fungere → ikke aksjon

Hvis ansvarlig/frist nevnes: ta det med. Hvis ikke nevnt: bare la feltene være tomme — IKKE skip aksjonen av den grunn alene.

REELT MØTE-SCENARIO — UTGANG:
- Møter har typisk 2-5 ekte aksjoner over hele møtet. Ikke alle minutter har en aksjon.
- Tom array er KORREKT svar i 60-70% av analyze-kall — ikke et problem.
- I lange møter (30-60 min): noen ganger dukker det opp 1 ny aksjon på minutt 25 eller 40 selv om tidligere passes ga 0-1. Du må FORTSATT lete aktivt etter slike — selv om de eksisterende items dekker noen tidligere temaer. Stillehet skal komme fra at det ikke er noe å fange, ikke fra at du har "gjort din del".

LET I HELE FULL TRANSKRIPT for nye items, men prioritér de siste ~10 minuttene:
- ETTER review-passen: gå gjennom siste ~10 min av FULL TRANSKRIPT for nye konkrete oppgaver/beslutninger som ikke allerede er fanget.
- Hvis du finner noe som krysser minuttegrensen mellom recent og tidligere: fang det hvis det matcher kravene over.
- Maks 6 aksjoner per kall, men 0-2 er det vanligste utfallet i et bra fungerende møte.

Returner ALLTID gyldig JSON i dette formatet:
{
  "questions": ["spørsmål 1", "spørsmål 2", "spørsmål 3"],
  "warnings": [
    {
      "id": "w-001",
      "level": "violation" eller "risk",
      "title": "Kort tittel på problemet",
      "explanation": "Forklaring på hva som ble oppdaget og hvorfor det kan være et problem",
      "transcript_snippet": "Nøyaktig sitat fra recent_transcript som utløste advarselen",
      "rule_reference": {
        "rule_id": "ID fra regellisten",
        "document_name": "Dokumentnavn",
        "section": "Seksjon/paragraf",
        "rule_text": "Kort sitat fra regelinnholdet",
        "summary": "Kort forklaring av regelen"
      },
      "suggested_questions": ["Oppfølgingsspørsmål 1", "Oppfølgingsspørsmål 2"]
    }
  ],
  "actions": [
    {
      "id": "a-001",
      "text": "Velformulert aksjonspunkt som en konkret oppgave",
      "suggestedOwner": "Navn eller rolle, eller null",
      "suggestedDeadline": "Dato/uttrykk, eller null"
    }
  ],
  "decisions": [
    {
      "id": "d-001",
      "text": "Velformulert beslutning som en konstatering",
      "context": "Kort sitat fra transkriptet som viser at beslutningen ble tatt"
    }
  ]
}

Hvis ingen advarsler: warnings skal være en tom array []
Hvis ingen aksjonspunkter: actions skal være en tom array []
Hvis ingen beslutninger: decisions skal være en tom array []${hasSeries ? `

OPPGAVE 5: KRYSSANALYSE MED TIDLIGERE MØTER
Du har tilgang til referater fra tidligere møter i samme møteserie. Sjekk om noe i dagens møte (recent_transcript):
- MOTSTRIDER noe som ble besluttet, avtalt eller konkludert i et tidligere møte
- UNDERKJENNER en beslutning, plan eller avtale fra et tidligere møte
- SKAPER FORVIRRING ved å gå tilbake på noe som virket avklart

Formuler opptil 3 korte, skarpe spørsmål som hjelper gruppen å avklare motsetningene.
Disse spørsmålene MÅ markeres med type "cross_meeting" i JSON-svaret.
Returner tom array hvis ingen motstrid er funnet.` : ""}${hasMeetingDocs ? `

OPPGAVE ${hasSeries ? "6" : "5"}: DOKUMENTSJEKK – MØTEDOKUMENTER
Du har tilgang til opplastede møtedokumenter (under MØTEDOKUMENTER i brukerens melding). Disse inneholder kunnskap, retningslinjer, avtalte prinsipper eller policy som er relevante for dette møtet/serien.
Sjekk om noe i recent_transcript:
- MOTSTRIDER eller IGNORERER innholdet i et av møtedokumentene
- GÅR IMOT en retningslinje, et prinsipp eller en avtalt praksis
- MANGLER VESENTLIG INFORMASJON som dokumentet sier er nødvendig

Formuler opptil 3 korte, skarpe spørsmål som hjelper gruppen å oppdage disse motsetningene/avvikene.
Legg DISSE spørsmålene i cross_meeting_questions-arrayen (de behandles likt som kryssreferansespørsmål og vises med rød markering).
Returner tom array hvis ingen avvik mot møtedokumentene er funnet.` : ""}

Legg cross_meeting_questions i JSON-svaret. Returner tom array hvis ingen motstrid eller avvik er funnet.`;

        const rulesContext = rulesState.rules.map(r => 
          `ID: ${r.id}\nDokument: ${r.document_name}\nSeksjon: ${r.section}\nTittel: ${r.rule_title}\nRegel: ${r.rule_text}\nOppsummering: ${r.summary}\nTagger: ${r.tags.join(", ")}`
        ).join("\n\n---\n\n");

        const userContent = `OPPLASTEDE REGLER:
${rulesContext}

---

${existingActionsContext}${existingDecisionsContext}${existingActionsContext || existingDecisionsContext ? "\n---\n\n" : ""}${seriesContext ? `${seriesContext}\n\n---\n\n` : ""}${meetingDocsContext ? `${meetingDocsContext}\n\n---\n\n` : ""}${fullTranscript ? `FULL TRANSKRIPT (hele møtet så langt):\n${fullTranscript}\n\n---\n\n` : ""}RECENT TRANSCRIPT (siste minuttene):
${transcript}`;

        // Higher temperature for sureaud to make responses more unpredictable and edgy
        const temperature = role === "sureaud" ? 0.95 : 0.7;

        // Kjør hoved-analyze og dedikert beslutninger-pass i parallell.
        // Dedikert pass har én oppgave (beslutninger), full transkript-fokus,
        // ingen multi-task-overhead, og blir ikke "tilfreds" av eksisterende.
        const [response, dedicatedDecisions] = await Promise.all([
          openai.chat.completions.create({
            model: "gpt-4.1",
            messages: [
              { role: "system", content: combinedSystemPrompt },
              { role: "user", content: userContent }
            ],
            response_format: { type: "json_object" },
            max_tokens: 3500,
            temperature,
          }),
          extractDecisionsDedicated({
            fullTranscript: fullTranscript || transcript || "",
            recentTranscript: transcript || "",
            existingDecisions: (existingDecisions || []).map(d => ({ id: d.id, text: d.text, status: d.status })),
            expertRole: role,
            preferencesText: aiPrefs?.profileText || "",
            communityRules: activeRules.map(r => r.pattern).join("\n"),
          }),
        ]);

        const content = response.choices[0]?.message?.content;
        console.log("GPT response with rules:", content?.substring(0, 500), "| dedicated decisions:", dedicatedDecisions.length);

        if (!content) {
          console.log("Analyze: No content from GPT");
          return res.json({ questions: [], warnings: [] });
        }

        try {
          const result = JSON.parse(content);
          const questions = result.questions || [];
          const crossMeetingQuestions: string[] = result.cross_meeting_questions || [];
          const warnings: Warning[] = (result.warnings || []).map((w: any) => ({
            ...w,
            createdAt: new Date().toISOString(),
            isNew: true,
          }));
          const actions = (result.actions || []).map((a: any, idx: number) => ({
            id: a.id || `a-${Date.now()}-${idx}`,
            text: a.text || "",
            suggestedOwner: a.suggestedOwner || null,
            suggestedDeadline: a.suggestedDeadline || null,
          }));
          const mainDecisions = (result.decisions || []).map((d: any, idx: number) => ({
            id: d.id || `d-${Date.now()}-${idx}`,
            text: d.text || "",
            context: d.context || null,
          }));
          // Slå sammen med dedikert pass — fanger det multi-task call'en misset
          const decisions = mergeDecisions(mainDecisions, dedicatedDecisions.map((d, i) => ({
            id: d.id || `d-ded-${Date.now()}-${i}`,
            text: d.text || "",
            context: d.context || null,
          })));

          console.log("Analyze with rules: Returning", questions.length, "questions,", crossMeetingQuestions.length, "cross-meeting,", warnings.length, "warnings,", actions.length, "actions,", decisions.length, "decisions (main:", mainDecisions.length, "+ dedicated unique:", decisions.length - mainDecisions.length, ")");
          res.json({ 
            questions: questions.slice(0, 3),
            crossMeetingQuestions: crossMeetingQuestions.slice(0, 3),
            warnings,
            actions,
            decisions,
          });
        } catch (parseError) {
          console.error("JSON parsing error:", parseError);
          return res.json({ questions: [], crossMeetingQuestions: [], warnings: [], actions: [] });
        }
      } else {
        // Original behavior without rules
        const systemPrompt = `${expertPrompt}${preferencesSection}${communityRulesSection}

Du har TO oppgaver:

OPPGAVE 1: SPØRSMÅLSGENERERING
Du blir kalt regelmessig (f.eks. hvert minutt) og skal generere nøyaktig 3 skarpe, nyttige spørsmål.
VIKTIG: Du MÅ bruke personligheten og stilen beskrevet over når du formulerer spørsmål!

Bruk full_transcript for å forstå helheten, men legg mest vekt på recent_transcript.
Spørsmålene skal:
- Være konkrete, korte og tydelige
- Knytte seg til noe faktisk sagt i recent_transcript
- Hjelpe gruppen til å avklare beslutninger, tydeliggjøre ansvar, oppdage risiko

OPPGAVE 2 + 3: AKSJONSPUNKTER OG BESLUTNINGER (UNIFORM PRESISJONSBAR)
Samme høye standard fra første minutt til siste minutt. Du skal IKKE være ivrigere tidlig (for å "prove yourself") eller bli stille senere (fordi du allerede har foreslått noe). Ekte aksjoner kan dukke opp på minutt 25 i et 40-minutters møte — fortsatt fang dem.

KRAV TIL EN AKSJON:
1. Det finnes en EKSPLISITT trigger i transkriptet:
   (a) handlingsverb knyttet til konkret tema/objekt: "Per skal skrive...", "kan du sjekke...", "vi må sende...", "vurdere X vs Y", "gjennomgå flyt for...", "designe tørkerom-ventilasjon", "utvide vasken til 80 cm";
   (b) et eksplisitt uavklart spørsmål eller faglig vurdering som krever oppfølging utenfor møtet ("vi må finne ut av...", "dette må gjennomgås", "vi har ikke tatt stilling til...");
   (c) en konkret oppgave noen lover/foreslår å gjøre selv om ansvarlig ikke navngis.

2. Aksjonen skal være FAGLIG KONKRET — ikke meta-prosess. Faglige oppgaver er gyldige selv uten eksplisitt ansvarlig/frist:
   ✓ "Vurdere tørkeskap vs tørkerom" (konkret valg mellom to alternativer)
   ✓ "Gjennomgå flyt for arbeidstøy/oppbevaring" (eksplisitt sagt: "flyt må gjennomgås")
   ✓ "Designe tørkerom (ventilasjon, soner, skap)" (konkret design-task)
   ✓ "Utvide vasken til 80 cm i NS-toalett" (konkret dimensjon-endring)

KRAV TIL EN BESLUTNING (ALLE må være oppfylt):
1. KONSTATERING av noe avgjort: "vi har bestemt", "vi vedtar", "ok, da gjør vi slik", eller tydelig enighet som ender en diskusjon.
2. Skriv som direkte konstatering, ikke som meta: "Grupperom A velges fremfor B" — ikke "Avklare hvilket grupperom som skal velges".
3. Legg ved kort sitat/kontekst fra transkriptet som viser hvor beslutningen ble tatt.

ANTI-PATTERNS (returner IKKE disse — meta om møteprosess):
✗ "Definere kriterier for..." (vagt prosess-meta)
✗ "Etablere beslutningsgrunnlag for..." (prosess-meta)
✗ "Avklare hva gruppen mener om..." (meta om møteprosess)
✗ "Diskutere X på neste møte" (utsettelse uten konkret leveranse)
✗ "Følge opp Z" (uten å si HVA)

NØKKEL-DISTINKSJON:
- ✓ Faglig vurdering med konkret tema → aksjon
- ✓ Konkret design/spec/utredning som må gjøres → aksjon
- ✓ Eksplisitt uavklart spørsmål om tekniske valg → aksjon
- ✗ Meta-aksjon om hvordan møtet skal fungere → ikke aksjon

Hvis ansvarlig/frist nevnes: ta det med. Hvis ikke nevnt: bare la feltene være tomme — IKKE skip aksjonen av den grunn alene.

REELT MØTE-SCENARIO:
- Møter har typisk 2-5 ekte aksjoner over hele møtet — ikke alle minutter har en aksjon.
- Tom array er KORREKT svar i 60-70% av analyze-kall — ikke et problem.
- I lange møter (30-60 min): noen ganger dukker det opp 1 ny aksjon på minutt 25 eller 40 selv om tidligere passes ga 0-1. Du må FORTSATT lete aktivt etter slike.
- Stillhet skal komme fra at det IKKE er noe å fange, ikke fra at du har "gjort din del" tidligere.

LET I HELE FULL TRANSKRIPT for nye items, men prioritér de siste ~10 minuttene:
- ETTER review-passen: gå gjennom siste ~10 min av FULL TRANSKRIPT for nye konkrete oppgaver/beslutninger som ikke allerede er fanget.
- Hvis du finner noe som krysser minuttegrensen mellom recent og tidligere: fang det hvis det matcher kravene.

DEDUPLICERING: Hvis et nytt forslag handler om SAMME tema som et eksisterende, GJENBRUK den eksisterende IDen og oppdater tekst/ansvarlig/frist/kontekst — IKKE lag duplikat.

Maks 6 aksjoner, maks 4 beslutninger per kall — men 0-2 av hver er det vanligste utfallet i et bra fungerende møte.

Returner i JSON-format:
{
  "questions": ["spørsmål 1", "spørsmål 2", "spørsmål 3"],
  "cross_meeting_questions": ["kryssreferansespørsmål 1"],
  "actions": [
    {
      "id": "a-001",
      "text": "Velformulert aksjonspunkt som en konkret oppgave",
      "suggestedOwner": "Navn eller rolle, eller null",
      "suggestedDeadline": "Dato/uttrykk, eller null"
    }
  ],
  "decisions": [
    {
      "id": "d-001",
      "text": "Velformulert beslutning som en konstatering",
      "context": "Kort sitat fra transkriptet som viser at beslutningen ble tatt"
    }
  ]
}
Hvis ingen aksjonspunkter: actions skal være en tom array []
Hvis ingen beslutninger: decisions skal være en tom array []
Hvis ingen kryssreferansespørsmål: cross_meeting_questions skal være en tom array []${hasSeries ? `

OPPGAVE 4: KRYSSANALYSE MED TIDLIGERE MØTER
Du har tilgang til referater fra tidligere møter i samme møteserie. Sjekk om noe i dagens møte (recent_transcript):
- MOTSTRIDER noe som ble besluttet, avtalt eller konkludert i et tidligere møte
- UNDERKJENNER en beslutning, plan eller avtale fra et tidligere møte
- SKAPER FORVIRRING ved å gå tilbake på noe som virket avklart

Formuler opptil 3 korte, skarpe spørsmål som hjelper gruppen å avklare motsetningene. Legg dem i "cross_meeting_questions".
Returner tom array hvis ingen motstrid er funnet.` : ""}${hasMeetingDocs ? `

OPPGAVE ${hasSeries ? "5" : "4"}: DOKUMENTSJEKK – MØTEDOKUMENTER
Du har tilgang til opplastede møtedokumenter (under MØTEDOKUMENTER i brukerens melding). Disse inneholder kunnskap, retningslinjer, avtalte prinsipper eller policy som er relevante for dette møtet/serien.
Sjekk om noe i recent_transcript:
- MOTSTRIDER eller IGNORERER innholdet i et av møtedokumentene
- GÅR IMOT en retningslinje, et prinsipp eller en avtalt praksis
- MANGLER VESENTLIG INFORMASJON som dokumentet sier er nødvendig

Formuler opptil 3 korte, skarpe spørsmål som hjelper gruppen å oppdage disse avvikene.
Legg disse spørsmålene i cross_meeting_questions-arrayen (de vises med rød markering for brukeren).
Returner tom array hvis ingen avvik mot møtedokumentene er funnet.` : ""}`;

        const existingContext = `${existingActionsContext}${existingDecisionsContext}${existingActionsContext || existingDecisionsContext ? "\n---\n\n" : ""}`;
        const seriesSection = seriesContext ? `${seriesContext}\n\n---\n\n` : "";
        const docsSection = meetingDocsContext ? `${meetingDocsContext}\n\n---\n\n` : "";
        const userContent = fullTranscript 
          ? `${existingContext}${seriesSection}${docsSection}FULL TRANSKRIPT (hele møtet så langt):\n${fullTranscript}\n\n---\n\nRECENT TRANSCRIPT (siste minuttene):\n${transcript}`
          : `${existingContext}${seriesSection}${docsSection}RECENT TRANSCRIPT (siste minuttene):\n${transcript}`;
        
        // Higher temperature for sureaud to make responses more unpredictable and edgy
        const temperature = role === "sureaud" ? 0.95 : 0.7;

        // Hoved-analyze og dedikert beslutninger-pass parallelt (samme grunn
        // som i with-rules-pathen — multi-task overhead og confirmation bias).
        const [response, dedicatedDecisionsList] = await Promise.all([
          openai.chat.completions.create({
            model: "gpt-4.1",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userContent }
          ],
          response_format: { type: "json_object" },
          max_tokens: 3500,
          temperature,
          }),
          extractDecisionsDedicated({
            fullTranscript: fullTranscript || transcript || "",
            recentTranscript: transcript || "",
            existingDecisions: (existingDecisions || []).map(d => ({ id: d.id, text: d.text, status: d.status })),
            expertRole: role,
            preferencesText: aiPrefs?.profileText || "",
            communityRules: activeRules.map(r => r.pattern).join("\n"),
          }),
        ]);

        const content = response.choices[0]?.message?.content;
        const finishReason = response.choices[0]?.finish_reason;
        console.log("GPT response:", content?.slice(0, 300), "finish:", finishReason, "| dedicated decisions:", dedicatedDecisionsList.length);

        if (!content) {
          console.log("Analyze: No content from GPT");
          return res.json({ questions: [], warnings: [], actions: [] });
        }

        let result;
        try {
          result = JSON.parse(content);
        } catch (parseError) {
          console.error("JSON parsing error:", parseError, "finish:", finishReason);
          console.error("Raw content (first 500):", content.slice(0, 500));

          // Hvis output ble truncated (finish_reason === "length"), prøv å reparere
          // ved å klippe til siste komplette objekt og lukke arrays/object-trær.
          const repaired = tryRepairTruncatedJson(content);
          if (repaired) {
            try {
              result = JSON.parse(repaired);
              console.log("Reparert truncated JSON OK");
            } catch {
              /* fortsett til fallback */
            }
          }

          if (!result) {
            const lines = content.split("\n").filter((line: string) => line.trim().match(/^\d+\./));
            if (lines.length > 0) {
              const fallbackQuestions = lines.map((line: string) => line.replace(/^\d+\.\s*/, "").trim()).slice(0, 3);
              return res.json({ questions: fallbackQuestions, warnings: [], actions: [] });
            }
            // Returner tomme arrays heller enn 500 — bedre brukeropplevelse
            console.warn("Analyze: ga opp parsing — returnerer tomt resultat");
            return res.json({ questions: [], warnings: [], actions: [], decisions: [] });
          }
        }
        
        const questions = result.questions || [];
        const crossMeetingQuestions: string[] = result.cross_meeting_questions || [];
        const actions = (result.actions || []).map((a: any, idx: number) => ({
          id: a.id || `a-${Date.now()}-${idx}`,
          text: a.text || "",
          suggestedOwner: a.suggestedOwner || null,
          suggestedDeadline: a.suggestedDeadline || null,
        }));
        const mainDecisionsW = (result.decisions || []).map((d: any, idx: number) => ({
          id: d.id || `d-${Date.now()}-${idx}`,
          text: d.text || "",
          context: d.context || null,
        }));
        const decisions = mergeDecisions(mainDecisionsW, dedicatedDecisionsList.map((d, i) => ({
          id: d.id || `d-ded-${Date.now()}-${i}`,
          text: d.text || "",
          context: d.context || null,
        })));

        console.log("Analyze: Returning", questions.length, "questions,", crossMeetingQuestions.length, "cross-meeting,", actions.length, "actions,", decisions.length, "decisions (main:", mainDecisionsW.length, "+ dedicated unique:", decisions.length - mainDecisionsW.length, ")");
        res.json({ questions: questions.slice(0, 3), crossMeetingQuestions: crossMeetingQuestions.slice(0, 3), warnings: [], actions, decisions });
      }
      
    } catch (error: any) {
      console.error("Analysefeil:", error);
      res.status(500).json({ 
        error: "Kunne ikke analysere transkript", 
        details: error.message 
      });
    }
  });

  // POST /api/check-rules - lightweight rule checking only (every 10 seconds)
  app.post("/api/check-rules", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const { transcript } = req.body;
      
      if (!transcript || typeof transcript !== "string" || transcript.trim().length === 0) {
        return res.json({ warnings: [] });
      }
      
      // Get current rules
      const rulesState = await storage.getRulesState(userId);
      if (rulesState.rules.length === 0) {
        return res.json({ warnings: [] });
      }
      
      const systemPrompt = `Du er en regelsjekker for norske møter. Din ENESTE oppgave er å sjekke om det som blir sagt bryter med opplastede regler.

VIKTIG: Du skal BARE returnere advarsler hvis noe FAKTISK bryter med en regel. Ikke vær for streng.

For hvert brudd eller risiko, returner DETALJERT informasjon:
- id: Unik ID (f.eks. "w-001")
- level: "violation" (klart brudd) eller "risk" (potensiell konflikt)
- title: Inkluder det SPESIFIKKE ordet/uttrykket som brøt regelen i tittelen. Eksempel: "Engelsk ord 'project' brukt i stedet for norsk"
- explanation: DETALJERT forklaring som inkluderer:
  1. Hvilket ord eller uttrykk som ble brukt
  2. Hva som burde vært sagt i stedet
  3. Hvilken regel dette bryter
  4. Hvorfor dette er et problem
- transcript_snippet: Nøyaktig sitat fra transkriptet som inneholder bruddet
- rule_reference: { rule_id, document_name, section, rule_text, summary }
- suggested_questions: [2 oppfølgingsspørsmål som kan hjelpe møtedeltakerne]

EKSEMPEL på god advarsel:
{
  "title": "Engelsk ord 'meeting' brukt - skal være 'møte'",
  "explanation": "Ordet 'meeting' ble brukt i setningen. Ifølge språkreglene skal norske ord brukes. Det korrekte alternativet er 'møte'. Dette bryter med regel om at all kommunikasjon skal foregå på norsk."
}

Returner JSON: { "warnings": [...] }
Hvis ingen advarsler: { "warnings": [] }`;

      const rulesContext = rulesState.rules.map(r => 
        `ID: ${r.id}\nDokument: ${r.document_name}\nTittel: ${r.rule_title}\nRegel: ${r.rule_text}`
      ).join("\n\n");

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini", // Use mini for faster/cheaper rule checking
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `REGLER:\n${rulesContext}\n\n---\n\nTRANSKRIPT:\n${transcript}` }
        ],
        response_format: { type: "json_object" },
        max_tokens: 1000,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        return res.json({ warnings: [] });
      }

      try {
        const result = JSON.parse(content);
        const warnings = (result.warnings || []).map((w: any) => ({
          ...w,
          createdAt: new Date().toISOString(),
          isNew: true,
        }));
        
        console.log("Rule check: Found", warnings.length, "warnings");
        res.json({ warnings });
      } catch {
        console.error("Rule check JSON parse error");
        res.json({ warnings: [] });
      }
    } catch (error: any) {
      console.error("Rule check error:", error.message);
      res.json({ warnings: [] });
    }
  });

  // POST /api/summary - generates meeting summary
  app.post("/api/summary", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const parsed = summaryRequestSchema.safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({ error: "Ugyldig forespørsel", details: parsed.error.issues });
      }
      
      const { transcript, savedQuestions, seriesSummaries, approvedActions, pendingActions, confirmedDecisions, metadata, visualContext } = parsed.data;
      
      if (!transcript || transcript.trim().length === 0) {
        return res.json({ summary: "Ingen transkript å oppsummere." });
      }

      // Load learned summary preferences
      const summaryPrefs = await storage.getSummaryPreferences(userId);
      const summaryPreferencesSection = summaryPrefs?.profileText
        ? `\n\nLÆRTE BRUKERPREFERANSER FOR REFERAT (basert på tidligere tilbakemeldinger – følg disse nøye):\n${summaryPrefs.profileText}`
        : "";

      // Build series context for cross-meeting contradiction section in the minutes
      const hasSeries = seriesSummaries && seriesSummaries.length > 0;
      const seriesContextForSummary = hasSeries
        ? `\n\nTIDLIGERE MØTEREFERATER I SERIEN (for motstrid-analyse i referatet):\n${seriesSummaries!.map((s, i) =>
            `--- Møte ${s.seriesIndex ?? i + 1}: "${s.title}" (${s.date ? new Date(s.date).toLocaleDateString("nb-NO") : "ukjent dato"}) ---\n${s.summary}`
          ).join("\n\n")}`
        : "";
      
      const questionsSection = savedQuestions.length > 0 
        ? `\n\nLagrede spørsmål fra møtet:\n${savedQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n")}`
        : "";
      
      const actionsSection = (() => {
        const approved = approvedActions && approvedActions.length > 0
          ? `Godkjente aksjonspunkter:\n${approvedActions.map((a, i) => 
              `${i + 1}. ${a.text}${a.owner ? ` | Ansvarlig: ${a.owner}` : ""}${a.deadline ? ` | Frist: ${a.deadline}` : ""}${a.source === "manual" ? " | Status: Manuelt" : ""}`
            ).join("\n")}`
          : "";
        const pending = pendingActions && pendingActions.length > 0
          ? `Foreslåtte aksjonspunkter (ikke bekreftet av bruker ennå):\n${pendingActions.map((a, i) => 
              `${i + 1}. ${a.text}${a.suggestedOwner ? ` | Foreslått ansvarlig: ${a.suggestedOwner}` : ""}${a.suggestedDeadline ? ` | Foreslått frist: ${a.suggestedDeadline}` : ""}${a.source === "manual" ? " | Status: Manuelt" : ""}`
            ).join("\n")}`
          : "";
        const parts = [approved, pending].filter(Boolean);
        return parts.length > 0 ? `\n\n${parts.join("\n\n")}` : "";
      })();

      const decisionsSection = confirmedDecisions && confirmedDecisions.length > 0
        ? `\n\nBekreftede beslutninger (godkjent av bruker under møtet):\n${confirmedDecisions.map((d, i) => 
            `${i + 1}. ${d.text}${d.context ? ` | Kontekst: "${d.context}"` : ""}${d.source === "manual" ? " | Status: Manuelt" : ""}`
          ).join("\n")}`
        : "";
      
      const metadataSection = metadata ? `\n\nMetadata:\n${JSON.stringify(metadata, null, 2)}` : "";

      const visualContextSection = (visualContext && visualContext.length > 0)
        ? `\n\nVISUELL KONTEKST (skjermbilder fra møtet, AI-tolkede beskrivelser):\nDisse skal vises som inline bilder i referatet med markdown-syntaks \`![beskrivelse](screenshot:ID)\` der ID er bilde-IDen. Plasser dem ved siden av relevante avsnitt der innholdet diskuteres. Bruk beskrivelsen for å forstå konteksten i samtalen — ofte refererer transkriptet til "som dere ser her" eller "på denne tegningen", og det er disse bildene de mente.\n\n${visualContext.map(v => `- ID ${v.id} (kl ${new Date(v.capturedAt).toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" })}): ${v.description}`).join("\n")}`
        : "";
      
      const systemPrompt = `You are an expert Norwegian meeting minutes writer.${summaryPreferencesSection}

You receive:
1) A full meeting transcript (often noisy, with some small talk and transcription errors).
2) Optional metadata as JSON (user-provided fields take priority over anything inferred from the transcript).
3) Optional saved questions from the meeting.
4) Optional confirmed decisions and action items from the meeting.${hasSeries ? `
5) Summaries of PREVIOUS meetings in the same series — use these ONLY for the cross-meeting contradiction section (Section 6). Do NOT let previous meetings dominate the minutes for THIS meeting.` : ""}

Your task:
Turn the transcript into a clear, structured Norwegian meeting minutes document that is:
- Short on fluff, high on signal.
- Easy to skim at the top.
- Clear on themes, decisions and action items.
- Useful for construction projects, consulting meetings and work meetings.

TRANSCRIPTION QUALITY AND INTERPRETATION
The transcript is generated by automatic speech-to-text (Norwegian AI model) and WILL contain errors: misheard words, wrong names, broken sentences, missing words, technical terms rendered phonetically. Your job is NOT to reproduce these errors in the meeting minutes — your job is to write what was actually meant.

Follow this process:
1. Read the entire transcript to understand the full context: What kind of meeting is this? What industry, project or domain? Who are the participants and what are their roles? What topics keep coming up?
2. Use that context to interpret unclear or garbled passages. A word that sounds like nonsense phonetically may be a well-known technical term, a project name, a regulation reference (NS 8405, TEK17, SHA-plan, PBL, etc.) or an industry abbreviation.
3. In the meeting minutes, write the CORRECTED, INTERPRETED version — not the raw transcription error. For example: if the transcript says "ORK" in a construction context, it probably means something specific to that project; use what makes sense. If "VDK" appears in a logistics context, it might be "VDC" or similar. Trust context over literal text.
4. If you genuinely cannot determine what was meant, use "(uklart)" — but prefer interpretation when the domain context makes it reasonably clear.
5. Do NOT copy strange phonetic errors, broken grammar or noise artifacts into the minutes. Clean them up as a skilled human note-taker would.
6. Names of people and places: use the most plausible spelling given context. If a name appears multiple times in different forms, pick the most consistent/correct-looking version.

GENERAL RULES
- Write in Norwegian.
- Be concise, concrete and professional, but conversational.
- Ignore small talk, pauses, technical problems, digressions and private asides.
- If important metadata is missing, use a placeholder like "[Mangler]".
- If the same point is repeated, summarize it once under the right theme.

WEIGHTING OF THE TRANSCRIPT
- Use the entire transcript to understand context, background and decisions.
- Give slightly more weight to the last 10–15 minutes for final clarifications, summaries, and "who does what".

OUTPUT FORMAT
Return the meeting minutes as MARKDOWN with the following structure and headings (exactly in this order):

# Møtereferat

## 1. Nøkkelinformasjon
Use the metadata provided (user-provided fields take priority). If a field is missing, write [Mangler].

- **Møtetittel:** <fra metadata eller utledet fra transkript>
- **Dato:** <fra metadata>
- **Tid:** <fra metadata, og varighet hvis kjent>
- **Sted / format:** <fra metadata, eller "fysisk / Teams / Zoom" hvis mulig å utlede>
- **Møteleder:** <fra metadata>
- **Referent:** <fra metadata, ellers "AI-basert referat fra transkribering">
- **Deltakere:** Navn 1, Navn 2, Navn 3 (kommaseparert på én linje, IKKE punktliste under hverandre)
- **Fraværende (meldt forfall):** Navn 1, Navn 2 (kommaseparert; eller "Ingen nevnt")

## 2. Kort oppsummering
3–7 concise bullet points that quickly explain:
- What the meeting was about
- The most important decisions
- The most important action items
Each point should stand alone and make sense for someone who was not at the meeting.

## 3. Beslutninger
**STRENGT KRAV — 1:1 MED BRUKERENS PANEL:**
Bruk KUN de bekreftede beslutningene som er gitt under "Bekreftede beslutninger" i input. IKKE legg til nye beslutninger fra transkriptet — hvis brukeren ikke har bekreftet dem, skal de ikke være her. Hvis ingen bekreftede beslutninger ble gitt, skriv "Ingen bekreftede beslutninger".

| # | Beslutning | Eier / ansvarlig | Dato vedtatt | Kommentar |
|---|------------|------------------|--------------|-----------|

## 4. Aksjonspunkter (To-do)
**STRENGT KRAV — 1:1 MED BRUKERENS PANEL:**
Bruk KUN de godkjente og foreslåtte aksjonspunktene fra input. IKKE legg til nye aksjoner fra transkriptet. Manuelle items (source = manual) skal også med.

| # | Aksjon | Eier | Frist |
|---|--------|------|-------|

Instructions:
- "Aksjon" must be a concrete task, written as something that can actually be done.
- "Eier" should be one person if possible. Bruk det som er gitt i input — ikke gjett.
- "Frist": If explicitly given in input, use that. If not: "[Ikke avtalt]".
- IKKE inkluder kolonnene Prioritet, Status, Referanse — kun #, Aksjon, Eier, Frist.

## 5. Hovedtemaer og diskusjon
Divide the discussion into 3–7 main themes. For each theme:

### Tema X: <kort tematittel>
- **Kort oppsummering:** 2–4 sentences describing what was discussed and why it matters.
- **Viktige punkter:**
  - Short, concrete main points
  - Reference people by name where it makes sense
  - Include estimates, numbers, dates and assumptions when they appear
- **Uavklarte spørsmål / åpen usikkerhet:**
  - Bullet list of things mentioned but not resolved
- **Aksjoner og beslutninger under dette temaet:**
  - List bare de aksjonene/beslutningene som ER i input — ikke finn opp nye her. Skriv ut full tekst i stedet for å referere til "aksjon #X".

FORMATKRAV
- Output must be valid Markdown.
- Use clear headings and tables as described above.
- Do not invent project names, persons or numbers. Only use what is in the transcript or metadata.
- Keep the total length reasonable: focus on what actually creates value for participants after the meeting.${hasSeries ? `

## 6. Motstrid og avvik fra tidligere møter i serien
This section ONLY appears if the current meeting contains something that contradicts, reverses or creates tension with a decision, agreement or conclusion from a previous meeting in the series (as provided under TIDLIGERE MØTEREFERATER).

For each contradiction found:
- **Tema:** [Brief label for the contradiction]
- **Nåværende møte sier:** [What was said or decided in THIS meeting]
- **Tidligere møte (Møte X) sa:** [What was previously decided or agreed — cite the meeting number and title]
- **Anbefalt avklaring:** [A concrete question or action to resolve the tension]

If no contradictions are found, write: "Ingen åpenbare motsetninger mot tidligere møter i serien ble identifisert."
Omit this section entirely if no previous meeting summaries were provided.` : ""}`;

      const response = await openai.chat.completions.create({
        model: "gpt-4.1",
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: `Her er transkripsjonen fra møtet:\n\n${transcript}${questionsSection}${actionsSection}${decisionsSection}${metadataSection}${visualContextSection}${seriesContextForSummary}`
          }
        ],
        max_tokens: 4500,
      });
      
      const summary = response.choices[0]?.message?.content || "Kunne ikke generere sammendrag.";
      
      res.json({ summary });
      
    } catch (error: any) {
      console.error("Sammendragsfeil:", error);
      res.status(500).json({ 
        error: "Kunne ikke generere sammendrag", 
        details: error.message 
      });
    }
  });

  // ============= Learning / Feedback Endpoints =============

  // Helper: update ai preferences profile asynchronously after N signals
  async function updateAiProfile(userId: string) {
    try {
      const logs = await storage.getFeedbackLog(userId);
      if (logs.length === 0) return;

      // Manuelle tillegg er en SPESIELL signal-type: AI-en så transkriptet
      // og foreslo ikke det brukeren ville ha. Vi analyserer disse separat
      // for å bygge "miss-mønstre" — konkrete signaler AI-en skal fange neste gang.
      const manualAdds = logs.filter(l => l.source === "manual" && l.accepted);
      const aiAccepted = logs.filter(l => l.source !== "manual" && l.accepted);
      const aiRejected = logs.filter(l => l.source !== "manual" && !l.accepted);

      const acceptedActions = aiAccepted.filter(l => l.type === "action");
      const rejectedActions = aiRejected.filter(l => l.type === "action");
      const acceptedDecisions = aiAccepted.filter(l => l.type === "decision");
      const rejectedDecisions = aiRejected.filter(l => l.type === "decision");
      const manualActions = manualAdds.filter(l => l.type === "action");
      const manualDecisions = manualAdds.filter(l => l.type === "decision");

      const sectionsForGpt = [
        acceptedActions.length > 0 ? `GODKJENTE AI-FORESLÅTTE aksjonspunkter (${acceptedActions.length}):\n${acceptedActions.slice(0, 10).map(l => `- ${l.text}`).join("\n")}` : "",
        rejectedActions.length > 0 ? `AVVISTE AI-FORESLÅTTE aksjonspunkter (${rejectedActions.length}):\n${rejectedActions.slice(0, 10).map(l => `- ${l.text}${l.reason ? ` [Årsak: ${l.reason}]` : ""}`).join("\n")}` : "",
        acceptedDecisions.length > 0 ? `BEKREFTEDE AI-FORESLÅTTE beslutninger (${acceptedDecisions.length}):\n${acceptedDecisions.slice(0, 10).map(l => `- ${l.text}`).join("\n")}` : "",
        rejectedDecisions.length > 0 ? `AVVISTE AI-FORESLÅTTE beslutninger (${rejectedDecisions.length}):\n${rejectedDecisions.slice(0, 10).map(l => `- ${l.text}${l.reason ? ` [Årsak: ${l.reason}]` : ""}`).join("\n")}` : "",
        manualActions.length > 0 ? `*** MANUELT LAGT TIL aksjonspunkter (${manualActions.length}) — AI-en MISSET disse, brukeren la dem til selv ***\nFor hver: tekst + utdrag av transkriptet AI-en faktisk så da hen misset.\n${manualActions.slice(0, 10).map(l => `\n[Aksjon brukeren la til]: "${l.text}"\n[Transkript AI-en så på det tidspunktet]: "${(l.context ?? "").slice(0, 700)}"`).join("\n")}` : "",
        manualDecisions.length > 0 ? `*** MANUELT LAGT TIL beslutninger (${manualDecisions.length}) — AI-en MISSET disse, brukeren la dem til selv ***\n${manualDecisions.slice(0, 10).map(l => `\n[Beslutning brukeren la til]: "${l.text}"\n[Transkript AI-en så på det tidspunktet]: "${(l.context ?? "").slice(0, 700)}"`).join("\n")}` : "",
      ].filter(Boolean).join("\n\n");

      const profileResponse = await openai.chat.completions.create({
        model: "gpt-4.1",
        messages: [
          {
            role: "system",
            content: `Du oppdaterer en AI-profil som brukes av et møtereferat-system for å foreslå aksjonspunkter og beslutninger. Profilen skal bli BEDRE av hver økt.

Du får tre typer signaler:
1. AI-FORESLÅTTE som brukeren GODKJENTE → bra, gjør mer av dette
2. AI-FORESLÅTTE som brukeren AVVISTE (med årsak) → unngå dette, lytt til årsaken
3. MANUELT LAGT TIL — disse er KRITISK læring: AI-en så et stykke transkript men foreslo ikke det brukeren ville ha. Det betyr AI-en misset et signal. Sammenlign tekst-aksjonen med transkriptutdraget og identifiser HVILKEN frase, HVILKET ord, HVILKEN type ytring som signaliserte at dette var en aksjon.

Skriv en profil (maks 350 ord) på norsk strukturert slik:

## Slik foretrekker brukeren aksjoner og beslutninger
[Stil, detaljnivå, formuleringer brukeren liker]

## Mønstre å unngå
[Avvisningsårsaker — bruk konkrete eksempler]

## Signaler AI-EN MISSET — fang disse neste gang
[For hvert manuelt tillegg: en konkret regel. Eksempel:
"Når noen sier 'kan vi få en oversikt over X til neste møte' → fang som aksjon (rapport-aksjon med deadline=neste møte). I forrige sesjon misset jeg dette i konteksten '...vi trenger oversikt over...' "
"Når noen sier 'jeg sender deg den' → fang som aksjon med ansvarlig=taler. Jeg misset det i konteksten '...send meg planen i morgen...'"]

Vær SVÆRT konkret med signaler — generelle råd som "fang flere aksjoner" er verdiløse. Bruk faktiske utdrag fra transkriptkonteksten du fikk.`,
          },
          { role: "user", content: sectionsForGpt || "Ingen feedback ennå." },
        ],
        max_tokens: 700,
        temperature: 0.25,
      });

      const profileText = profileResponse.choices[0]?.message?.content || "";
      if (profileText) {
        await storage.setAiPreferences(userId, profileText, logs.length);
        console.log("AI preferences updated, signal count:", logs.length, "manuelt lagt til:", manualAdds.length);
      }
    } catch (err: any) {
      console.error("Error updating AI profile:", err.message);
    }
  }

  async function updateSummaryProfile(userId: string) {
    try {
      const feedbacks = await storage.getSummaryFeedbackLog(userId);
      if (feedbacks.length === 0) return;

      // Separate diff-analysis entries from free-text comments
      const diffEntries = feedbacks.filter(f => f.commentText.startsWith("STRUKTURERT DIFF-ANALYSE:"));
      const textEntries = feedbacks.filter(f => !f.commentText.startsWith("STRUKTURERT DIFF-ANALYSE:"));

      const diffSection = diffEntries.length > 0
        ? `=== REDIGERINGER BRUKEREN HAR GJORT (${diffEntries.length} stk) ===\n${diffEntries.slice(0, 10).map((f, i) => `--- Redigering ${i + 1} ---\n${f.commentText}`).join("\n\n")}`
        : "";
      const textSection = textEntries.length > 0
        ? `=== FRI TEKST-TILBAKEMELDINGER (${textEntries.length} stk) ===\n${textEntries.slice(0, 10).map((f, i) => `${i + 1}. "${f.commentText}"`).join("\n")}`
        : "";
      const feedbackText = [diffSection, textSection].filter(Boolean).join("\n\n");

      const profileResponse = await openai.chat.completions.create({
        model: "gpt-4.1",
        messages: [
          {
            role: "system",
            content: `Du er en ekspert på å lære av redigeringer og tilbakemeldinger for å forbedre fremtidige møtereferater.

Du får to typer data:
1. STRUKTURERTE DIFF-ANALYSER: Detaljerte sammenligninger av hva AI-en genererte vs. hva brukeren faktisk ønsket.
2. FRI TEKST-TILBAKEMELDINGER: Kommentarer fra brukeren om referatene.

Skriv en konkret instruksjonstekst (maks 350 ord) på norsk som oppsummerer:
- Hvilke seksjoner/elementer brukeren legger til, fjerner eller omskriver (dvs. hva AI-en gjør feil)
- Foretrukket stil, lengde og detaljeringsnivå (med konkrete eksempler fra diffene)
- Spesifikke formuleringer, strukturer eller mønstre brukeren foretrekker
- Hva som ALDRI skal gjøres basert på avvisninger/slettinger

Skriv det som en konkret instruksjon til en AI som skal skrive neste referat:
"Basert på brukerens tidligere redigeringer: ..."
Vær SVÆRT spesifikk — vage instruksjoner er verdiløse. Bruk konkrete eksempler fra diffene.`,
          },
          { role: "user", content: feedbackText },
        ],
        max_tokens: 700,
        temperature: 0.2,
      });

      const profileText = profileResponse.choices[0]?.message?.content || "";
      if (profileText) {
        await storage.setSummaryPreferences(userId, profileText, feedbacks.length);
        console.log("Summary preferences updated, feedback count:", feedbacks.length);
      }
      return profileText;
    } catch (err: any) {
      console.error("Error updating summary profile:", err.message);
      return "";
    }
  }

  // POST /api/feedback - log action/decision accept/reject signal
  // Anonymiser et signal før det går inn i kollektiv pott. Bruker GPT-4o-mini
  // for å fjerne navn/prosjekt/sted og abstrahere mønsteret. Returnerer null
  // hvis signalet er for spesifikt eller anonymisering feiler.
  async function anonymizeAndContribute(opts: {
    type: "missed_action" | "missed_decision";
    actionText: string;
    transcriptContext: string;
  }): Promise<void> {
    try {
      if (!opts.transcriptContext || opts.transcriptContext.length < 30) return;
      const resp = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `Du anonymiserer signaler fra et møtereferat-system for kollektiv læring.

Du får (a) en aksjon eller beslutning brukeren la til manuelt, og (b) transkriptutdraget AI-en så på det tidspunktet. AI-en misset altså signalet — vi bygger en regel som universell fang-regel.

Oppgaver:
1. Fjern ALL personlig informasjon: navn (erstatt med [PERSON_A], [PERSON_B]), prosjektnavn → [PROSJEKT], kunde → [KUNDE], sted → [STED], bedrift → [BEDRIFT], spesifikke datoer → [DATO], spesifikke tall som identifiserer → [TALL].
2. Identifiser det ABSTRAKTE FANG-MØNSTERET: hvilken type ytring/frase/struktur signaliserte dette? Skriv en konkret universell regel.
3. Hvis signalet er FOR SPESIFIKT til én bruker/bedrift (f.eks. "alltid fang når noen nevner [PROSJEKT-X]"), returner { skip: true }.

Returner JSON:
{
  "skip": false,
  "pattern": "Universal fang-regel, f.eks. 'Når noen sier kan du sende meg [TING] innen [TID] → fang som aksjon med ansvarlig=mottaker'",
  "evidence": "Anonymisert utdrag fra transkriptet som demonstrerer mønsteret"
}`,
          },
          {
            role: "user",
            content: `Brukerens manuelle tillegg: "${opts.actionText}"\n\nTranskript-kontekst (det AI-en så):\n${opts.transcriptContext.slice(0, 2000)}`,
          },
        ],
        response_format: { type: "json_object" },
        max_tokens: 500,
        temperature: 0.2,
      });
      const content = resp.choices[0]?.message?.content;
      if (!content) return;
      const parsed = JSON.parse(content);
      if (parsed.skip || !parsed.pattern) return;
      await storage.createCommunitySignal({
        signalType: opts.type,
        pattern: String(parsed.pattern).slice(0, 800),
        evidence: parsed.evidence ? String(parsed.evidence).slice(0, 1000) : null,
        status: "candidate",
        contributors: 1,
        canaryHits: 0,
        canaryWins: 0,
        canaryLosses: 0,
      });
    } catch (err: any) {
      console.error("Anonymize-contribute failed (non-fatal):", err.message);
    }
  }

  app.post("/api/feedback", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const { type, text, context, accepted, expertRole, source, reason } = req.body;
      if (!type || !text || accepted === undefined) {
        return res.status(400).json({ error: "Mangler type, text, eller accepted" });
      }
      await storage.logFeedback(userId, { type, text, context, accepted, reason, expertRole, source });
      // Trigger async profile update after every signal (non-blocking)
      updateAiProfile(userId).catch(console.error);

      // Outcome-tracking for community-canary-regler: når en AI-forslått aksjon
      // godkjennes/avvises, oppdater alle aktive canary-regler. Crude men
      // konvergerer over tid — promotes/demotes basert på vinnerrate.
      if (source !== "manual") {
        (async () => {
          const all = await storage.getCommunitySignals({ status: "canary" });
          for (const r of all) {
            if (accepted) {
              await storage.updateCommunitySignal(r.id, { canaryWins: r.canaryWins + 1 });
            } else {
              await storage.updateCommunitySignal(r.id, { canaryLosses: r.canaryLosses + 1 });
            }
            // Auto-promote/demote etter ~30 hits
            const total = r.canaryWins + r.canaryLosses + 1;
            if (total >= 30) {
              const winRate = (accepted ? r.canaryWins + 1 : r.canaryWins) / total;
              if (winRate >= 0.7) await storage.updateCommunitySignal(r.id, { status: "promoted" });
              else if (winRate < 0.4) await storage.updateCommunitySignal(r.id, { status: "demoted" });
            }
          }
        })().catch(err => console.error("Outcome-tracking failed:", err.message));
      }

      // Bidra til kollektiv læring hvis (a) det er et manuelt tillegg, (b)
      // brukeren har ikke opt-out, (c) vi har transkript-kontekst.
      if (source === "manual" && context && (type === "action" || type === "decision")) {
        const prefs = await storage.getAiPreferences(userId);
        if (!prefs?.communityOptOut) {
          // Async, best-effort
          (async () => {
            await anonymizeAndContribute({
              type: type === "action" ? "missed_action" : "missed_decision",
              actionText: text,
              transcriptContext: context,
            });
            await storage.incrementCommunityContributions(userId);
          })().catch(err => console.error("Community contribution failed:", err.message));
        }
      }

      res.json({ ok: true });
    } catch (err: any) {
      console.error("Error logging feedback:", err.message);
      res.status(500).json({ error: "Kunne ikke lagre tilbakemelding" });
    }
  });

  // POST /api/feedback/summary - log summary comment
  app.post("/api/feedback/summary", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const { commentText, summaryExcerpt } = req.body;
      if (!commentText) {
        return res.status(400).json({ error: "Mangler commentText" });
      }
      await storage.logSummaryFeedback(userId, commentText, summaryExcerpt);
      // Trigger async profile update after every feedback (non-blocking)
      updateSummaryProfile(userId).catch(console.error);
      res.json({ ok: true });
    } catch (err: any) {
      console.error("Error logging summary feedback:", err.message);
      res.status(500).json({ error: "Kunne ikke lagre referat-tilbakemelding" });
    }
  });

  // POST /api/feedback/summary-diff - analyze structural diff between original and edited summary
  // This is the core "memory" endpoint: compares what AI generated vs what user actually wanted,
  // extracts concrete style/content preferences, and IMMEDIATELY updates the learned profile.
  app.post("/api/feedback/summary-diff", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const { original, edited, sessionTitle } = req.body;
      if (!original || !edited) {
        return res.status(400).json({ error: "Mangler original eller edited" });
      }
      if (original.trim() === edited.trim()) {
        return res.json({ ok: true, analysis: "Ingen endringer", profileText: "" });
      }

      // Ask GPT-4.1 to do a structured diff analysis
      const diffResponse = await openai.chat.completions.create({
        model: "gpt-4.1",
        messages: [
          {
            role: "system",
            content: `Du er en ekspert på å analysere redigeringer i møtereferater.
Du sammenligner et AI-generert referat med brukerens redigerte versjon, og trekker ut KONKRETE læringspoeng.

Analyser disse dimensjonene:
1. STRUKTUR: Ble seksjoner lagt til, fjernet eller reorganisert? Hvilke?
2. LENGDE: Ble tekst kortet ned eller utvidet? Hvor mye og i hvilke seksjoner?
3. STIL: Endret brukeren formelt/uformelt språk? Mer/mindre detaljer? Aktivt/passivt?
4. INNHOLD: Hva la brukeren til som AI-en glemte? Hva slettet de som unødvendig?
5. FORMULERINGER: Konkrete setninger/formuleringer brukeren foretrekker (sitér dem)

Svar med en STRUKTURERT DIFF-ANALYSE: som starter slik, og bruk disse overskriftene:
STRUKTURERT DIFF-ANALYSE: ${sessionTitle || "Ukjent møte"}
[SEKSJONSENDRINGER]: ...
[LENGDEENDRINGER]: ...
[STILENDRINGER]: ...
[INNHOLDSENDRINGER]: ...
[FORETRUKNE FORMULERINGER]: ...
[OPPSUMMERING AV LÆRINGSPOENG]: 2-3 bullet points med de viktigste mønstrene

Vær SVÆRT konkret. Unngå vage beskrivelser. Sitér faktiske endringer.`,
          },
          {
            role: "user",
            content: `=== AI-GENERERT REFERAT (ORIGINAL) ===\n${original.slice(0, 6000)}\n\n=== BRUKERENS REDIGERTE VERSJON ===\n${edited.slice(0, 6000)}`,
          },
        ],
        max_tokens: 1000,
        temperature: 0.2,
      });

      const diffAnalysis = diffResponse.choices[0]?.message?.content || "";

      // Store the structured diff as a special feedback entry
      await storage.logSummaryFeedback(userId, diffAnalysis, edited.slice(0, 400));

      // IMMEDIATELY update the profile (blocking — we want to return the new profile to the client)
      const newProfileText = await updateSummaryProfile(userId) || "";

      res.json({ ok: true, analysis: diffAnalysis, profileText: newProfileText });
    } catch (err: any) {
      console.error("Error analyzing summary diff:", err.message);
      res.status(500).json({ error: "Kunne ikke analysere redigering" });
    }
  });

  // GET /api/learning/profiles - get both learned preference profiles
  app.get("/api/learning/profiles", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const [aiPrefs, summaryPrefs, feedbackLogs, summaryFeedbacks] = await Promise.all([
        storage.getAiPreferences(userId),
        storage.getSummaryPreferences(userId),
        storage.getFeedbackLog(userId),
        storage.getSummaryFeedbackLog(userId),
      ]);
      res.json({
        aiProfile: aiPrefs?.profileText || "",
        aiSignalCount: feedbackLogs.length,
        aiLastUpdated: aiPrefs?.updatedAt || null,
        summaryProfile: summaryPrefs?.profileText || "",
        summaryFeedbackCount: summaryFeedbacks.length,
        summaryLastUpdated: summaryPrefs?.updatedAt || null,
      });
    } catch (err: any) {
      console.error("Error fetching learning profiles:", err.message);
      res.status(500).json({ error: "Kunne ikke hente læringsdata" });
    }
  });

  // POST /api/learning/update-profile - force update ai preferences
  app.post("/api/learning/update-profile", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      await updateAiProfile(userId);
      const prefs = await storage.getAiPreferences(userId);
      res.json({ ok: true, profileText: prefs?.profileText || "" });
    } catch (err: any) {
      res.status(500).json({ error: "Kunne ikke oppdatere AI-profil" });
    }
  });

  // POST /api/learning/update-summary-profile - force update summary preferences
  app.post("/api/learning/update-summary-profile", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      await updateSummaryProfile(userId);
      const prefs = await storage.getSummaryPreferences(userId);
      res.json({ ok: true, profileText: prefs?.profileText || "" });
    } catch (err: any) {
      res.status(500).json({ error: "Kunne ikke oppdatere referat-profil" });
    }
  });

  // ============= Word Corrections (custom vocabulary) =============

  app.get("/api/word-corrections", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const corrections = await storage.getWordCorrections(userId);
      res.json({ corrections });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/word-corrections", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const { original, corrected } = req.body;
      if (!original || !corrected) return res.status(400).json({ error: "original og corrected er påkrevd" });
      const correction = await storage.upsertWordCorrection(userId, original.trim(), corrected.trim());
      res.json({ correction });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/word-corrections/:id", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const id = parseInt(req.params.id);
      const deleted = await storage.deleteWordCorrection(userId, id);
      if (!deleted) return res.status(404).json({ error: "Ikke funnet" });
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============= Meeting Session Endpoints =============

  // GET /api/sessions - get all sessions, enriched with series name
  app.get("/api/sessions", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const sessions = await storage.getMeetingSessions(userId);
      // Attach series name from meeting_series so the client never has to do a separate lookup
      const seriesList = await storage.getMeetingSeriesList(userId);
      const seriesMap = new Map(seriesList.map(s => [s.id, s.name]));
      const enriched = sessions.map(s => ({
        ...s,
        // Prefer the name stored directly on the session; fall back to meeting_series table
        seriesName: s.seriesName ?? (s.seriesId ? (seriesMap.get(s.seriesId) ?? null) : null),
      }));
      res.json({ sessions: enriched });
    } catch (error: any) {
      console.error("Feil ved henting av sesjoner:", error);
      res.status(500).json({ error: "Kunne ikke hente sesjoner", details: error.message });
    }
  });

  // GET /api/sessions/:id - get specific session
  app.get("/api/sessions/:id", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Ugyldig ID" });
      }

      const session = await storage.getMeetingSession(userId, id);
      if (!session) {
        return res.status(404).json({ error: "Sesjon ikke funnet" });
      }

      res.json({ session });
    } catch (error: any) {
      console.error("Feil ved henting av sesjon:", error);
      res.status(500).json({ error: "Kunne ikke hente sesjon", details: error.message });
    }
  });

  // POST /api/sessions - create new session
  app.post("/api/sessions", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const session = await storage.createMeetingSession(userId, {
        title: req.body.title || null,
        expertRole: req.body.expertRole || "bygg",
        questionInterval: req.body.questionInterval || 1,
        seriesId: req.body.seriesId || null,
        seriesIndex: req.body.seriesIndex || null,
        transcript: [],
        questions: [],
        speakerMappings: {},
      });
      res.json({ session });
    } catch (error: any) {
      console.error("Feil ved oppretting av sesjon:", error);
      res.status(500).json({ error: "Kunne ikke opprette sesjon", details: error.message });
    }
  });

  // PATCH /api/sessions/:id - update session
  app.patch("/api/sessions/:id", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Ugyldig ID" });
      }

      const updates: Record<string, unknown> = {};
      
      if (req.body.title !== undefined) updates.title = req.body.title;
      if (req.body.endedAt !== undefined) updates.endedAt = new Date(req.body.endedAt);
      if (req.body.elapsedSeconds !== undefined) updates.elapsedSeconds = req.body.elapsedSeconds;
      if (req.body.expertRole !== undefined) updates.expertRole = req.body.expertRole;
      if (req.body.questionInterval !== undefined) updates.questionInterval = req.body.questionInterval;
      if (req.body.transcript !== undefined) updates.transcript = req.body.transcript;
      if (req.body.questions !== undefined) updates.questions = req.body.questions;
      if (req.body.actionItems !== undefined) updates.actionItems = req.body.actionItems;
      if (req.body.decisions !== undefined) updates.decisions = req.body.decisions;
      if (req.body.speakerMappings !== undefined) updates.speakerMappings = req.body.speakerMappings;
      if (req.body.summary !== undefined) updates.summary = req.body.summary;
      if (req.body.seriesId !== undefined) updates.seriesId = req.body.seriesId;
      if (req.body.seriesIndex !== undefined) updates.seriesIndex = req.body.seriesIndex;

      const session = await storage.updateMeetingSession(userId, id, updates);
      if (!session) {
        return res.status(404).json({ error: "Sesjon ikke funnet" });
      }

      res.json({ session });
    } catch (error: any) {
      console.error("Feil ved oppdatering av sesjon:", error);
      res.status(500).json({ error: "Kunne ikke oppdatere sesjon", details: error.message });
    }
  });

  // DELETE /api/sessions/:id - delete session
  app.delete("/api/sessions/:id", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Ugyldig ID" });
      }

      const deleted = await storage.deleteMeetingSession(userId, id);
      if (!deleted) {
        return res.status(404).json({ error: "Sesjon ikke funnet" });
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("Feil ved sletting av sesjon:", error);
      res.status(500).json({ error: "Kunne ikke slette sesjon", details: error.message });
    }
  });

  // ============= Meeting Series Endpoints =============

  // GET /api/series - list all series with session counts
  app.get("/api/series", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const seriesList = await storage.getMeetingSeriesList(userId);
      const allSessions = await storage.getMeetingSessions(userId);
      const result = seriesList.map(s => ({
        ...s,
        sessionCount: allSessions.filter(sess => sess.seriesId === s.id).length,
      }));
      res.json({ series: result });
    } catch (error: any) {
      res.status(500).json({ error: "Kunne ikke hente møteserier", details: error.message });
    }
  });

  // POST /api/series - create new series
  app.post("/api/series", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const name = (req.body.name || "").trim();
      if (!name) return res.status(400).json({ error: "Serienavn er påkrevd" });
      const series = await storage.createMeetingSeries(userId, { name, description: req.body.description || null });
      res.json({ series });
    } catch (error: any) {
      res.status(500).json({ error: "Kunne ikke opprette møteserie", details: error.message });
    }
  });

  // PATCH /api/series/:id - rename series
  app.patch("/api/series/:id", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Ugyldig ID" });
      const updates: Record<string, string> = {};
      if (req.body.name) updates.name = req.body.name.trim();
      if (req.body.description !== undefined) updates.description = req.body.description;
      const series = await storage.updateMeetingSeries(userId, id, updates);
      if (!series) return res.status(404).json({ error: "Møteserie ikke funnet" });
      // Propagate the new name to all sessions in this series so series_name stays in sync
      if (updates.name) {
        await storage.updateSeriesNameOnSessions(userId, id, updates.name);
      }
      res.json({ series });
    } catch (error: any) {
      res.status(500).json({ error: "Kunne ikke oppdatere møteserie", details: error.message });
    }
  });

  // DELETE /api/series/:id - delete series (sessions become standalone)
  app.delete("/api/series/:id", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Ugyldig ID" });
      const deleted = await storage.deleteMeetingSeries(userId, id);
      if (!deleted) return res.status(404).json({ error: "Møteserie ikke funnet" });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: "Kunne ikke slette møteserie", details: error.message });
    }
  });

  // GET /api/series/:id/summaries - get summaries of all past meetings in a series (for AI cross-analysis)
  app.get("/api/series/:id/summaries", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Ugyldig ID" });
      const sessions = await storage.getSessionsInSeries(userId, id);
      const summaries = sessions
        .filter(s => s.summary)
        .map(s => ({
          title: s.title || `Møte #${s.seriesIndex ?? s.id}`,
          date: s.startedAt?.toISOString() ?? "",
          summary: s.summary!,
          seriesIndex: s.seriesIndex ?? undefined,
        }));
      res.json({ summaries });
    } catch (error: any) {
      res.status(500).json({ error: "Kunne ikke hente referater", details: error.message });
    }
  });

  // =====================================================
  // RULE MANAGEMENT ENDPOINTS
  // =====================================================

  // Multer config for rule document uploads
  const ruleUploadStorage = multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(process.cwd(), "uploads", "rules");
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      cb(null, uniqueSuffix + "-" + file.originalname);
    },
  });

  const ruleUpload = multer({
    storage: ruleUploadStorage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
    fileFilter: (req, file, cb) => {
      const allowedTypes = [
        "application/pdf",
        "text/plain",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ];
      if (allowedTypes.includes(file.mimetype) || 
          file.originalname.match(/\.(pdf|txt|docx)$/i)) {
        cb(null, true);
      } else {
        cb(new Error("Ugyldig filtype. Kun PDF, TXT og DOCX er tillatt."));
      }
    },
  });

  // Helper function to extract text from documents
  async function extractTextFromDocument(filePath: string, mimeType: string): Promise<string> {
    if (mimeType === "text/plain" || filePath.endsWith(".txt")) {
      return fs.readFileSync(filePath, "utf-8");
    } else if (mimeType === "application/pdf" || filePath.endsWith(".pdf")) {
      const dataBuffer = fs.readFileSync(filePath);
      const data = await parsePdf(dataBuffer);
      return data.text;
    } else if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || filePath.endsWith(".docx")) {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ path: filePath });
      if (!result.value || result.value.trim().length === 0) {
        throw new Error("Kunne ikke lese tekst fra DOCX-filen");
      }
      return result.value;
    }
    throw new Error("Ukjent filtype");
  }

  // Helper function to extract rules from document text using OpenAI
  async function extractRulesFromText(text: string, documentName: string): Promise<ExtractedRule[]> {
    const systemPrompt = `Du er en ekspert på å analysere norske regelverk, tekniske forskrifter og kontraktsdokumenter. 
    
Din oppgave er å identifisere og trekke ut alle relevante regler, krav og begrensninger fra dokumentet.

For HVER regel du finner, returner:
- id: En unik ID (f.eks. "rule-001", "rule-002" osv.)
- document_name: Navnet på dokumentet
- section: Seksjonen eller paragrafen regelen kommer fra (f.eks. "§11-12" eller "Kapittel 5.3")
- rule_title: En kort tittel som beskriver regelen
- rule_text: Det faktiske regelinnholdet, sitert eller parafrasert fra dokumentet
- summary: En kort, lettfattelig forklaring av hva regelen betyr i praksis
- tags: Relevante nøkkelord (f.eks. ["brann", "sikkerhet", "areal", "bygghøyde"])

Fokuser på:
- Tekniske krav og begrensninger (TEK17, byggtekniske krav)
- Arealgrenser og dimensjonskrav
- Sikkerhetskrav (brann, rømning, bæreevne)
- Kontraktsforpliktelser og frister
- Reguleringsbestemmelser og utnyttelsesgrad
- HMS-krav og arbeidsgiverforpliktelser

VIKTIG: Returner ALLTID gyldig JSON i formatet:
{
  "rules": [
    {
      "id": "rule-001",
      "document_name": "dokumentnavn",
      "section": "seksjon",
      "rule_title": "tittel",
      "rule_text": "regelinnhold",
      "summary": "forklaring",
      "tags": ["tag1", "tag2"]
    }
  ]
}

Hvis dokumentet ikke inneholder klare regler eller krav, returner: { "rules": [] }`;

    const response = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Analyser følgende dokument og trekk ut alle regler og krav:\n\nDOKUMENTNAVN: ${documentName}\n\nINNHOLD:\n${text.substring(0, 50000)}` } // Limit to ~50k chars
      ],
      response_format: { type: "json_object" },
      max_tokens: 4000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return [];
    }

    try {
      const parsed = JSON.parse(content);
      const rules: ExtractedRule[] = (parsed.rules || []).map((r: any, index: number) => ({
        id: r.id || `rule-${index + 1}`,
        document_name: documentName,
        section: r.section || "Ukjent seksjon",
        rule_title: r.rule_title || "Ukjent regel",
        rule_text: r.rule_text || "",
        summary: r.summary || "",
        tags: r.tags || [],
      }));
      return rules;
    } catch (e) {
      console.error("Failed to parse rules JSON:", e);
      return [];
    }
  }

  // POST /api/rules/upload - Upload document and extract rules
  app.post("/api/rules/upload", requireAuth, ruleUpload.single("document"), async (req, res) => {
    const userId = getUserId(req);
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, error: "Ingen fil lastet opp" });
      }

      const file = req.file;

      // Create document entry with processing status
      const documentId = await storage.addDocument(userId, {
        filename: file.filename,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        storagePath: file.path,
        status: "processing",
        rulesExtracted: 0,
      });

      // Extract text from document
      let text: string;
      try {
        text = await extractTextFromDocument(file.path, file.mimetype);
      } catch (err: any) {
        await storage.updateDocumentStatus(userId, documentId, "error", 0, err.message);
        const state = await storage.getRulesState(userId);
        return res.status(500).json({ 
          success: false, 
          error: "Kunne ikke lese dokumentet", 
          document: state.documents.find(d => d.id === String(documentId)) 
        });
      }

      // Extract rules using OpenAI
      try {
        const extractedRules = await extractRulesFromText(text, file.originalname);
        
        // Convert to database format
        const dbRules = extractedRules.map(r => ({
          documentId,
          externalRuleId: `doc${documentId}-${r.id}`,
          documentName: r.document_name,
          section: r.section,
          ruleTitle: r.rule_title,
          ruleText: r.rule_text,
          summary: r.summary,
          tags: r.tags,
        }));
        
        await storage.addRules(userId, dbRules);
        await storage.updateDocumentStatus(userId, documentId, "ready", extractedRules.length);

        const state = await storage.getRulesState(userId);
        res.json({
          success: true,
          document: state.documents.find(d => d.id === String(documentId)),
          rules: extractedRules,
        });
      } catch (err: any) {
        console.error("Rule extraction error:", err);
        await storage.updateDocumentStatus(userId, documentId, "error", 0, "Regelekstraksjon feilet");
        const state = await storage.getRulesState(userId);
        res.status(500).json({ 
          success: false, 
          error: "Kunne ikke trekke ut regler",
          document: state.documents.find(d => d.id === String(documentId))
        });
      }
    } catch (error: any) {
      console.error("Document upload error:", error);
      res.status(500).json({ success: false, error: error.message || "Opplastingsfeil" });
    }
  });

  // GET /api/rules - Get all rules and documents
  app.get("/api/rules", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    const state = await storage.getRulesState(userId);
    res.json({
      documents: state.documents,
      rules: state.rules,
      ruleCount: state.rules.length,
      documentCount: state.documents.length,
      lastUpdated: state.lastUpdated,
    });
  });

  // DELETE /api/rules - Clear all rules
  app.delete("/api/rules", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    await storage.clearRules(userId);
    res.json({ success: true });
  });

  // DELETE /api/rules/document/:id - Remove specific document and its rules
  app.delete("/api/rules/document/:id", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    const documentId = parseInt(req.params.id, 10);
    
    if (isNaN(documentId)) {
      return res.status(400).json({ error: "Ugyldig dokument-ID" });
    }
    
    const state = await storage.getRulesState(userId);
    const doc = state.documents.find(d => d.id === String(documentId));
    
    if (!doc) {
      return res.status(404).json({ error: "Dokument ikke funnet" });
    }

    // Remove rules from this document
    const rulesBeforeCount = state.rules.length;
    await storage.removeDocument(userId, documentId);
    const stateAfter = await storage.getRulesState(userId);

    res.json({ 
      success: true, 
      rulesRemoved: rulesBeforeCount - stateAfter.rules.length 
    });
  });

  // POST /api/rules/text - Extract rules from pasted text
  app.post("/api/rules/text", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const { text, name } = req.body;
      
      if (!text || typeof text !== "string" || text.trim().length === 0) {
        return res.status(400).json({ success: false, error: "Ingen tekst mottatt" });
      }
      
      // Check document limit
      const state = await storage.getRulesState(userId);
      if (state.documents.length >= 5) {
        return res.status(400).json({ success: false, error: "Maks 5 dokumenter tillatt" });
      }
      
      const documentName = name || `Innlimt tekst ${new Date().toLocaleString("no-NO")}`;
      
      // Create document entry in database
      const documentId = await storage.addDocument(userId, {
        filename: `text-${Date.now()}`,
        originalName: documentName,
        mimeType: "text/plain",
        size: text.length,
        storagePath: null,
        status: "processing",
        rulesExtracted: 0,
      });
      
      try {
        const extractedRules = await extractRulesFromText(text, documentName);
        
        // Convert to database format
        const dbRules = extractedRules.map(r => ({
          documentId,
          externalRuleId: `doc${documentId}-${r.id}`,
          documentName: r.document_name,
          section: r.section,
          ruleTitle: r.rule_title,
          ruleText: r.rule_text,
          summary: r.summary,
          tags: r.tags,
        }));
        
        await storage.addRules(userId, dbRules);
        await storage.updateDocumentStatus(userId, documentId, "ready", extractedRules.length);
        
        const stateAfter = await storage.getRulesState(userId);
        res.json({
          success: true,
          document: stateAfter.documents.find(d => d.id === String(documentId)),
          rules: extractedRules,
        });
      } catch (err: any) {
        console.error("Rule extraction from text error:", err);
        await storage.updateDocumentStatus(userId, documentId, "error", 0, "Regelekstraksjon feilet");
        const stateAfter = await storage.getRulesState(userId);
        res.status(500).json({
          success: false,
          error: "Kunne ikke trekke ut regler fra teksten",
          document: stateAfter.documents.find(d => d.id === String(documentId)),
        });
      }
    } catch (error: any) {
      console.error("Text rule extraction error:", error);
      res.status(500).json({ success: false, error: error.message || "Analysefeil" });
    }
  });

  // =====================================================
  // MEETING DOCUMENT ENDPOINTS
  // =====================================================

  // Multer config for meeting document uploads (reuse same allowed types as rule docs)
  const meetingDocUploadStorage = multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(process.cwd(), "uploads", "meeting-docs");
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${file.originalname}`);
    },
  });
  const meetingDocUpload = multer({
    storage: meetingDocUploadStorage,
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (["application/pdf", "text/plain", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"].includes(file.mimetype)
        || file.originalname.match(/\.(pdf|txt|docx)$/i)) {
        cb(null, true);
      } else {
        cb(new Error("Kun PDF, TXT og DOCX er tillatt"));
      }
    },
  });

  // Helper: Extract key points from document text using GPT
  async function extractKeyPointsFromText(text: string, docName: string): Promise<string> {
    const trimmed = text.slice(0, 12000); // limit to ~12k chars
    const response = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [
        {
          role: "system",
          content: `Du er en ekspert på å lese og indeksere dokumenter for bruk i møtekontekst.
Din oppgave er å lese dokumentet og trekke ut de viktigste punktene som er relevante for møter: 
krav, retningslinjer, beslutningsprinsipper, avtalte prosedyrer, policyer, målsetninger og faktainformasjon.

Formater resultatet som en kompakt nummerert liste med korte, tydelige punkter.
Hvert punkt skal beskrive EN ting dokumentet fastslår, krever eller anbefaler.
Maks 20 punkter. Vær presis og konkret. Skriv på norsk.`,
        },
        {
          role: "user",
          content: `Dokument: "${docName}"\n\nInnhold:\n${trimmed}`,
        },
      ],
      max_tokens: 1500,
      temperature: 0.3,
    });
    return response.choices[0]?.message?.content?.trim() ?? "";
  }

  // POST /api/meeting-documents/upload
  app.post("/api/meeting-documents/upload", requireAuth, meetingDocUpload.single("document"), async (req, res) => {
    const userId = getUserId(req);
    try {
      const file = req.file;
      const sessionId = req.body.sessionId ? parseInt(req.body.sessionId) : null;
      const seriesId = req.body.seriesId ? parseInt(req.body.seriesId) : null;

      if (!file && !req.body.text) {
        return res.status(400).json({ error: "Fil eller tekst er påkrevd" });
      }
      if (!sessionId && !seriesId) {
        return res.status(400).json({ error: "sessionId eller seriesId er påkrevd" });
      }

      let rawText: string;
      let originalName: string;
      let fileType: string;

      if (file) {
        rawText = await extractTextFromDocument(file.path, file.mimetype);
        originalName = file.originalname;
        fileType = file.mimetype.includes("pdf") ? "pdf" : file.mimetype.includes("docx") ? "docx" : "txt";
        // Clean up temp file
        try { fs.unlinkSync(file.path); } catch {}
      } else {
        rawText = req.body.text as string;
        originalName = req.body.filename || "Innlimt tekst";
        fileType = "txt";
      }

      if (!rawText || rawText.trim().length < 10) {
        return res.status(400).json({ error: "Dokumentet inneholder ikke nok tekst" });
      }

      // AI-index key points
      const keyPoints = await extractKeyPointsFromText(rawText, originalName);

      const doc = await storage.createMeetingDocument(userId, {
        sessionId,
        seriesId,
        originalName,
        fileType,
        keyPoints,
        rawContentPreview: rawText.slice(0, 500),
      });

      res.json({ success: true, document: doc });
    } catch (error: any) {
      console.error("Meeting document upload error:", error);
      res.status(500).json({ success: false, error: error.message || "Opplasting feilet" });
    }
  });

  // GET /api/meeting-documents
  app.get("/api/meeting-documents", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const sessionId = req.query.sessionId ? parseInt(req.query.sessionId as string) : undefined;
      const seriesId = req.query.seriesId ? parseInt(req.query.seriesId as string) : undefined;
      const docs = await storage.getMeetingDocuments(userId, sessionId, seriesId);
      res.json({ documents: docs });
    } catch (error: any) {
      console.error("Meeting document list error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // DELETE /api/meeting-documents/:id
  app.delete("/api/meeting-documents/:id", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const id = parseInt(req.params.id);
      const deleted = await storage.deleteMeetingDocument(userId, id);
      res.json({ success: deleted });
    } catch (error: any) {
      console.error("Meeting document delete error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ============= Skjermbilder med AI-tolkning =============

  // POST /api/screenshots/analyze — tolk bilde uten å lagre. Brukes for
  // forhåndsvisning under møtet før bruker bestemmer om bildet skal beholdes.
  app.post("/api/screenshots/analyze", requireAuth, async (req, res) => {
    try {
      const { imageData, mimeType, recentTranscript } = req.body as {
        imageData?: string;
        mimeType?: string;
        recentTranscript?: string;
      };
      if (!imageData) return res.status(400).json({ error: "imageData mangler" });

      const dataUrl = imageData.startsWith("data:")
        ? imageData
        : `data:${mimeType || "image/jpeg"};base64,${imageData}`;

      const contextHint = recentTranscript && recentTranscript.trim()
        ? `\n\nDe siste utsagnene fra møtet (for kontekst): ${recentTranscript.slice(-800)}`
        : "";

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `Du er en assistent for et byggteknisk møte-referat. Brukeren deler skjerm der de viser bygg-relaterte ressurser: 3D-BIM-modeller, plantegninger, snitt, fasader, framdriftsplaner, taktplaner, regneark, dokumenter eller liknende.

Beskriv hva bildet viser på norsk med ~3-5 setninger. Fokuser på det som er FAGLIG RELEVANT for et byggemøte:
- Hvis 3D-modell: hvilke fag/elementer er synlige (bærekonstruksjon, HVAC, arkitektur), hvilken vinkel/etasje, eventuelle markerte kollisjoner.
- Hvis plantegning/snitt: hvilken etasje/akse, hvilke rom eller områder som er fokus, eventuelle markeringer (oransje sirkel, røde piler).
- Hvis framdriftsplan/Gantt: hvilket prosjekt, hvilken periode, eventuelle kritiske aktiviteter eller milepæler.
- Hvis regneark/tabell: hva som måles eller sammenliknes, gjør et anslag av nøkkeltall hvis lesbart.
- Hvis dokument/tekst: kort om hva dokumentet handler om.

IKKE beskriv UI-elementer som menyer eller knapper med mindre de er relevante for innholdet. IKKE finn på data du ikke ser. Hvis bildet er uklart eller ikke faglig relevant, si det kort.`,
          },
          {
            role: "user",
            content: [
              { type: "text", text: `Beskriv dette skjermbildet kort og presist.${contextHint}` },
              { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
            ] as any,
          },
        ],
        max_tokens: 400,
        temperature: 0.3,
      });

      const description = response.choices[0]?.message?.content?.trim() || "";
      res.json({ description });
    } catch (error: any) {
      console.error("Screenshot analyze error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/screenshots?sessionId=X
  app.get("/api/screenshots", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const sessionId = req.query.sessionId ? parseInt(req.query.sessionId as string, 10) : undefined;
      const list = await storage.getMeetingScreenshots(userId, sessionId);
      res.json({ screenshots: list });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/screenshots — lagre etter at bruker har valgt å beholde
  app.post("/api/screenshots", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const { imageData, mimeType, description, sessionId, includedInSummary } = req.body as {
        imageData: string;
        mimeType?: string;
        description: string;
        sessionId?: number | null;
        includedInSummary?: boolean;
      };
      if (!imageData || !description) return res.status(400).json({ error: "imageData og description er påkrevd" });
      const created = await storage.createMeetingScreenshot(userId, {
        sessionId: sessionId ?? null,
        imageData,
        mimeType: mimeType || "image/jpeg",
        description,
        includedInSummary: includedInSummary ?? false,
      });
      res.json({ screenshot: created });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // PATCH /api/screenshots/:id — toggle includedInSummary, oppdater beskrivelse
  app.patch("/api/screenshots/:id", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Ugyldig ID" });
      const updates: Record<string, unknown> = {};
      if (typeof req.body.includedInSummary === "boolean") updates.includedInSummary = req.body.includedInSummary;
      if (typeof req.body.description === "string") updates.description = req.body.description;
      if (typeof req.body.sessionId === "number") updates.sessionId = req.body.sessionId;
      const updated = await storage.updateMeetingScreenshot(userId, id, updates);
      if (!updated) return res.status(404).json({ error: "Ikke funnet" });
      res.json({ screenshot: updated });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // DELETE /api/screenshots/:id
  app.delete("/api/screenshots/:id", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Ugyldig ID" });
      await storage.deleteMeetingScreenshot(userId, id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============= Kollektiv læring (anonymisert, opt-out) =============
  // Hver gang en bruker manuelt legger til en aksjon eller beslutning, er
  // det et signal AI-en misset. Vi anonymiserer det og bygger en pott av
  // universelle fang-regler som alle brukere drar nytte av.

  app.get("/api/community/preferences", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const prefs = await storage.getAiPreferences(userId);
      res.json({
        optOut: prefs?.communityOptOut ?? false,
        contributions: prefs?.communityContributions ?? 0,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/community/preferences", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const optOut = !!req.body.optOut;
      await storage.setCommunityOptOut(userId, optOut);
      res.json({ ok: true, optOut });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/community/signals", requireAuth, async (req, res) => {
    try {
      const status = (req.query.status as string) || undefined;
      const list = await storage.getCommunitySignals(status ? { status } : undefined);
      res.json({ signals: list });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/community/aggregate — syntesiserer candidate-signaler til
  // universelle fang-regler. Promoterer top regler til canary-status.
  app.post("/api/community/aggregate", requireAuth, async (req, res) => {
    try {
      const candidates = await storage.getCommunitySignals({ status: "candidate" });
      if (candidates.length < 3) {
        return res.json({ ok: true, message: "For få kandidater (<3) for syntese", processed: 0 });
      }
      const byType: Record<string, typeof candidates> = {};
      for (const c of candidates) {
        if (!byType[c.signalType]) byType[c.signalType] = [];
        byType[c.signalType].push(c);
      }
      let promoted = 0;
      for (const [signalType, group] of Object.entries(byType)) {
        if (group.length < 3) continue;
        const synthResp = await openai.chat.completions.create({
          model: "gpt-4.1",
          messages: [
            {
              role: "system",
              content: `Du syntesiserer mønstre fra ulike brukeres anonymiserte signaler til universelle fang-regler for et møtereferat-system.

Du får N kandidater med mønstre + anonymiserte eksempler. Identifiser de TOP 3-5 mest universelle og handlingsorienterte reglene. Slå sammen duplikater. Forkast mønstre som er for spesifikke til én bruker eller bedrift.

Returner JSON:
{
  "rules": [
    {
      "pattern": "Når noen sier 'kan du sjekke X' → fang som aksjon (X som oppgave, ansvarlig=mottaker)",
      "evidence": "anonymisert eksempel som er bredt anvendelig"
    }
  ]
}

Vær konkret og handlingsorientert. Generelle regler som "fang flere aksjoner" er verdiløse.`,
            },
            {
              role: "user",
              content: `Signal-type: ${signalType}\n\nKandidater (${group.length}):\n${group.slice(0, 25).map((c, i) => `${i + 1}. Mønster: ${c.pattern}\n   Eksempel: ${c.evidence ?? "(ingen)"}\n   Bidragsytere: ${c.contributors}`).join("\n\n")}`,
            },
          ],
          response_format: { type: "json_object" },
          max_tokens: 1500,
          temperature: 0.3,
        });
        const content = synthResp.choices[0]?.message?.content;
        if (!content) continue;
        try {
          const parsed = JSON.parse(content);
          const rules = parsed.rules || [];
          for (const r of rules) {
            if (!r.pattern) continue;
            await storage.createCommunitySignal({
              signalType,
              pattern: r.pattern,
              evidence: r.evidence ?? null,
              status: "canary",
              contributors: group.length,
              canaryHits: 0,
              canaryWins: 0,
              canaryLosses: 0,
            });
            promoted++;
          }
          for (const c of group) {
            await storage.updateCommunitySignal(c.id, { status: "demoted" });
          }
        } catch (e) {
          console.error("Synth parse error:", e);
        }
      }
      res.json({ ok: true, promoted, processedCandidates: candidates.length });
    } catch (error: any) {
      console.error("Aggregate error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ============= Intervjutrening =============

  // GET liste
  app.get("/api/interview/sessions", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const sessions = await storage.getInterviewSessions(userId);
      res.json({ sessions });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET én økt
  app.get("/api/interview/sessions/:id", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Ugyldig ID" });
      const session = await storage.getInterviewSession(userId, id);
      if (!session) return res.status(404).json({ error: "Ikke funnet" });
      res.json({ session });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST opprett
  app.post("/api/interview/sessions", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const session = await storage.createInterviewSession(userId, {
        title: req.body.title || null,
        industry: req.body.industry || "bygg",
        elapsedSeconds: 0,
        transcript: [],
        currentScores: null,
        currentStar: null,
        evalHistory: [],
        report: null,
        endedAt: null,
      });
      res.json({ session });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // PATCH oppdater
  app.patch("/api/interview/sessions/:id", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Ugyldig ID" });
      const updates: Record<string, unknown> = {};
      const allowed = ["title", "industry", "elapsedSeconds", "transcript", "currentScores", "currentStar", "evalHistory", "report", "endedAt"];
      for (const key of allowed) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }
      const session = await storage.updateInterviewSession(userId, id, updates);
      if (!session) return res.status(404).json({ error: "Ikke funnet" });
      res.json({ session });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // DELETE
  app.delete("/api/interview/sessions/:id", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Ugyldig ID" });
      await storage.deleteInterviewSession(userId, id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST analyze — live evaluering hvert minutt
  app.post("/api/interview/analyze", requireAuth, async (req, res) => {
    try {
      const transcript: TranscriptSegment[] = req.body.transcript || [];
      const industry: string = req.body.industry || "bygg";
      const minute: number = req.body.minute || 0;

      if (transcript.length === 0) {
        return res.json({ scores: null, star: null, candidateText: "" });
      }

      const transcriptText = transcript.map(s => s.text).join("\n");

      const systemPrompt = buildInterviewSystemPrompt(industry);
      const userContent = `Her er transkripsjonen så langt (intervjuer og kandidat blandet):\n\n${transcriptText}\n\nAnalyser KUN kandidatens svar. Returner JSON som beskrevet.`;

      const response = await openai.chat.completions.create({
        model: "gpt-4.1",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
        max_tokens: 1500,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) return res.json({ scores: null, star: null, candidateText: "" });

      try {
        const parsed = JSON.parse(content);
        const scores: InterviewScores = parsed.scores;
        const star: StarStatus = parsed.star ?? { situation: false, task: false, action: false, result: false };
        const candidateText: string = parsed.candidate_text ?? "";

        // Validér: alle 6 kriterier må være til stede
        const required = ["konkretisering", "fagdybde", "eierskap", "refleksjon", "samhandling", "struktur"] as const;
        for (const key of required) {
          if (!scores?.[key] || typeof scores[key].score !== "number") {
            return res.status(500).json({ error: "Ugyldig AI-respons", detail: content.slice(0, 500) });
          }
          // Klamp til 0-10
          scores[key].score = Math.max(0, Math.min(10, scores[key].score));
        }

        const snapshot: InterviewEvalSnapshot = {
          at: new Date().toISOString(),
          minute,
          scores,
          star,
          candidateWordCount: candidateText.split(/\s+/).filter(Boolean).length,
        };

        res.json({ scores, star, snapshot, candidateText });
      } catch (e: any) {
        console.error("Interview analyze JSON parse error:", e);
        res.status(500).json({ error: "JSON-parsing feilet" });
      }
    } catch (error: any) {
      console.error("Interview analyze error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // POST report — generer sluttrapport
  app.post("/api/interview/report", requireAuth, async (req, res) => {
    try {
      const transcript: TranscriptSegment[] = req.body.transcript || [];
      const evalHistory: InterviewEvalSnapshot[] = req.body.evalHistory || [];
      const industry: string = req.body.industry || "bygg";

      if (transcript.length === 0) {
        return res.status(400).json({ error: "Ingen transkripsjon" });
      }

      const transcriptText = transcript.map(s => s.text).join("\n");
      const lastEval = evalHistory[evalHistory.length - 1];

      const systemPrompt = `${buildInterviewSystemPrompt(industry)}

NÅ SKAL DU LAGE EN DETALJERT SLUTTRAPPORT.

Returner JSON med:
{
  "summary": "2-3 setninger om kandidatens helhetsinntrykk",
  "strengths": ["3-5 konkrete styrker, med referanse til hva kandidaten faktisk sa"],
  "improvements": ["3-5 konkrete forbedringspunkter, hver med (a) hva som var svakt, (b) hvorfor det matter, (c) konkret råd for neste gang"],
  "scores": {
    "konkretisering": {"score": 0-10, "rationale": "..."},
    "fagdybde": {"score": 0-10, "rationale": "..."},
    "eierskap": {"score": 0-10, "rationale": "..."},
    "refleksjon": {"score": 0-10, "rationale": "..."},
    "samhandling": {"score": 0-10, "rationale": "..."},
    "struktur": {"score": 0-10, "rationale": "..."}
  }
}`;

      const userContent = `Full transkripsjon:\n\n${transcriptText}\n\nLag detaljert sluttrapport.`;

      const response = await openai.chat.completions.create({
        model: "gpt-4.1",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
        temperature: 0.4,
        max_tokens: 2500,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) return res.status(500).json({ error: "Tom AI-respons" });

      try {
        const parsed = JSON.parse(content);
        const report: InterviewReport = {
          summary: parsed.summary || "",
          strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
          improvements: Array.isArray(parsed.improvements) ? parsed.improvements : [],
          finalScores: parsed.scores || lastEval?.scores,
          generatedAt: new Date().toISOString(),
        };
        res.json({ report });
      } catch (e: any) {
        res.status(500).json({ error: "JSON-parsing feilet" });
      }
    } catch (error: any) {
      console.error("Interview report error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  return httpServer;
}

/**
 * Forsøker å reparere JSON som ble kuttet midt i (typisk når GPT treffer
 * max_tokens). Klipper til siste komma/objekt-grense og lukker
 * gjenstående { [ med } ]. Best-effort — returnerer null hvis det ikke gir
 * gyldig JSON.
 */
function tryRepairTruncatedJson(raw: string): string | null {
  if (!raw) return null;
  let s = raw.trim();
  // Strip eventuell markdown code fence
  s = s.replace(/^```(json)?\s*/i, "").replace(/```\s*$/i, "");

  // Tell ulukkede strukturer
  let inString = false;
  let escape = false;
  const stack: string[] = [];
  let lastSafeIdx = -1;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape) { escape = false; continue; }
    if (c === "\\") { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" || c === "]") stack.pop();

    if (stack.length > 0 && (c === "," || c === "}" || c === "]")) {
      lastSafeIdx = i;
    }
  }

  // Hvis vi er midt i en streng, klipp ved siste sikre punkt
  let truncated = s;
  if (inString && lastSafeIdx > 0) {
    truncated = s.slice(0, lastSafeIdx + 1);
    // Telle igjen
    inString = false;
    escape = false;
    stack.length = 0;
    for (let i = 0; i < truncated.length; i++) {
      const c = truncated[i];
      if (escape) { escape = false; continue; }
      if (c === "\\") { escape = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (c === "{" || c === "[") stack.push(c);
      else if (c === "}" || c === "]") stack.pop();
    }
  }

  // Fjern hengende komma før vi lukker
  truncated = truncated.replace(/,\s*$/, "");

  // Lukk gjenstående
  while (stack.length > 0) {
    const open = stack.pop()!;
    truncated += open === "{" ? "}" : "]";
  }

  return truncated;
}

function buildInterviewSystemPrompt(industry: string): string {
  const industryContext = industry === "bygg"
    ? `BRANSJE: Bygg/anlegg. Forventede fagområder: VDC, taktplanlegging, kontraktsformer (NS 8405/8407, totalentreprise, samspill), risiko, grensesnitt mellom fag, byggeplassdrift, HMS, prosjektering, prosjektøkonomi.`
    : `BRANSJE: Generelt — vurder kandidaten mot generelle profesjonelle kriterier.`;

  return `Du er en erfaren intervju-coach som vurderer en jobbintervju-kandidat live.

${industryContext}

OPPGAVE 1 — SKILL INTERVJUER FRA KANDIDAT
Transkripsjonen blander begge stemmer. Bruk disse heuristikkene:
- INTERVJUER: korte ytringer som ofte ender med "?", introduserer temaer, ber om eksempler ("Kan du fortelle om…", "Hvordan gjorde du…").
- KANDIDAT: lengre svar i jeg-form, beskriver erfaring og prosjekter.
Trekk ut all KANDIDAT-tekst som én sammenhengende ytring og evalér KUN den.

OPPGAVE 2 — EVALUER KANDIDATEN PÅ 6 KRITERIER (1-10)

1. KONKRETISERING (1-10): Bruker tall, navn på prosjekter, roller, fagdisipliner, måleenheter, tidsangivelser?
   Lav (1-3): "vi pleier å…", "vi leverte gode resultater" — vagt.
   Middels (4-6): noen eksempler men mangler tall/kontekst.
   Høy (7-10): konkrete eksempler med prosjektnavn, roller, tall, tid.

2. FAGDYBDE (1-10): Forstår faget reelt? Bruker fagterminologi presist eller bare buzzord?
   Lav: gjentar moteord uten å forklare ("vi jobbet smidig"), blander begreper.
   Høy: presis bruk av fagord (taktplanlegging, VDC-roller, risiko-allokering, grensesnitt).

3. EIERSKAP (1-10): Skiller mellom hva hen selv gjorde vs teamet?
   Lav: utelukkende vi-form, uklart hva personen bidro med.
   Høy: tydelig "jeg gjorde X, teamet gjorde Y, resultatet ble Z". Tar ansvar også for dårlige utfall.

4. REFLEKSJON (1-10): Reflekterer over egne valg, feil og forbedringer?
   Lav: alt gikk bra, ingen feil, ingen læring.
   Høy: beskriver konkrete feil, analyserer årsak, kobler til ny atferd.

5. SAMHANDLING (1-10): Beskriver samspill med andre — kollegaer, kunder, byggherre — på troverdig måte?
   Lav: andre er problemet, lite om egen rolle i samspillet.
   Høy: viser empati, beskriver konflikthåndtering og forventningsstyring.

6. STRUKTUR (1-10): Rød tråd fra spørsmål til svar, holder seg til poenget?
   Lav: lange digresjoner, uklar konklusjon, svarer på noe annet.
   Høy: tydelig STAR-oppbygning (Situation-Task-Action-Result), presist svar.

For HVERT kriterium gi en score (heltall 1-10) og en kort begrunnelse (1 setning, maks ~20 ord). Begrunnelsen skal referere til hva kandidaten faktisk sa — IKKE generisk "kandidaten viser god…" Ikke straff kandidaten for at kort transkript ikke har rukket å vise alt — gi neutral score 5-6 hvis det er for tidlig å vurdere.

OPPGAVE 3 — STAR-DETEKSJON
Sjekk om kandidaten har dekket Situation/Task/Action/Result i sitt SISTE svar:
- Situation: kontekst-beskrivelse (hvilket prosjekt, hva slags rolle)
- Task: hva som måtte oppnås
- Action: hva kandidaten gjorde
- Result: hva utfallet ble

Returner ALLTID JSON i dette eksakte formatet:
{
  "candidate_text": "Den sammenhengende kandidat-ytringen du klippet ut, eller tom streng hvis ingen kandidat-tekst er identifisert ennå",
  "scores": {
    "konkretisering": {"score": 7, "rationale": "Nevner takt 4 uker og 12% redusert avvik, men savner prosjektnavn."},
    "fagdybde": {"score": 6, "rationale": "Bruker 'samhandling' korrekt, men forklarer ikke takt-mekanikken."},
    "eierskap": {"score": 5, "rationale": "Mest 'vi'-form; uklart hva kandidaten selv gjorde."},
    "refleksjon": {"score": 4, "rationale": "Ingen omtale av hva som ikke fungerte eller forbedringer."},
    "samhandling": {"score": 7, "rationale": "Beskriver dialog med byggherre konkret."},
    "struktur": {"score": 6, "rationale": "Klar situasjon, men resultat kommer som biting på slutten."}
  },
  "star": {
    "situation": true,
    "task": true,
    "action": true,
    "result": false
  }
}`;
}
