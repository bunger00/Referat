import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  Plus,
  Trash2,
  FileText,
  Replace,
  ScrollText,
  AlertCircle,
  Loader2,
  Upload,
  CheckCircle2,
} from "lucide-react";
import { Page, PageHeader, Section, Panel, EmptyState, StatPill, OnboardingHint } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { supabase } from "@/lib/supabase";
import type { UploadedDocument, ExtractedRule, WordCorrection, MeetingDocument } from "@shared/schema";

type RulesResp = {
  documents: UploadedDocument[];
  rules: ExtractedRule[];
  ruleCount: number;
  documentCount: number;
};

export default function KnowledgePage() {
  return (
    <Page>
      <PageHeader
        eyebrow="Kunnskap"
        title="Kunnskapsbase"
        lead="Last opp regelverk, lær AI hvordan ord skal skrives, og knytt kontekstdokumenter til møter. Alt brukes automatisk for smartere AI-forslag."
      />

      <OnboardingHint
        hintKey="knowledgeBase"
        title="Hvorfor er dette nyttig?"
        description="Regelverket varsler om brudd under møtet. Ordrettelser fikser fagspråk i transkriptet. Møtedokumenter gir AI kontekst om prosjektet ditt."
      />

      <Tabs defaultValue="rules" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3 sm:w-auto sm:inline-flex">
          <TabsTrigger value="rules" className="gap-2">
            <ScrollText className="h-4 w-4" /> Regelverk
          </TabsTrigger>
          <TabsTrigger value="words" className="gap-2">
            <Replace className="h-4 w-4" /> Ordrettelser
          </TabsTrigger>
          <TabsTrigger value="docs" className="gap-2">
            <FileText className="h-4 w-4" /> Møtedokumenter
          </TabsTrigger>
        </TabsList>

        <TabsContent value="rules">
          <RulesTab />
        </TabsContent>
        <TabsContent value="words">
          <WordCorrectionsTab />
        </TabsContent>
        <TabsContent value="docs">
          <MeetingDocsTab />
        </TabsContent>
      </Tabs>
    </Page>
  );
}

