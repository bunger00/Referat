import { useState, useRef, useCallback, useEffect } from "react";
import { Link, useRoute, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload, Sparkles, FileText, Loader2, ArrowRight, Trash2, Mic, Square, CircleDot, Monitor, Camera, X, Brain, FolderPlus, Paperclip, History, CheckCircle2, Clock, QrCode, Smartphone } from "lucide-react";
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

  const isAudioFile = (file: File): boolean => {
    if (file.type.startsWith("audio/") || file.type.startsWith("video/")) return true;
    return /\.(mp3|wav|m4a|aac|ogg|flac|webm|mp4|mpeg)$/i.test(file.name);
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      // 1. Opprett en tom sesjon
      const created = await apiRequest("POST", "/api/experience/sessions", {
        title: file.name.replace(/\.[^.]+$/, ""),
        seriesId: selectedSeriesId,
      });
      const newSession: ExperienceSession = (await created.json()).session;
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const authHeader = { Authorization: `Bearer ${authSession?.access_token ?? ""}` };

      if (isAudioFile(file)) {
        // 2a. Lyd: transkriber via /api/transcribe-file og lagre segmentene
        const formData = new FormData();
        formData.append("audio", file);
        const transcribeResp = await fetch("/api/transcribe-file", {
          method: "POST",
          headers: authHeader,
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
        await apiRequest("PATCH", `/api/experience/sessions/${newSession.id}`, {
          transcript: segments,
          endedAt: new Date().toISOString(),
        });
        toast({
          title: "Erfaringsmøte opprettet",
          description: `${segments.length} segmenter transkribert fra ${file.name}`,
        });
      } else {
        // 2b. Dokument: legg ved sesjonen og embed til hjernen
        const formData = new FormData();
        formData.append("file", file);
        const uploadResp = await fetch(
          `/api/experience/sessions/${newSession.id}/attachments`,
          { method: "POST", headers: authHeader, body: formData },
        );
        if (!uploadResp.ok) {
          const err = await uploadResp.json().catch(() => ({}));
          throw new Error(err.error || "Opplasting feilet");
        }
        toast({
          title: "Dokument lagt til som vedlegg",
          description: `${file.name} — ekstrahert tekst er klar som kontekst for AI`,
        });
      }

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
                <h3 className="font-semibold text-base mb-1">Ny økt</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Opprett en økt — fyll inn tema og vedlegg, så starter du opptak når dere er klare. Du kan også legge til informasjon underveis.
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
                <h3 className="font-semibold text-base mb-1">Last opp filer</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Lyd (mp3/wav/m4a) transkriberes automatisk. Dokumenter (PDF/Word/Excel) blir vedlegg til sesjonen og brukes som kontekst når AI ekstraherer lærdommer.
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*,video/mp4,video/mpeg,.pdf,.docx,.xlsx,.xls,.txt,image/*,.heic,.heif"
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
            Vil du legge til kunnskap som ikke er knyttet til et bestemt møte? Gå til Hjernen
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
              <SessionListRow key={session.id} session={session} />
            ))}
          </div>
        )}
      </Section>
    </Page>
  );
}

function SessionListRow({ session }: { session: ExperienceSession }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Slette «${session.title || `Erfaringsmøte ${session.id}`}»? Alle lærdommer fra denne sesjonen slettes også.`)) return;
    setDeleting(true);
    try {
      await apiRequest("DELETE", `/api/experience/sessions/${session.id}`);
      queryClient.invalidateQueries({ queryKey: ["/api/experience/sessions"] });
      toast({ title: "Sesjon slettet" });
    } catch (err: any) {
      toast({ title: "Kunne ikke slette", description: err.message, variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Link href={`/erfaring/${session.id}`}>
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
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleDelete}
                disabled={deleting}
                aria-label="Slett sesjon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </Button>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>
        </Card>
      </a>
    </Link>
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
      // Naviger til sesjonen UTEN auto-start — brukeren fyller inn tema/vedlegg
      // og trykker selv "Start opptak" når de er klare.
      navigate(`/erfaring/${session.id}`);
    } catch (err: any) {
      toast({ title: "Kunne ikke opprette", description: err.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  return (
    <Button onClick={handle} disabled={creating} className="w-full sm:w-auto">
      {creating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Mic className="h-4 w-4 mr-2" />}
      Forbered ny økt
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

  const persistProposal = async (lesson: ProposedLesson) => {
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
  };

  const saveLesson = useMutation({
    mutationFn: persistProposal,
    onSuccess: (_data, lesson) => {
      setProposals((prev) => prev.filter((p) => p.id !== lesson.id));
      queryClient.invalidateQueries({ queryKey: [`/api/experience/sessions/${id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/lessons"] });
      toast({ title: "Lærdom lagret i hjernen din" });
    },
  });

  const [bulkApproving, setBulkApproving] = useState(false);
  const approveAll = async () => {
    if (bulkApproving || proposals.length === 0) return;
    setBulkApproving(true);
    const toSave = [...proposals];
    let saved = 0;
    let failed = 0;
    // Sekvensiell lagring slik at vi får tydelig feedback ved feil og ikke
    // overbelaster serveren med 20 parallelle embedding-kall.
    for (const lesson of toSave) {
      try {
        await persistProposal(lesson);
        saved++;
        setProposals((prev) => prev.filter((p) => p.id !== lesson.id));
      } catch (err) {
        failed++;
      }
    }
    queryClient.invalidateQueries({ queryKey: [`/api/experience/sessions/${id}`] });
    queryClient.invalidateQueries({ queryKey: ["/api/lessons"] });
    setBulkApproving(false);
    toast({
      title: failed === 0 ? `${saved} lærdommer lagret` : `${saved} lagret, ${failed} feilet`,
      description: failed === 0 ? "Alle lærdommer er nå i hjernen din." : "Prøv å godkjenne de gjenstående en og en.",
      variant: failed === 0 ? "default" : "destructive",
    });
  };

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

        // Bygg smartere Whisper-prompt: tema + serie + vedlegg-titler + de
        // siste 2 transkript-segmentene. Whisper har 224-token grense, så vi
        // bygger en kompakt streng og truncerer.
        const recent = liveTranscriptRef.current
          .slice(-2)
          .map((s) => s.text)
          .filter(Boolean)
          .join(" ");
        const promptParts = [
          session?.topic,
          currentSeries?.description,
          attachments.map((a) => a.filename.replace(/\.[^.]+$/, "")).join(", "),
          recent,
        ].filter((s): s is string => !!s?.trim());
        // ~200 tegn lim opp til 224-token grensen (~4 chars/token)
        const transcriptionPrompt = promptParts.length > 0
          ? promptParts.join(". ").slice(0, 800)
          : undefined;

        const lang = (session?.language as "no" | "en" | "auto") ?? "no";

        const resp = await apiRequest("POST", "/api/transcribe", {
          audio: base64,
          model: "openai",
          mimeType: "audio/wav",
          language: lang,
          ...(transcriptionPrompt ? { prompt: transcriptionPrompt } : {}),
          // AI-renskriving: fiks fagord, oversett ved behov, dropp hallusinasjoner.
          // Output-språk er alltid norsk for konsistens i transkriptet.
          cleanup: {
            topic: session?.topic ?? undefined,
            targetLanguage: "no",
          },
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
    [captureAndDescribe, persistTranscript, wordCorrections, session?.topic, session?.language, currentSeries?.description, attachments],
  );

  const recorder = usePcmRecorder({ onChunk: handleChunk });

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
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0 flex items-baseline gap-3 flex-wrap">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium shrink-0">
            Erfaringsmøte · {formatDate(String(session.startedAt))}
          </span>
          {titleEdit !== null ? (
            <div className="flex gap-2 flex-1">
              <Input
                value={titleEdit}
                onChange={(e) => setTitleEdit(e.target.value)}
                placeholder="Møtetittel"
                className="text-lg font-semibold"
                autoFocus
              />
              <Button size="sm" onClick={() => saveTitle.mutate(titleEdit)} disabled={saveTitle.isPending}>
                Lagre
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setTitleEdit(null)}>
                Avbryt
              </Button>
            </div>
          ) : (
            <h1
              className="font-display text-xl md:text-2xl font-semibold cursor-pointer hover:text-primary truncate"
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
          className="h-8 w-8 shrink-0"
        >
          <Trash2 className="h-4 w-4 text-muted-foreground" />
        </Button>
      </div>

      <SessionMetaBar
        sessionId={id}
        currentSeries={currentSeries}
        topic={session.topic}
        language={session.language as "no" | "en" | "auto"}
        attachments={attachments}
      />


      {openSeriesLessons.length > 0 && (
        <details className="mb-4 group">
          <summary className="cursor-pointer flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground py-1.5">
            <Clock className="h-3.5 w-3.5 text-amber-600" />
            <span className="font-medium">Fra forrige gang ({openSeriesLessons.length})</span>
            <ArrowRight className="h-3 w-3 transition-transform group-open:rotate-90 ml-auto" />
          </summary>
          <div className="space-y-1.5 mt-2 ml-5">
            {openSeriesLessons.map((lesson) => (
              <div key={lesson.id} className="text-sm border-l-2 border-amber-400 pl-3 py-1">
                <div className="font-medium">{lesson.title}</div>
                <div className="text-xs text-muted-foreground line-clamp-2">{lesson.solution}</div>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Vedlegg-strip — bare synlig hvis vedlegg eksisterer; opplasting skjer fra meta-baren */}
      {attachments.length > 0 && (
        <details className="mb-4">
          <summary className="cursor-pointer flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground py-1.5">
            <Paperclip className="h-3.5 w-3.5" />
            <span className="font-medium">{attachments.length} vedlegg</span>
            <ArrowRight className="h-3 w-3 transition-transform [details[open]_&]:rotate-90 ml-auto" />
          </summary>
          <div className="grid gap-2 sm:grid-cols-2 mt-2">
            {attachments.map((att) => (
              <AttachmentCard key={att.id} attachment={att} sessionId={id} />
            ))}
          </div>
        </details>
      )}

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
          <Panel className="overflow-hidden">
            <TranscriptView
              segments={displayedTranscript}
              autoScroll={recorder.isRecording}
              onCorrectionSaved={(original, corrected) => {
                // Anvend korreksjonen retroaktivt på live-transkriptet i denne sesjonen
                const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ +/g, "\\s+");
                const regex = new RegExp(`\\b${escaped}\\b`, "gi");
                const updated = liveTranscriptRef.current.map((s) => ({
                  ...s,
                  text: s.text.replace(regex, corrected),
                }));
                void persistTranscript(updated);
              }}
            />
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
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h3 className="text-sm font-semibold">
                  {proposals.length} forslag — godkjenn dem du vil lagre
                </h3>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setProposals([])}
                    disabled={bulkApproving}
                  >
                    Avvis alle
                  </Button>
                  <Button
                    size="sm"
                    onClick={approveAll}
                    disabled={bulkApproving || proposals.length === 0}
                  >
                    {bulkApproving ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Lagrer…
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                        Godkjenn alle ({proposals.length})
                      </>
                    )}
                  </Button>
                </div>
              </div>
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
        accept=".pdf,.docx,.xlsx,.xls,.txt,image/*,.heic,.heif"
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

