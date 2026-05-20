import { useState, useRef, useCallback } from "react";
import { Link, useRoute, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload, Sparkles, FileText, Loader2, ArrowRight, Trash2, Mic, Square, CircleDot, Monitor, Camera, X, Brain, FolderPlus, Paperclip, History, CheckCircle2, Clock } from "lucide-react";
import { Page, PageHeader, Section, Panel, EmptyState } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { supabase } from "@/lib/supabase";
import { usePcmRecorder } from "@/hooks/usePcmRecorder";
import { useScreenCapture } from "@/hooks/use-screen-capture";
import { applyWordCorrections } from "@/lib/word-corrections";
import { isLikelyVisualReference } from "@/lib/visual-reference";
import type {
  ExperienceSession,
  ExperienceSeries,
  ExperienceAttachment,
  TranscriptSegment,
  ProposedLesson,
  LessonLearned,
  WordCorrection,
} from "@shared/schema";

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("nb-NO", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function ExperiencePage() {
  const [, sessionMatch] = useRoute<{ id: string }>("/erfaring/:id");
  // key={id} sikrer at SessionView remountes når brukeren bytter mellom
  // sesjoner — ellers ville recorder-hook'en holdt seg knyttet til forrige
  // sesjon-id og skrive transkripsjon til feil session.
  return sessionMatch ? (
    <ExperienceSessionView key={sessionMatch.id} id={Number(sessionMatch.id)} />
  ) : (
    <ExperienceList />
  );
}

function ExperienceList() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const { data, isLoading } = useQuery<{ sessions: ExperienceSession[] }>({
    queryKey: ["/api/experience/sessions"],
  });

  // Brukerens ord-rettelser anvendes også på opplastede filer slik at
  // resultatet er identisk med live-opptak og /mote-flyten.
  const { data: corrData } = useQuery<{ corrections: WordCorrection[] }>({
    queryKey: ["/api/word-corrections"],
  });
  const wordCorrections = corrData?.corrections ?? [];

  const { data: seriesData } = useQuery<{ series: ExperienceSeries[] }>({
    queryKey: ["/api/experience/series"],
  });
  const series = seriesData?.series ?? [];
  const [selectedSeriesId, setSelectedSeriesId] = useState<number | null>(null);

  const sessions = data?.sessions ?? [];

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      // 1. Opprett en tom session
      const created = await apiRequest("POST", "/api/experience/sessions", {
        title: file.name.replace(/\.[^.]+$/, ""),
        seriesId: selectedSeriesId,
      });
      const newSession: ExperienceSession = (await created.json()).session;

      // 2. Last opp lyd og transkriber via eksisterende /api/transcribe-file
      const formData = new FormData();
      formData.append("audio", file);
      const { data: { session } } = await supabase.auth.getSession();
      const transcribeResp = await fetch("/api/transcribe-file", {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
        body: formData,
      });
      if (!transcribeResp.ok) {
        throw new Error(`Transkripsjon feilet: ${transcribeResp.statusText}`);
      }
      const transcribed = await transcribeResp.json();
      const rawSegments: TranscriptSegment[] = transcribed.segments ?? [];
      const segments = rawSegments.map((s) => ({
        ...s,
        text: applyWordCorrections(s.text, wordCorrections),
      }));

      // 3. Lagre transkriptet på sessionen
      await apiRequest("PATCH", `/api/experience/sessions/${newSession.id}`, {
        transcript: segments,
        endedAt: new Date().toISOString(),
      });

      toast({ title: "Erfaringsmøte opprettet", description: `${segments.length} segmenter transkribert` });
      queryClient.invalidateQueries({ queryKey: ["/api/experience/sessions"] });
      navigate(`/erfaring/${newSession.id}`);
    } catch (err: any) {
      toast({ title: "Opplasting feilet", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Page>
      <PageHeader
        eyebrow="Erfaringsmøter"
        title="Lær av samtalene dine"
        lead="Last opp et opptak fra et erfaringsmøte — eller skriv inn et transkript direkte. AI ekstraherer strukturerte lærdommer som bygger opp hjernen din."
      />

      <Section title="Start nytt">
        <SeriesPicker
          series={series}
          selectedId={selectedSeriesId}
          onChange={setSelectedSeriesId}
        />
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="p-6 border-l-4 border-l-accent">
            <div className="flex items-start gap-4">
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-accent/15 text-accent shrink-0">
                <Mic className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-base mb-1">Ta opp live</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Sittegruppa er rundt bordet — start opptak og få sanntids-transkripsjon. AI ekstraherer lærdommer når dere er ferdig.
                </p>
                <StartLiveSessionButton seriesId={selectedSeriesId} />
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-start gap-4">
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary shrink-0">
                <Upload className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-base mb-1">Last opp lydfil</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Har du tatt opp møtet på telefon eller annen enhet? Last opp lydfilen (mp3, wav, m4a) så transkriberes den automatisk.
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*,video/mp4,video/mpeg"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUpload(file);
                    e.target.value = "";
                  }}
                />
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="w-full sm:w-auto"
                >
                  {uploading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Transkriberer…
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4 mr-2" />
                      Velg fil
                    </>
                  )}
                </Button>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-start gap-4">
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-muted text-muted-foreground shrink-0">
                <FileText className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-base mb-1">Skriv inn manuelt</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Har du allerede et notat eller transkript? Opprett en tom sesjon og lim inn teksten.
                </p>
                <CreateBlankButton seriesId={selectedSeriesId} />
              </div>
            </div>
          </Card>
        </div>

        <Link href="/hjernen">
          <a className="mt-3 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors">
            <Brain className="h-4 w-4" />
            Skal du laste opp dokumenter (PDF, Word, Excel) som AI skal lære av? Gå til Hjernen
            <ArrowRight className="h-3.5 w-3.5" />
          </a>
        </Link>
      </Section>

      <Section title="Tidligere erfaringsmøter">
        {isLoading ? (
          <div className="py-12 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : sessions.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="Ingen erfaringsmøter ennå"
            description="Last opp ditt første opptak ovenfor for å komme i gang."
          />
        ) : (
          <div className="grid gap-3">
            {sessions.map((session) => (
              <Link key={session.id} href={`/erfaring/${session.id}`}>
                <a className="block">
                  <Card className="p-4 hover-elevate">
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="font-medium truncate">
                          {session.title || `Erfaringsmøte ${session.id}`}
                        </div>
                        <div className="text-sm text-muted-foreground mt-0.5 flex items-center gap-3">
                          <span>{formatDate(String(session.startedAt))}</span>
                          {session.lessonsExtractedAt && (
                            <Badge variant="secondary" className="text-xs">
                              Lærdommer ekstrahert
                            </Badge>
                          )}
                        </div>
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </div>
                  </Card>
                </a>
              </Link>
            ))}
          </div>
        )}
      </Section>
    </Page>
  );
}