/* ----- Regelverk ----- */
function RulesTab() {
  const { data, isLoading } = useQuery<RulesResp>({ queryKey: ["/api/rules"] });
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteName, setPasteName] = useState("");

  const docs = data?.documents ?? [];
  const rules = data?.rules ?? [];

  const uploadFile = async (file: File) => {
    setUploading(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const formData = new FormData();
      formData.append("document", file);
      const res = await fetch("/api/rules/upload", {
        method: "POST",
        headers: session.session?.access_token
          ? { Authorization: `Bearer ${session.session.access_token}` }
          : {},
        body: formData,
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Opplasting feilet");
      queryClient.invalidateQueries({ queryKey: ["/api/rules"] });
      toast({ title: "Dokument lastet opp", description: `${json.rules?.length ?? 0} regler trukket ut` });
    } catch (e: any) {
      toast({ title: "Opplasting feilet", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const pasteMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/rules/text", {
        text: pasteText,
        name: pasteName.trim() || undefined,
      });
      return r.json();
    },
    onSuccess: (json: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/rules"] });
      toast({ title: "Tekst lagt til", description: `${json.rules?.length ?? 0} regler trukket ut` });
      setPasteOpen(false);
      setPasteText("");
      setPasteName("");
    },
    onError: (e: any) => toast({ title: "Feil", description: e.message, variant: "destructive" }),
  });

  const deleteDoc = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/rules/document/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rules"] });
      toast({ title: "Dokument slettet" });
    },
  });

  return (
    <div className="space-y-4">
      <Section
        title="Regeldokumenter"
        description="Last opp PDF, DOCX eller tekst. AI henter ut regler og varsler om brudd under møtet."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setPasteOpen(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              Lim inn tekst
            </Button>
            <Button onClick={() => fileInput.current?.click()} disabled={uploading || docs.length >= 5}>
              {uploading ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Upload className="h-4 w-4 mr-1.5" />}
              Last opp fil
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept=".pdf,.docx,.txt"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadFile(f);
                e.currentTarget.value = "";
              }}
            />
          </div>
        }
      >
        {isLoading ? (
          <Panel className="h-24 animate-pulse bg-muted/40" />
        ) : docs.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="Ingen regelverk lastet opp"
            description="Last opp opp til 5 dokumenter (PDF, DOCX eller tekst). AI bruker dem til å varsle om regelbrudd og foreslå spørsmål."
          />
        ) : (
          <Panel className="overflow-hidden">
            <ul className="divide-y divide-card-border">
              {docs.map((d) => (
                <li key={d.id} className="flex items-center gap-3 p-4">
                  <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{d.originalName}</div>
                    <div className="flex items-center gap-2 mt-1">
                      {d.status === "ready" ? (
                        <StatPill tone="success" icon={<CheckCircle2 className="h-3 w-3" />}>
                          {d.rulesExtracted} regler
                        </StatPill>
                      ) : d.status === "processing" ? (
                        <StatPill tone="suggestion" icon={<Loader2 className="h-3 w-3 animate-spin" />}>
                          Behandler…
                        </StatPill>
                      ) : (
                        <StatPill tone="warning" icon={<AlertCircle className="h-3 w-3" />}>
                          Feil
                        </StatPill>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteDoc.mutate(d.id)}
                    aria-label="Slett dokument"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </Section>

      {rules.length > 0 ? (
        <Section title={`Ekstraherte regler (${rules.length})`}>
          <Panel className="max-h-96 overflow-y-auto">
            <ul className="divide-y divide-card-border">
              {rules.map((r) => (
                <li key={r.id} className="p-4">
                  <div className="text-xs text-muted-foreground">{r.document_name} · {r.section}</div>
                  <div className="font-medium mt-0.5">{r.rule_title}</div>
                  <div className="text-sm text-muted-foreground mt-1 leading-relaxed">{r.summary}</div>
                </li>
              ))}
            </ul>
          </Panel>
        </Section>
      ) : null}

      <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Lim inn regelverkstekst</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Navn (valgfritt)"
              value={pasteName}
              onChange={(e) => setPasteName(e.target.value)}
            />
            <Textarea
              placeholder="Lim inn regler eller policy-tekst…"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={10}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPasteOpen(false)}>Avbryt</Button>
            <Button
              disabled={!pasteText.trim() || pasteMutation.isPending}
              onClick={() => pasteMutation.mutate()}
            >
              {pasteMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
              Trekk ut regler
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ----- Ordrettelser ----- */
function WordCorrectionsTab() {
  const { data, isLoading } = useQuery<{ corrections: WordCorrection[] }>({
    queryKey: ["/api/word-corrections"],
  });
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [original, setOriginal] = useState("");
  const [corrected, setCorrected] = useState("");

  const corrections = data?.corrections ?? [];

  const addMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/word-corrections", { original, corrected });
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/word-corrections"] });
      setOriginal("");
      setCorrected("");
      toast({ title: "Lagt til" });
    },
    onError: (e: any) => toast({ title: "Feil", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/word-corrections/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/word-corrections"] }),
  });

  return (
    <Section
      title="Ordrettelser"
      description="Hvis transkriptet bommer på fagord eller navn, kan du legge til erstatninger her. Eksempel: «teknisk gjeld» → «TG»."
    >
      <Panel className="p-4 mb-4">
        <form
          className="flex flex-col sm:flex-row gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (original.trim() && corrected.trim()) addMutation.mutate();
          }}
        >
          <Input
            placeholder="Original (slik AI hører det)"
            value={original}
            onChange={(e) => setOriginal(e.target.value)}
            className="flex-1"
          />
          <Input
            placeholder="Riktig (slik det skal stå)"
            value={corrected}
            onChange={(e) => setCorrected(e.target.value)}
            className="flex-1"
          />
          <Button type="submit" disabled={!original.trim() || !corrected.trim() || addMutation.isPending}>
            <Plus className="h-4 w-4 mr-1.5" />
            Legg til
          </Button>
        </form>
      </Panel>

      {isLoading ? (
        <Panel className="h-24 animate-pulse bg-muted/40" />
      ) : corrections.length === 0 ? (
        <EmptyState
          icon={Replace}
          title="Ingen ordrettelser ennå"
          description="Hver gang AI hører feil samme ord, legg det til her én gang så fikser vi det automatisk fremover."
        />
      ) : (
        <Panel className="overflow-hidden">
          <ul className="divide-y divide-card-border">
            {corrections.map((c) => (
              <li key={c.id} className="flex items-center gap-3 p-3.5">
                <span className="font-mono text-sm text-muted-foreground line-through">{c.original}</span>
                <span className="text-muted-foreground">→</span>
                <span className="font-mono text-sm font-medium flex-1">{c.corrected}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => deleteMutation.mutate(c.id)}
                  aria-label="Slett"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </Section>
  );
}

/* ----- Møtedokumenter ----- */
function MeetingDocsTab() {
  const { data, isLoading } = useQuery<{ documents: MeetingDocument[] }>({
    queryKey: ["/api/meeting-documents"],
  });
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const docs = data?.documents ?? [];

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/meeting-documents/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meeting-documents"] });
      toast({ title: "Slettet" });
    },
  });

  return (
    <Section
      title="Møtedokumenter"
      description="Kontekstdokumenter knyttet til et spesifikt møte eller en serie. Lastes opp fra møtesiden, listes her for oversikt."
    >
      {isLoading ? (
        <Panel className="h-24 animate-pulse bg-muted/40" />
      ) : docs.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Ingen møtedokumenter"
          description="Møtedokumenter (agendaer, prosjektnotater, prevhandlinger) lastes opp fra møtesiden og lagres her. Bruk dem for å gi AI kontekst."
        />
      ) : (
        <Panel className="overflow-hidden">
          <ul className="divide-y divide-card-border">
            {docs.map((d) => (
              <li key={d.id} className="flex items-start gap-3 p-4">
                <BookOpen className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{d.originalName}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {d.fileType.toUpperCase()} · {new Date(d.createdAt).toLocaleDateString("nb-NO")}
                    {d.sessionId ? ` · møte #${d.sessionId}` : ""}
                    {d.seriesId ? ` · serie #${d.seriesId}` : ""}
                  </div>
                  {d.keyPoints ? (
                    <p className="text-sm text-muted-foreground mt-2 line-clamp-3 leading-relaxed">
                      {d.keyPoints}
                    </p>
                  ) : null}
                </div>
                <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(d.id)} aria-label="Slett">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </Section>
  );
}