function SessionMetaBar({
  sessionId,
  currentSeries,
  topic,
  language,
  attachments,
}: {
  sessionId: number;
  currentSeries: ExperienceSeries | undefined;
  topic: string | null;
  language: "no" | "en" | "auto";
  attachments: ExperienceAttachment[];
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [topicEdit, setTopicEdit] = useState(topic ?? "");
  const [langEdit, setLangEdit] = useState<"no" | "en" | "auto">(language ?? "no");
  const [saving, setSaving] = useState(false);
  const lastSavedRef = useRef({ topic: topic ?? "", language: language ?? "no" });

  const save = async (next?: { topic?: string; language?: "no" | "en" | "auto" }) => {
    const trimmedTopic = (next?.topic ?? topicEdit).trim();
    const lang = next?.language ?? langEdit;
    if (
      trimmedTopic === lastSavedRef.current.topic &&
      lang === lastSavedRef.current.language
    ) {
      return;
    }
    setSaving(true);
    try {
      await apiRequest("PATCH", `/api/experience/sessions/${sessionId}`, {
        topic: trimmedTopic || null,
        language: lang,
      });
      lastSavedRef.current = { topic: trimmedTopic, language: lang };
      queryClient.invalidateQueries({ queryKey: [`/api/experience/sessions/${sessionId}`] });
    } catch (err: any) {
      toast({ title: "Kunne ikke lagre", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-4 flex items-center gap-2 flex-wrap">
      {currentSeries && (
        <Badge variant="secondary" className="font-normal shrink-0" title={currentSeries.description ?? undefined}>
          <FolderPlus className="h-3 w-3 mr-1" />
          {currentSeries.name}
        </Badge>
      )}
      <div className="flex items-center gap-1.5 flex-1 min-w-[180px] max-w-xl">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium shrink-0">
          Tema
        </span>
        <Input
          value={topicEdit}
          onChange={(e) => setTopicEdit(e.target.value)}
          onBlur={() => save()}
          placeholder={currentSeries?.description || "f.eks. taktplanlegging, lean construction"}
          className="h-8 text-sm flex-1"
        />
      </div>
      <Select
        value={langEdit}
        onValueChange={(v) => {
          const nextLang = v as "no" | "en" | "auto";
          setLangEdit(nextLang);
          void save({ language: nextLang });
        }}
      >
        <SelectTrigger className="h-8 w-[120px] shrink-0 text-sm" aria-label="Lyd-språk">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="no">Norsk</SelectItem>
          <SelectItem value="en">Engelsk</SelectItem>
          <SelectItem value="auto">Auto-detekt</SelectItem>
        </SelectContent>
      </Select>
      <CameraCaptureButton sessionId={sessionId} />
      <QrPairButton sessionId={sessionId} />
      <AttachmentUploadButton sessionId={sessionId} />
      {attachments.length > 0 && (
        <span className="text-xs text-muted-foreground">
          {attachments.length} vedlegg
        </span>
      )}
      {saving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />}
    </div>
  );
}

function TranscriptView({
  segments,
  autoScroll,
  onCorrectionSaved,
}: {
  segments: TranscriptSegment[];
  autoScroll: boolean;
  onCorrectionSaved?: (original: string, corrected: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{ text: string; x: number; y: number } | null>(null);
  const [editingCorrection, setEditingCorrection] = useState<{ original: string; corrected: string } | null>(null);

  useEffect(() => {
    if (!autoScroll || !scrollRef.current) return;
    scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [autoScroll, segments.length]);

  // Lytt etter tekst-markering inni transkriptet. Når brukeren slipper musa
  // og det er en ikke-tom selection som ligger inni containeren, vis en
  // flytende "Rett ord"-knapp ved markeringen.
  useEffect(() => {
    const handler = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? "";
      if (!text || !sel || sel.rangeCount === 0) {
        setSelection(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const node = range.commonAncestorContainer;
      // Sjekk om selection ligger inni vår container
      const container = containerRef.current;
      if (!container || !container.contains(node.nodeType === 3 ? node.parentNode : node)) {
        setSelection(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      setSelection({
        text,
        x: rect.left + rect.width / 2 - containerRect.left,
        y: rect.top - containerRect.top - 8,
      });
    };
    document.addEventListener("mouseup", handler);
    document.addEventListener("touchend", handler);
    return () => {
      document.removeEventListener("mouseup", handler);
      document.removeEventListener("touchend", handler);
    };
  }, []);

  if (segments.length === 0) return null;

  return (
    <div ref={containerRef} className="relative">
      {selection && (
        <button
          className="absolute z-10 -translate-x-1/2 -translate-y-full bg-primary text-primary-foreground text-xs font-medium px-2.5 py-1.5 rounded-md shadow-lg hover:bg-primary/90 flex items-center gap-1.5"
          style={{ left: selection.x, top: selection.y }}
          onMouseDown={(e) => {
            // Prevent selection from clearing before we read it
            e.preventDefault();
          }}
          onClick={() => {
            setEditingCorrection({ original: selection.text, corrected: selection.text });
            setSelection(null);
            window.getSelection()?.removeAllRanges();
          }}
        >
          <FileText className="h-3 w-3" />
          Rett ord
        </button>
      )}
    <div
      ref={scrollRef}
      className="max-h-[60vh] overflow-y-auto px-5 py-4 space-y-3 bg-card/30"
    >
      {segments.map((seg, idx) => {
        const isScreen = seg.speaker === "Skjerm";
        const speaker = seg.speaker?.trim();
        // Format timestamp: try to extract HH:MM:SS or HH:MM from ISO-format
        let displayTime = "";
        if (seg.timestamp) {
          try {
            const d = new Date(seg.timestamp);
            if (!isNaN(d.getTime())) {
              displayTime = d.toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" });
            } else if (typeof seg.timestamp === "string" && seg.timestamp.length < 12) {
              displayTime = seg.timestamp;
            }
          } catch { /* keep empty */ }
        }

        if (isScreen) {
          return (
            <div
              key={seg.id ?? idx}
              className="flex gap-3 rounded-lg bg-primary/8 border border-primary/20 px-4 py-3"
            >
              <div className="grid h-8 w-8 place-items-center rounded-md bg-primary/15 text-primary shrink-0">
                <Monitor className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-xs font-semibold uppercase tracking-wider text-primary">Skjerm</span>
                  {displayTime && <span className="text-[11px] text-muted-foreground">{displayTime}</span>}
                </div>
                <p className="text-[15px] leading-relaxed text-foreground">{seg.text}</p>
              </div>
            </div>
          );
        }

        return (
          <div key={seg.id ?? idx} className="flex gap-3 group">
            <div className="text-[11px] text-muted-foreground/60 font-mono tabular-nums pt-1.5 w-12 shrink-0">
              {displayTime}
            </div>
            <div className="min-w-0 flex-1">
              {speaker && (
                <div className="text-xs font-medium text-muted-foreground mb-0.5">
                  {speaker}
                </div>
              )}
              <p className="text-[15px] leading-relaxed text-foreground">{seg.text}</p>
            </div>
          </div>
        );
      })}
    </div>
    <CorrectionDialog
      value={editingCorrection}
      onClose={() => setEditingCorrection(null)}
      onSaved={(original, corrected) => {
        setEditingCorrection(null);
        onCorrectionSaved?.(original, corrected);
      }}
    />
    </div>
  );
}

function CorrectionDialog({
  value,
  onClose,
  onSaved,
}: {
  value: { original: string; corrected: string } | null;
  onClose: () => void;
  onSaved: (original: string, corrected: string) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [original, setOriginal] = useState("");
  const [corrected, setCorrected] = useState("");
  const [saving, setSaving] = useState(false);

  // Synk fra prop ved åpning
  useEffect(() => {
    if (value) {
      setOriginal(value.original);
      setCorrected(value.corrected);
    }
  }, [value]);

  const handleSave = async () => {
    const o = original.trim();
    const c = corrected.trim();
    if (!o || !c || o === c) {
      toast({ title: "Skriv inn ulik original og korrigert tekst" });
      return;
    }
    setSaving(true);
    try {
      await apiRequest("POST", "/api/word-corrections", { original: o, corrected: c });
      queryClient.invalidateQueries({ queryKey: ["/api/word-corrections"] });
      toast({
        title: "Lærdom lagret",
        description: `«${o}» → «${c}» vil bli anvendt på alle fremtidige transkripter`,
      });
      onSaved(o, c);
    } catch (err: any) {
      toast({ title: "Kunne ikke lagre", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={value !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Lær AI rett tolkning av ordet</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="correction-original">Slik ble det transkribert</Label>
            <Input
              id="correction-original"
              value={original}
              onChange={(e) => setOriginal(e.target.value)}
              className="font-mono"
            />
          </div>
          <div>
            <Label htmlFor="correction-corrected">Slik skal det være</Label>
            <Input
              id="correction-corrected"
              value={corrected}
              onChange={(e) => setCorrected(e.target.value)}
              className="font-mono"
              autoFocus
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Denne korreksjonen lagres permanent og anvendes automatisk på fremtidige opptak. Du kan se og slette alle korreksjoner i Kunnskapsbasen.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Avbryt</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Lagre
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CameraCaptureButton({ sessionId }: { sessionId: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label="Ta bilde med kamera"
        title="Ta bilde (bruker iPhone via Continuity Camera hvis tilgjengelig)"
        className="h-8"
      >
        <Camera className="h-4 w-4" />
      </Button>
      {open && <CameraCaptureDialog sessionId={sessionId} onClose={() => setOpen(false)} />}
    </>
  );
}

function CameraCaptureDialog({ sessionId, onClose }: { sessionId: number; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [captured, setCaptured] = useState<{ blob: Blob; dataUrl: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startStream = useCallback(async (selectedId?: string) => {
    setError(null);
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      const constraints: MediaStreamConstraints = {
        video: selectedId
          ? { deviceId: { exact: selectedId } }
          : { facingMode: { ideal: "environment" } },
        audio: false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => { /* ignore autoplay error */ });
      }
      // Etter at vi har fått en stream, kan vi enumerere devices med labels
      const all = await navigator.mediaDevices.enumerateDevices();
      const videoIns = all.filter((d) => d.kind === "videoinput");
      setDevices(videoIns);
      const current = stream.getVideoTracks()[0]?.getSettings().deviceId;
      if (current) setDeviceId(current);
    } catch (err: any) {
      setError(err?.message || "Kunne ikke åpne kamera. Sjekk at appen har kamera-tillatelse.");
    }
  }, []);

  useEffect(() => {
    void startStream();
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [startStream]);

  const switchDevice = (id: string) => {
    setDeviceId(id);
    void startStream(id);
  };

  const capture = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
        setCaptured({ blob, dataUrl });
      },
      "image/jpeg",
      0.9,
    );
  };

  const upload = async () => {
    if (!captured) return;
    setUploading(true);
    try {
      const filename = `kamera-${new Date().toISOString().replace(/[:.]/g, "-")}.jpg`;
      const formData = new FormData();
      formData.append("file", new File([captured.blob], filename, { type: "image/jpeg" }));
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
      toast({ title: "Skjermbilde lagt til som vedlegg" });
      onClose();
    } catch (err: any) {
      toast({ title: "Opplasting feilet", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Ta bilde med kamera</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {devices.length > 1 && (
            <Select value={deviceId} onValueChange={switchDevice}>
              <SelectTrigger>
                <SelectValue placeholder="Velg kamera" />
              </SelectTrigger>
              <SelectContent>
                {devices.map((d) => (
                  <SelectItem key={d.deviceId} value={d.deviceId}>
                    {d.label || `Kamera ${d.deviceId.slice(0, 6)}…`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {error && (
            <div className="text-sm text-destructive p-3 rounded-md bg-destructive/10 border border-destructive/30">
              {error}
            </div>
          )}
          {captured ? (
            <img src={captured.dataUrl} alt="Tatt bilde" className="w-full rounded-lg border" />
          ) : (
            <video ref={videoRef} className="w-full rounded-lg bg-black" playsInline muted />
          )}
          <canvas ref={canvasRef} className="hidden" />
          <p className="text-xs text-muted-foreground">
            Tips: på Mac kan du velge iPhone som kamera (Continuity Camera) — krever samme Apple ID, WiFi og Bluetooth på begge enheter.
          </p>
        </div>
        <DialogFooter>
          {captured ? (
            <>
              <Button variant="ghost" onClick={() => setCaptured(null)}>Ta nytt bilde</Button>
              <Button onClick={upload} disabled={uploading}>
                {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Lagre som vedlegg
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>Avbryt</Button>
              <Button onClick={capture} disabled={!!error}>
                <Camera className="h-4 w-4 mr-2" />
                Knips bilde
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function QrPairButton({ sessionId }: { sessionId: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label="QR-paret opplasting"
        title="Last opp fra mobil via QR-kode"
        className="h-8"
      >
        <Smartphone className="h-4 w-4" />
      </Button>
      {open && <QrPairDialog sessionId={sessionId} onClose={() => setOpen(false)} />}
    </>
  );
}

function QrPairDialog({ sessionId, onClose }: { sessionId: number; onClose: () => void }) {
  const { toast } = useToast();
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [uploadUrl, setUploadUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const resp = await apiRequest("POST", `/api/experience/sessions/${sessionId}/upload-token`, {});
        const { token, expiresAt: exp } = await resp.json() as { token: string; expiresAt: string };
        const url = `${window.location.origin}/u/${token}`;
        setUploadUrl(url);
        setExpiresAt(new Date(exp));
        // Lazy-import qrcode for å unngå å bundle på initial JS
        const QRCode = (await import("qrcode")).default;
        const dataUrl = await QRCode.toDataURL(url, { width: 320, margin: 1 });
        setQrDataUrl(dataUrl);
      } catch (err: any) {
        toast({ title: "Kunne ikke generere QR-kode", description: err.message, variant: "destructive" });
        onClose();
      }
    })();
  }, [sessionId]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Last opp fra mobil</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Skann QR-koden med telefonen din. Tar du bilder eller velger filer på telefonen, lastes de rett opp i denne sesjonen.
            Ingen innlogging trengs på telefonen — link er gyldig i 1 time.
          </p>
          {qrDataUrl ? (
            <div className="flex justify-center">
              <img src={qrDataUrl} alt="QR-kode for opplasting" className="rounded-lg border" />
            </div>
          ) : (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
          {uploadUrl && (
            <div className="text-xs text-center text-muted-foreground break-all px-4">
              {uploadUrl}
            </div>
          )}
          {expiresAt && (
            <div className="text-xs text-center text-muted-foreground">
              Utløper {expiresAt.toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" })}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Ferdig</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
