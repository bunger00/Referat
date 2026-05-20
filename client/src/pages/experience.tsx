import { useState, useRef } from "react";
import { Link, useRoute, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload, Sparkles, FileText, Loader2, ArrowRight, Trash2 } from "lucide-react";
import { Page, PageHeader, Section, Panel, EmptyState } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { supabase } from "@/lib/supabase";
import type {
  ExperienceSession,
  TranscriptSegment,
  ProposedLesson,
  LessonLearned,
} from "@shared/schema";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("nb-NO", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function ExperiencePage() {
  const [, sessionMatch] = useRoute<{ id: string }>("/erfaring/:id");
  return sessionMatch ? <ExperienceSessionView id={Number(sessionMatch.id)} /> : <ExperienceList />;
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

  const sessions = data?.sessions ?? [];

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      // 1. Opprett en tom session
      const created = await apiRequest("POST", "/api/experience/sessions", {
        title: file.name.replace(/\.[^.]+$/, ""),
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
      const segments: TranscriptSegment[] = transcribed.segments ?? [];

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
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="p-6">
            <div className="flex items-start gap-4">
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-accent/15 text-accent shrink-0">
                <Upload className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-base mb-1">Last opp lydopptak</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Tar opp møtet på telefon eller datamaskin? Last opp filen så transkriberes den automatisk.
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
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary shrink-0">
                <FileText className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-base mb-1">Skriv inn manuelt</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Har du allerede et notat eller transkript? Opprett en tom sesjon og lim inn teksten.
                </p>
                <CreateBlankButton />
              </div>
            </div>
          </Card>
        </div>
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

function CreateBlankButton() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);

  const handle = async () => {
    setCreating(true);
    try {
      const resp = await apiRequest("POST", "/api/experience/sessions", { title: "" });
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

function ExperienceSessionView({ id }: { id: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const { data, isLoading } = useQuery<{ session: ExperienceSession; lessons: LessonLearned[] }>({
    queryKey: [`/api/experience/sessions/${id}`],
  });

  const [titleEdit, setTitleEdit] = useState<string | null>(null);
  const [transcriptEdit, setTranscriptEdit] = useState<string | null>(null);
  const [proposals, setProposals] = useState<ProposedLesson[]>([]);
  const [extracting, setExtracting] = useState(false);

  const session = data?.session;
  const lessons = data?.lessons ?? [];

  const transcriptText =
    session?.transcript?.map((s) => `[${s.timestamp}] ${s.speaker}: ${s.text}`).join("\n") ?? "";

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
      return resp.json() as Promise<{ proposals: ProposedLesson[] }>;
    },
    onSuccess: (data) => {
      setProposals(data.proposals);
      setExtracting(false);
      toast({
        title: `Fant ${data.proposals.length} lærdommer`,
        description: "Gjennomgå og godkjenn de du vil lagre.",
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

      <Section title="Transkript">
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
            <pre className="text-sm font-mono whitespace-pre-wrap text-muted-foreground max-h-96 overflow-y-auto">
              {transcriptText}
            </pre>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setTranscriptEdit(transcriptText)}
              className="mt-3"
            >
              Redigér transkript
            </Button>
          </Panel>
        ) : (
          <EmptyState
            icon={FileText}
            title="Ingen transkript ennå"
            description="Last opp et lydopptak eller lim inn teksten manuelt."
            actions={
              <Button onClick={() => setTranscriptEdit("")} variant="outline">
                Lim inn transkript manuelt
              </Button>
            }
          />
        )}
      </Section>

      {transcriptText && (
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
  onChange,
  onApprove,
  onReject,
  saving,
}: {
  proposal: ProposedLesson;
  onChange: (updated: ProposedLesson) => void;
  onApprove: () => void;
  onReject: () => void;
  saving: boolean;
}) {
  return (
    <Card className="p-4 border-l-4 border-l-primary">
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