function CreateBlankButton({ seriesId }: { seriesId: number | null }) {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);

  const handle = async () => {
    setCreating(true);
    try {
      const resp = await apiRequest("POST", "/api/experience/sessions", { title: "", seriesId });
      const session: ExperienceSession = (await resp.json()).session;
      queryClient.invalidateQueries({ queryKey: ["/api/experience/sessions"] });
      navigate(`/erfaring/${session.id}`);
    } catch (err: any) {
      toast({ title: "Kunne ikke opprette", description: err.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  return (
    <Button onClick={handle} variant="outline" disabled={creating} className="w-full sm:w-auto">
      {creating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
      Opprett tom sesjon
    </Button>
  );
}

function StartLiveSessionButton({ seriesId }: { seriesId: number | null }) {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);

  const handle = async () => {
    setCreating(true);
    try {
      const resp = await apiRequest("POST", "/api/experience/sessions", {
        title: `Erfaringsmøte ${new Date().toLocaleDateString("nb-NO")}`,
        seriesId,
      });
      const session: ExperienceSession = (await resp.json()).session;
      queryClient.invalidateQueries({ queryKey: ["/api/experience/sessions"] });
      navigate(`/erfaring/${session.id}?autostart=1`);
    } catch (err: any) {
      toast({ title: "Kunne ikke starte", description: err.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  return (
    <Button onClick={handle} disabled={creating} className="w-full sm:w-auto">
      {creating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Mic className="h-4 w-4 mr-2" />}
      Start opptak nå
    </Button>
  );
}

function SeriesPicker({
  series,
  selectedId,
  onChange,
}: {
  series: ExperienceSeries[];
  selectedId: number | null;
  onChange: (id: number | null) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const resp = await apiRequest("POST", "/api/experience/series", {
        name: name.trim(),
        description: description.trim() || null,
      });
      const newSeries: ExperienceSeries = (await resp.json()).series;
      queryClient.invalidateQueries({ queryKey: ["/api/experience/series"] });
      onChange(newSeries.id);
      setName("");
      setDescription("");
      setCreating(false);
      toast({ title: "Serie opprettet" });
    } catch (err: any) {
      toast({ title: "Kunne ikke opprette serie", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-2 mb-4 flex-wrap">
      <span className="text-sm text-muted-foreground">Knytt til prosjekt/serie:</span>
      <Select
        value={selectedId === null ? "none" : String(selectedId)}
        onValueChange={(v) => onChange(v === "none" ? null : Number(v))}
      >
        <SelectTrigger className="w-[260px]">
          <SelectValue placeholder="Velg serie (valgfritt)" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Ingen serie (frittstående)</SelectItem>
          {series.map((s) => (
            <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="ghost" size="sm" onClick={() => setCreating(true)}>
        <FolderPlus className="h-4 w-4 mr-1" />
        Ny serie
      </Button>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ny erfaringsmøte-serie</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div>
              <Label htmlFor="series-name">Navn</Label>
              <Input
                id="series-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="F.eks. Bryggveien-prosjektet"
              />
            </div>
            <div>
              <Label htmlFor="series-desc">Beskrivelse (valgfritt)</Label>
              <Textarea
                id="series-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Kort om hva prosjektet handler om — gir AI bedre kontekst"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreating(false)}>Avbryt</Button>
            <Button onClick={handleCreate} disabled={!name.trim() || saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Opprett
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ExperienceSessionView({ id }: { id: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const { data, isLoading } = useQuery<{
    session: ExperienceSession;
    lessons: LessonLearned[];
    attachments: ExperienceAttachment[];
    openSeriesLessons: LessonLearned[];
  }>({
    queryKey: [`/api/experience/sessions/${id}`],
  });

  // Brukerens lagrede ord-rettelser — samme kilde som /mote bruker. Anvendes
  // på hvert nytt segment slik at transkriptet kommer ut med rette ord.
  const { data: corrData } = useQuery<{ corrections: WordCorrection[] }>({
    queryKey: ["/api/word-corrections"],
  });
  const wordCorrections = corrData?.corrections ?? [];

  // Liste av serier for visning av tilhørighet
  const { data: seriesData } = useQuery<{ series: ExperienceSeries[] }>({
    queryKey: ["/api/experience/series"],
  });
  const allSeries = seriesData?.series ?? [];

  const [titleEdit, setTitleEdit] = useState<string | null>(null);
  const [transcriptEdit, setTranscriptEdit] = useState<string | null>(null);
  const [proposals, setProposals] = useState<ProposedLesson[]>([]);
  const [extracting, setExtracting] = useState(false);

  // Live-transkriptet under opptak. Holdes lokalt så det ikke overskrives av
  // query-refetch midt i et opptak. Initialiseres fra serveren første gang
  // session lastes, deretter eier opptaks-løypa det.
  const [liveTranscript, setLiveTranscript] = useState<TranscriptSegment[] | null>(null);
  // Holder fast hva som er "in flight" mot serveren slik at vi kan unngå
  // tap hvis raske chunks overlapper.
  const liveTranscriptRef = useRef<TranscriptSegment[]>([]);

  const session = data?.session;
  const lessons = data?.lessons ?? [];
  const attachments = data?.attachments ?? [];
  const openSeriesLessons = data?.openSeriesLessons ?? [];
  const currentSeries = session?.seriesId
    ? allSeries.find((s) => s.id === session.seriesId)
    : undefined;

  // Sync første gang vi har data — etter det er liveTranscript autoritativt.
  if (liveTranscript === null && session?.transcript) {
    setLiveTranscript(session.transcript);
    liveTranscriptRef.current = session.transcript;
  } else if (liveTranscript === null && session) {
    // Session har tom transcript
    setLiveTranscript([]);
    liveTranscriptRef.current = [];
  }

  const displayedTranscript = liveTranscript ?? session?.transcript ?? [];
  const transcriptText = displayedTranscript
    .map((s) => `[${s.timestamp}] ${s.speaker}: ${s.text}`)
    .join("\n");

  const saveTitle = useMutation({
    mutationFn: async (title: string) => {
      const resp = await apiRequest("PATCH", `/api/experience/sessions/${id}`, { title });
      return resp.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/experience/sessions/${id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/experience/sessions"] });
      setTitleEdit(null);
    },
  });

  const saveTranscript = useMutation({
    mutationFn: async (rawText: string) => {
      // Konverter rå tekst til segmenter — én linje per segment med dummy timestamp/speaker
      const lines = rawText.split("\n").filter((l) => l.trim());
      const segments: TranscriptSegment[] = lines.map((line, idx) => ({
        id: `manual-${idx}`,
        timestamp: "00:00",
        speaker: "Ukjent",
        text: line.trim(),
      }));
      const resp = await apiRequest("PATCH", `/api/experience/sessions/${id}`, {
        transcript: segments,
      });
      return resp.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/experience/sessions/${id}`] });
      setTranscriptEdit(null);
      toast({ title: "Lagret" });
    },
  });

  const extractMutation = useMutation({
    mutationFn: async () => {
      const resp = await apiRequest("POST", `/api/experience/sessions/${id}/extract`, {});
      return resp.json() as Promise<{
        proposals: ProposedLesson[];
        contextUsed?: { attachmentsCount: number; openLessonsCount: number; priorKnowledgeCount: number };
      }>;
    },
    onSuccess: (data) => {
      setProposals(data.proposals);
      setExtracting(false);
      const ctx = data.contextUsed;
      const ctxParts: string[] = [];
      if (ctx?.attachmentsCount) ctxParts.push(`${ctx.attachmentsCount} vedlegg`);
      if (ctx?.openLessonsCount) ctxParts.push(`${ctx.openLessonsCount} tidligere lærdommer`);
      if (ctx?.priorKnowledgeCount) ctxParts.push(`${ctx.priorKnowledgeCount} hjerne-treff`);
      toast({
        title: `Fant ${data.proposals.length} lærdommer`,
        description: ctxParts.length
          ? `AI brukte ${ctxParts.join(", ")} som kontekst. Gjennomgå og godkjenn.`
          : "Gjennomgå og godkjenn de du vil lagre.",
      });
    },
    onError: (err: any) => {
      setExtracting(false);
      toast({ title: "Ekstraksjon feilet", description: err.message, variant: "destructive" });
    },
  });

  const saveLesson = useMutation({
    mutationFn: async (lesson: ProposedLesson) => {
      const resp = await apiRequest("POST", "/api/lessons", {
        sessionId: id,
        title: lesson.title,
        problem: lesson.problem,
        solution: lesson.solution,
        context: lesson.context,
        type: lesson.type,
        tags: lesson.tags,
        relatedScreenshotIds: lesson.relatedScreenshotIds,
        relatedDocumentIds: lesson.relatedDocumentIds,
      });
      return resp.json();
    },
    onSuccess: (_data, lesson) => {
      setProposals((prev) => prev.filter((p) => p.id !== lesson.id));
      queryClient.invalidateQueries({ queryKey: [`/api/experience/sessions/${id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/lessons"] });
      toast({ title: "Lærdom lagret i hjernen din" });
    },
  });

  const deleteSession = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/experience/sessions/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/experience/sessions"] });
      navigate("/erfaring");
    },
  });

  // Skjerm-fangst: brukeren kan dele skjerm under møtet og vi fanger frames
  // når noen refererer til det visuelle. Bare beskrivelsen lagres som
  // syntetisk transkript-segment — bildet kastes.
  const screen = useScreenCapture();
  const lastCaptureRef = useRef<number>(0);
  const CAPTURE_COOLDOWN_MS = 20_000;
  const [showSharePrompt, setShowSharePrompt] = useState(false);
  const sharePromptDismissedRef = useRef(false);
  const [isCapturingShot, setIsCapturingShot] = useState(false);

  const persistTranscript = useCallback(
    async (segments: TranscriptSegment[]) => {
      liveTranscriptRef.current = segments;
      setLiveTranscript(segments);
      try {
        await apiRequest("PATCH", `/api/experience/sessions/${id}`, { transcript: segments });
      } catch (err: any) {
        console.error("Lagring av transkript feilet:", err);
      }
    },
    [id],
  );

  // Fang nåværende skjermbilde, vision-tolk det, og legg inn som syntetisk
  // "Skjerm"-segment. Bildet sendes til server kun for analyse — ingenting
  // lagres. Brukes både av manuell knapp og auto-trigger.
  const captureAndDescribe = useCallback(
    async (reason: "manual" | "auto") => {
      if (!screen.active) {
        if (reason === "auto" && !sharePromptDismissedRef.current) {
          setShowSharePrompt(true);
        } else if (reason === "manual") {
          toast({
            title: "Ingen aktiv skjermdeling",
            description: "Trykk \"Del skjerm\" først for å fange skjermbilder.",
          });
        }
        return;
      }
      const now = Date.now();
      if (reason === "auto" && now - lastCaptureRef.current < CAPTURE_COOLDOWN_MS) {
        return; // throttled
      }
      lastCaptureRef.current = now;
      setIsCapturingShot(true);
      try {
        const frame = await screen.capture();
        if (!frame) {
          if (reason === "manual") {
            toast({ title: "Kunne ikke fange skjermbilde", variant: "destructive" });
          }
          return;
        }
        const recent = liveTranscriptRef.current
          .slice(-10)
          .map((s) => s.text)
          .join(" ");
        const resp = await apiRequest("POST", "/api/screenshots/analyze", {
          imageData: frame.dataUrl,
          mimeType: "image/jpeg",
          recentTranscript: recent,
        });
        const { description }: { description: string } = await resp.json();
        if (!description?.trim()) return;

        // Bruk timestamp fra siste segment hvis vi har det, ellers nå
        const last = liveTranscriptRef.current[liveTranscriptRef.current.length - 1];
        const visualSegment: TranscriptSegment = {
          id: `screen-${now}-${Math.random().toString(36).slice(2, 7)}`,
          timestamp: last?.timestamp || new Date().toISOString(),
          speaker: "Skjerm",
          text: description.trim(),
        };
        await persistTranscript([...liveTranscriptRef.current, visualSegment]);
        if (reason === "manual") {
          toast({ title: "Skjermbilde tolket", description: description.slice(0, 100) });
        }
      } catch (err: any) {
        console.error("Skjerm-fangst feilet:", err);
        if (reason === "manual") {
          toast({ title: "Vision-feil", description: err.message, variant: "destructive" });
        }
      } finally {
        setIsCapturingShot(false);
      }
    },
    [persistTranscript, screen, toast],
  );

  // Live-opptak: hver 28s mottar vi en WAV-chunk, sender den til
  // /api/transcribe, og appender returnerte segmenter til liveTranscript.
  // Etter append: sjekk om noe i de nye segmentene refererer til visuelt.
  const handleChunk = useCallback(
    async (wavBlob: Blob) => {
      try {
        const reader = new FileReader();
        const base64: string = await new Promise((resolve, reject) => {
          reader.onloadend = () => {
            const dataUrl = reader.result as string;
            resolve(dataUrl.split(",")[1] ?? "");
          };
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(wavBlob);
        });

        const resp = await apiRequest("POST", "/api/transcribe", {
          audio: base64,
          model: "openai",
          mimeType: "audio/wav",
        });
        const { segments: newSegments }: { segments: TranscriptSegment[] } = await resp.json();
        if (!newSegments?.length) return;

        const corrected = newSegments.map((s) => ({
          ...s,
          text: applyWordCorrections(s.text, wordCorrections),
        }));
        await persistTranscript([...liveTranscriptRef.current, ...corrected]);

        // Visuell-referanse-deteksjon: nøkkelord-match først (gratis), AI-
        // klassifierer som backup hvis ikke. Begge kan trigge captureAndDescribe.
        const combinedText = corrected.map((s) => s.text).join(" ");
        if (isLikelyVisualReference(combinedText)) {
          void captureAndDescribe("auto");
        } else if (combinedText.length > 20) {
          // Fire-and-forget AI-klassifierer
          (async () => {
            try {
              const checkResp = await apiRequest("POST", "/api/experience/visual-check", {
                text: combinedText,
              });
              const { visual }: { visual: boolean } = await checkResp.json();
              if (visual) void captureAndDescribe("auto");
            } catch {
              // klassifierer er best-effort
            }
          })();
        }
      } catch (err: any) {
        console.error("Chunk-feil:", err);
      }
    },
    [captureAndDescribe, persistTranscript, wordCorrections],
  );

  const recorder = usePcmRecorder({ onChunk: handleChunk });

  // Autostart fra ?autostart=1 (etter "Start opptak nå" på lista)
  const autostartedRef = useRef(false);
  if (!autostartedRef.current && typeof window !== "undefined" && session) {
    const params = new URLSearchParams(window.location.search);
    if (params.get("autostart") === "1" && !recorder.isRecording && !recorder.isStarting) {
      autostartedRef.current = true;
      // Fjern query-paramen så vi ikke restarter ved refresh
      window.history.replaceState(null, "", window.location.pathname);
      void recorder.start();
    }
  }

  const handleStopRecording = async () => {
    await recorder.stop();
    // Markér møtet som fullført. lessonsExtractedAt settes senere ved ekstraksjon.
    try {
      await apiRequest("PATCH", `/api/experience/sessions/${id}`, {
        endedAt: new Date().toISOString(),
        elapsedSeconds: recorder.elapsedSeconds,
      });
      queryClient.invalidateQueries({ queryKey: [`/api/experience/sessions/${id}`] });
    } catch (err: any) {
      console.error("Lagring av møteslutt feilet:", err);
    }
    toast({ title: "Opptak stoppet", description: "Klar for å ekstrahere lærdommer." });
  };

  if (isLoading) {
    return (
      <Page>
        <div className="py-12 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </Page>
    );
  }

  if (!session) {
    return (
      <Page>
        <EmptyState
          icon={Sparkles}
          title="Ikke funnet"
          description="Denne sesjonen finnes ikke."
        />
      </Page>
    );
  }

  return (
    <Page>
      <div className="flex items-start justify-between gap-4 mb-8">
        <div className="flex-1 min-w-0">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
            Erfaringsmøte · {formatDate(String(session.startedAt))}
          </div>
          {titleEdit !== null ? (
            <div className="flex gap-2">
              <Input
                value={titleEdit}
                onChange={(e) => setTitleEdit(e.target.value)}
                placeholder="Møtetittel"
                className="text-2xl font-semibold"
              />
              <Button onClick={() => saveTitle.mutate(titleEdit)} disabled={saveTitle.isPending}>
                Lagre
              </Button>
              <Button variant="ghost" onClick={() => setTitleEdit(null)}>
                Avbryt
              </Button>
            </div>
          ) : (
            <h1
              className="font-display text-3xl md:text-4xl font-semibold cursor-pointer hover:text-primary"
              onClick={() => setTitleEdit(session.title ?? "")}
              title="Klikk for å redigere"
            >
              {session.title || "Uten tittel"}
            </h1>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            if (confirm("Slette dette erfaringsmøtet og alle lærdommer fra det?")) {
              deleteSession.mutate();
            }
          }}
          aria-label="Slett"
        >
          <Trash2 className="h-4 w-4 text-muted-foreground" />
        </Button>
      </div>

      {currentSeries && (
        <div className="mb-6 flex items-center gap-2 text-sm">
          <Badge variant="secondary" className="font-normal">
            <FolderPlus className="h-3 w-3 mr-1" />
            {currentSeries.name}
          </Badge>
          {currentSeries.description && (
            <span className="text-xs text-muted-foreground italic">{currentSeries.description}</span>
          )}
        </div>
      )}

      {openSeriesLessons.length > 0 && (
        <Section
          title="Fra forrige gang"
          description="Åpne lærdommer fra tidligere sesjoner i samme serie. AI vil bruke disse som kontekst når dere ekstraherer nye lærdommer."
        >
          <div className="space-y-2">
            {openSeriesLessons.map((lesson) => (
              <Card key={lesson.id} className="p-3 border-l-2 border-l-amber-400 bg-amber-50/40 dark:bg-amber-900/10">
                <div className="flex items-start gap-2">
                  <Clock className="h-4 w-4 mt-0.5 text-amber-600 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{lesson.title}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                      <span className="font-medium">Læring:</span> {lesson.solution}
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[10px] uppercase">{lesson.status}</Badge>
                </div>
              </Card>
            ))}
          </div>
        </Section>
      )}

      <Section
        title="Vedlegg"
        description="Last opp dokumenter (PDF, Word, Excel) som diskuteres i møtet. AI får tekst-innholdet som kontekst ved ekstraksjon, og dokumentet blir søkbart i hjernen."
        actions={<AttachmentUploadButton sessionId={id} />}
      >
        {attachments.length === 0 ? (
          <Panel className="p-4 text-sm text-muted-foreground">
            Ingen vedlegg ennå. Trykk «Last opp» for å legge til.
          </Panel>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {attachments.map((att) => (
              <AttachmentCard key={att.id} attachment={att} sessionId={id} />
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Transkript"
        actions={
          !recorder.isRecording && !recorder.isStarting ? (
            <Button onClick={() => recorder.start()} size="sm">
              <Mic className="h-4 w-4 mr-2" />
              {transcriptText ? "Fortsett opptak" : "Start opptak"}
            </Button>
          ) : null
        }
      >
        {recorder.error && (
          <Card className="p-3 mb-3 border-destructive bg-destructive/5 text-sm text-destructive">
            {recorder.error}
            <Button variant="ghost" size="sm" onClick={recorder.clearError} className="ml-2 h-6 px-2">
              OK
            </Button>
          </Card>
        )}

        {(recorder.isRecording || recorder.isStarting) && (
          <Panel className="p-4 mb-3 bg-accent/5 border-accent/20">
            <div className="flex items-center gap-4">
              <div className="grid h-10 w-10 place-items-center rounded-full bg-destructive text-destructive-foreground animate-pulse">
                <CircleDot className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">
                  {recorder.isStarting ? "Starter…" : "Tar opp"}
                </div>
                <div className="text-2xl font-mono tabular-nums">
                  {formatElapsed(recorder.elapsedSeconds)}
                </div>
              </div>
              <div className="hidden sm:flex items-center gap-0.5 h-10">
                {recorder.audioLevelBars.map((level, idx) => (
                  <div
                    key={idx}
                    className="w-1 bg-accent rounded-full transition-all"
                    style={{ height: `${Math.max(4, level * 40)}px` }}
                  />
                ))}
              </div>
              {screen.active ? (
                <Button
                  onClick={() => captureAndDescribe("manual")}
                  variant="outline"
                  size="sm"
                  disabled={isCapturingShot}
                  aria-label="Ta skjermbilde"
                  title="Ta skjermbilde"
                >
                  {isCapturingShot ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Camera className="h-4 w-4" />
                  )}
                </Button>
              ) : (
                <Button
                  onClick={() => {
                    sharePromptDismissedRef.current = false;
                    setShowSharePrompt(false);
                    void screen.start();
                  }}
                  variant="outline"
                  size="sm"
                  aria-label="Del skjerm"
                  title="Del skjerm for å fange visuell kontekst"
                >
                  <Monitor className="h-4 w-4" />
                </Button>
              )}
              <Button
                onClick={handleStopRecording}
                variant="destructive"
                disabled={recorder.isStarting}
              >
                <Square className="h-4 w-4 mr-2" />
                Stopp opptak
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              {screen.active
                ? "AI fanger skjermbilder automatisk når noen refererer til det visuelle. Bilder kastes etter analyse — kun beskrivelser lagres."
                : "Transkripsjon kommer inn hvert 28. sekund. Trykk skjerm-ikonet for å dele skjerm hvis dere viser noe visuelt."}
            </p>

            {showSharePrompt && !screen.active && (
              <div className="mt-3 flex items-start gap-3 p-3 rounded-lg bg-primary/10 border border-primary/20 text-sm">
                <Monitor className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                <div className="flex-1">
                  <div className="font-medium">Det høres ut som noen viser noe</div>
                  <div className="text-muted-foreground text-xs mt-0.5">
                    Del skjerm slik at AI kan fange den visuelle konteksten og lage bedre lærdommer.
                  </div>
                </div>
                <Button
                  onClick={() => {
                    setShowSharePrompt(false);
                    void screen.start();
                  }}
                  size="sm"
                >
                  Del skjerm
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setShowSharePrompt(false);
                    sharePromptDismissedRef.current = true;
                  }}
                  aria-label="Lukk"
                  className="h-8 w-8"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}
          </Panel>
        )}

        {transcriptEdit !== null ? (
          <Panel>
            <Textarea
              value={transcriptEdit}
              onChange={(e) => setTranscriptEdit(e.target.value)}
              rows={14}
              className="font-mono text-sm"
              placeholder="Skriv eller lim inn transkriptet her. Én linje per ytring."
            />
            <div className="flex gap-2 mt-3">
              <Button onClick={() => saveTranscript.mutate(transcriptEdit)} disabled={saveTranscript.isPending}>
                Lagre
              </Button>
              <Button variant="ghost" onClick={() => setTranscriptEdit(null)}>
                Avbryt
              </Button>
            </div>
          </Panel>
        ) : transcriptText ? (
          <Panel>
            <div className="text-sm max-h-96 overflow-y-auto p-4 space-y-2">
              {displayedTranscript.map((seg, idx) => {
                const isScreen = seg.speaker === "Skjerm";
                return (
                  <div
                    key={seg.id ?? idx}
                    className={
                      isScreen
                        ? "flex gap-2 p-2 rounded-md bg-primary/5 border border-primary/15 text-foreground"
                        : "flex gap-2 text-muted-foreground"
                    }
                  >
                    {isScreen && <Monitor className="h-4 w-4 mt-0.5 shrink-0 text-primary" />}
                    <div className="min-w-0 flex-1">
                      <span className={isScreen ? "font-medium text-primary text-xs uppercase tracking-wider" : "font-mono text-xs"}>
                        {isScreen ? "Skjerm" : seg.speaker || "—"}
                      </span>
                      <span className="ml-2">{seg.text}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            {!recorder.isRecording && (
              <div className="px-4 pb-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setTranscriptEdit(transcriptText)}
                >
                  Redigér transkript
                </Button>
              </div>
            )}
          </Panel>
        ) : !recorder.isRecording && !recorder.isStarting ? (
          <EmptyState
            icon={FileText}
            title="Ingen transkript ennå"
            description="Trykk «Start opptak» over, last opp et lydopptak fra lista, eller lim inn teksten manuelt."
            actions={
              <Button onClick={() => setTranscriptEdit("")} variant="outline">
                Lim inn transkript manuelt
              </Button>
            }
          />
        ) : null}
      </Section>

      {transcriptText && !recorder.isRecording && !recorder.isStarting && (
        <Section title="Lærdommer">
          {lessons.length > 0 && (
            <div className="mb-4 space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground">Lagret i hjernen din</h3>
              {lessons.map((lesson) => (
                <Card key={lesson.id} className="p-4 bg-muted/30">
                  <div className="font-medium">{lesson.title}</div>
                  <div className="text-sm text-muted-foreground mt-1">{lesson.solution}</div>
                </Card>
              ))}
            </div>
          )}

          {proposals.length === 0 ? (
            <Button
              onClick={() => {
                setExtracting(true);
                extractMutation.mutate();
              }}
              disabled={extracting}
            >
              {extracting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  AI leser gjennom møtet…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  {lessons.length > 0 ? "Ekstraher flere lærdommer" : "Ekstraher lærdommer"}
                </>
              )}
            </Button>
          ) : (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Forslag — godkjenn dem du vil lagre</h3>
              {proposals.map((proposal) => (
                <ProposalCard
                  key={proposal.id}
                  proposal={proposal}
                  relatedLesson={
                    proposal.relatesToLessonId
                      ? openSeriesLessons.find((l) => l.id === proposal.relatesToLessonId)
                      : undefined
                  }
                  onChange={(updated) =>
                    setProposals((prev) => prev.map((p) => (p.id === proposal.id ? updated : p)))
                  }
                  onApprove={() => saveLesson.mutate(proposal)}
                  onReject={() =>
                    setProposals((prev) => prev.filter((p) => p.id !== proposal.id))
                  }
                  saving={saveLesson.isPending}
                />
              ))}
            </div>
          )}
        </Section>
      )}
    </Page>
  );
}

function ProposalCard({
  proposal,
  relatedLesson,
  onChange,
  onApprove,
  onReject,
  saving,
}: {
  proposal: ProposedLesson;
  relatedLesson?: LessonLearned;
  onChange: (updated: ProposedLesson) => void;
  onApprove: () => void;
  onReject: () => void;
  saving: boolean;
}) {
  return (
    <Card className="p-4 border-l-4 border-l-primary">
      {relatedLesson && (
        <div className="mb-3 p-2 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 text-xs flex items-start gap-2">
          <History className="h-3.5 w-3.5 mt-0.5 text-amber-700 dark:text-amber-400 shrink-0" />
          <div className="flex-1">
            <span className="font-medium">Oppfølging til:</span> «{relatedLesson.title}»
            <span className="ml-1 text-muted-foreground">({relatedLesson.status})</span>
          </div>
        </div>
      )}
      <Input
        value={proposal.title}
        onChange={(e) => onChange({ ...proposal, title: e.target.value })}
        className="font-semibold mb-3"
        placeholder="Tittel"
      />
      <div className="grid gap-3">
        <Textarea
          value={proposal.problem}
          onChange={(e) => onChange({ ...proposal, problem: e.target.value })}
          placeholder="Problem / observasjon"
          rows={2}
        />
        <Textarea
          value={proposal.solution}
          onChange={(e) => onChange({ ...proposal, solution: e.target.value })}
          placeholder="Lærdom / anbefaling"
          rows={2}
        />
        <Textarea
          value={proposal.context ?? ""}
          onChange={(e) => onChange({ ...proposal, context: e.target.value })}
          placeholder="Kontekst (valgfritt)"
          rows={1}
        />
        <div className="flex items-center gap-2">
          <Badge variant={proposal.type === "thematic" ? "default" : "secondary"} className="text-xs">
            {proposal.type === "thematic" ? "Tematisk" : "Kort"}
          </Badge>
          {proposal.tags.map((tag) => (
            <Badge key={tag} variant="outline" className="text-xs">
              {tag}
            </Badge>
          ))}
        </div>
      </div>
      <div className="flex gap-2 mt-4">
        <Button onClick={onApprove} disabled={saving} size="sm">
          {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
          Godkjenn og lagre
        </Button>
        <Button onClick={onReject} variant="ghost" size="sm">
          Avvis
        </Button>
      </div>
    </Card>
  );
}

function AttachmentUploadButton({ sessionId }: { sessionId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handle = async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`/api/experience/sessions/${sessionId}/attachments`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
        body: formData,
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || "Opplasting feilet");
      }
      queryClient.invalidateQueries({ queryKey: [`/api/experience/sessions/${sessionId}`] });
      toast({ title: "Vedlegg lagt til", description: file.name });
    } catch (err: any) {
      toast({ title: "Opplasting feilet", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx,.xlsx,.xls,.txt,image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handle(f);
          e.target.value = "";
        }}
      />
      <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()} disabled={uploading}>
        {uploading ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Laster opp…
          </>
        ) : (
          <>
            <Paperclip className="h-4 w-4 mr-2" />
            Last opp vedlegg
          </>
        )}
      </Button>
    </>
  );
}

function AttachmentCard({ attachment, sessionId }: { attachment: ExperienceAttachment; sessionId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm(`Slette vedlegget "${attachment.filename}"?`)) return;
    setDeleting(true);
    try {
      await apiRequest("DELETE", `/api/experience/attachments/${attachment.id}`);
      queryClient.invalidateQueries({ queryKey: [`/api/experience/sessions/${sessionId}`] });
      toast({ title: "Vedlegg slettet" });
    } catch (err: any) {
      toast({ title: "Sletting feilet", description: err.message, variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  const preview = attachment.extractedText.slice(0, 140);

  return (
    <Card className="p-3 flex items-start gap-3">
      <FileText className="h-5 w-5 mt-0.5 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate">{attachment.filename}</div>
        <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{preview}…</div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={handleDelete}
        disabled={deleting}
        className="h-7 w-7 shrink-0"
        aria-label="Slett vedlegg"
      >
        {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
      </Button>
    </Card>
  );
}
