import { useState, useRef, useEffect } from "react";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Brain, Send, Loader2, BookOpen, FileText, MessageCircle, ExternalLink, Upload } from "lucide-react";
import { Page, PageHeader, Section, Panel, EmptyState } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { supabase } from "@/lib/supabase";
import type { ChatMessage, KnowledgeSourceRef } from "@shared/schema";

type ChatTurn = ChatMessage & { sources?: KnowledgeSourceRef[] };

const EXAMPLE_QUESTIONS = [
  "Hva har jeg lært om møtestruktur?",
  "Hvilke utfordringer har dukket opp i tidligere prosjekter?",
  "Oppsummer det jeg vet om kontraktsforhandlinger.",
  "Hva sa vi om kvalitetssikring sist?",
];

const SOURCE_TYPE_LABELS: Record<string, string> = {
  lesson: "Lærdom",
  meeting_summary: "Møtereferat",
  meeting_transcript: "Møte",
  experience_transcript: "Erfaringsmøte",
  rule: "Regel",
  uploaded_doc: "Dokument",
  uploaded_image: "Bilde",
};

function sourceLink(source: KnowledgeSourceRef): string | null {
  if (source.sourceType === "meeting_summary" || source.sourceType === "meeting_transcript") {
    return source.sourceId ? `/m/${source.sourceId}` : null;
  }
  if (source.sourceType === "experience_transcript" || source.sourceType === "lesson") {
    // lesson har sessionId i metadata, men for MVP linker vi til erfaringslista
    return source.sourceId ? `/erfaring/${source.sourceId}` : "/erfaring";
  }
  if (source.sourceType === "rule") {
    return "/kunnskapsbase";
  }
  return null;
}

export default function BrainPage() {
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const ask = useMutation({
    mutationFn: async (text: string) => {
      const newMessages: ChatMessage[] = [
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: text },
      ];
      const resp = await apiRequest("POST", "/api/brain/chat", { messages: newMessages });
      return resp.json() as Promise<{ answer: string; sources: KnowledgeSourceRef[] }>;
    },
    onMutate: (text) => {
      setMessages((prev) => [...prev, { role: "user", content: text }]);
      setInput("");
    },
    onSuccess: (data) => {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.answer, sources: data.sources },
      ]);
    },
    onError: (err: any) => {
      toast({ title: "Hjernen svarer ikke", description: err.message, variant: "destructive" });
    },
  });

  const handleAsk = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || ask.isPending) return;
    ask.mutate(trimmed);
  };

  return (
    <Page>
      <PageHeader
        eyebrow="Hjernen din"
        title="Spør hjernen om hva du har lært"
        lead="Alle erfaringsmøter, referater, regler og dokumenter er samlet i ett gjennomsøkbart minne. Still et spørsmål, og AI henter relevante utdrag og syntetiserer et svar med kildehenvisninger."
      />

      <Section
        actions={
          <BackfillButton />
        }
      >
        <Panel className="p-0">
          <div ref={scrollRef} className="max-h-[60vh] min-h-[300px] overflow-y-auto p-6 space-y-6">
            {messages.length === 0 ? (
              <EmptyState
                icon={Brain}
                title="Hjernen venter på første spørsmål"
                description="Den vet kun om det du har matet inn — møter, erfaringer, regler og dokumenter. Prøv et eksempel:"
                actions={
                  <div className="grid gap-2 mt-2 w-full max-w-md">
                    {EXAMPLE_QUESTIONS.map((q) => (
                      <Button
                        key={q}
                        variant="outline"
                        className="justify-start text-left h-auto py-2.5 whitespace-normal"
                        onClick={() => handleAsk(q)}
                      >
                        <MessageCircle className="h-4 w-4 mr-2 shrink-0" />
                        {q}
                      </Button>
                    ))}
                  </div>
                }
              />
            ) : (
              messages.map((msg, idx) => (
                <ChatBubble key={idx} message={msg} />
              ))
            )}
            {ask.isPending && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Hjernen tenker…
              </div>
            )}
          </div>

          <div className="border-t border-card-border p-4">
            <div className="flex gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleAsk(input);
                  }
                }}
                placeholder="Spør om hva som helst… (⌘ Enter for å sende)"
                rows={2}
                className="resize-none"
              />
              <Button
                onClick={() => handleAsk(input)}
                disabled={!input.trim() || ask.isPending}
                size="lg"
                aria-label="Send"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </Panel>
      </Section>

      <Section title="Mate hjernen med mer kunnskap">
        <div className="grid gap-3 md:grid-cols-2">
          <UploadCard />
          <Card className="p-5">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-accent/15 text-accent shrink-0">
                <BookOpen className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold mb-1">Erfaringsmøter</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Ta opp eller last opp et erfaringsmøte. AI ekstraherer strukturerte lærdommer.
                </p>
                <Link href="/erfaring">
                  <a>
                    <Button variant="outline" size="sm">
                      Til erfaringsmøter
                    </Button>
                  </a>
                </Link>
              </div>
            </div>
          </Card>
        </div>
      </Section>
    </Page>
  );
}

function ChatBubble({ message }: { message: ChatTurn }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 ${
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground"
        }`}
      >
        <div className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</div>
        {message.sources && message.sources.length > 0 && (
          <div className="mt-3 pt-3 border-t border-card-border/30 space-y-1.5">
            <div className="text-xs uppercase tracking-wider opacity-70">Kilder</div>
            {message.sources.map((source, idx) => {
              const link = sourceLink(source);
              const label = SOURCE_TYPE_LABELS[source.sourceType] ?? source.sourceType;
              const content = (
                <div className="flex items-start gap-2 text-xs hover:bg-background/30 rounded px-2 py-1.5 -mx-2">
                  <Badge variant="outline" className="text-[10px] shrink-0 mt-0.5">
                    [{idx + 1}] {label}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{source.sourceName}</div>
                    <div className="opacity-70 text-[11px] line-clamp-2">{source.excerpt}</div>
                  </div>
                  {link && <ExternalLink className="h-3 w-3 opacity-50 shrink-0 mt-0.5" />}
                </div>
              );
              return link ? (
                <Link key={`${source.chunkId}-${idx}`} href={link}>
                  <a className="block">{content}</a>
                </Link>
              ) : (
                <div key={`${source.chunkId}-${idx}`}>{content}</div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function UploadCard() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch("/api/brain/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
        body: formData,
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || "Opplasting feilet");
      }
      const result = await resp.json();
      toast({
        title: "Lagt til i hjernen",
        description: `${file.name} → ${result.chunks} chunks`,
      });
    } catch (err: any) {
      toast({ title: "Opplasting feilet", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary shrink-0">
          <Upload className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold mb-1">Last opp dokument</h3>
          <p className="text-sm text-muted-foreground mb-3">
            PDF, Word, Excel, bilde eller tekstfil — alt blir søkbart i hjernen din.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.xlsx,.xls,.txt,image/*,.heic,.heif"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUpload(file);
              e.target.value = "";
            }}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Behandler…
              </>
            ) : (
              <>
                <FileText className="h-4 w-4 mr-2" />
                Velg fil
              </>
            )}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function BackfillButton() {
  const [running, setRunning] = useState(false);
  const { toast } = useToast();

  const handle = async () => {
    setRunning(true);
    try {
      const resp = await apiRequest("POST", "/api/brain/backfill", {});
      const result = await resp.json();
      toast({
        title: "Hjernen oppdatert",
        description: `${result.chunksAdded} nye chunks lagt til, ${result.sourcesSkipped} fra før.`,
      });
    } catch (err: any) {
      toast({ title: "Feilet", description: err.message, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Button onClick={handle} variant="outline" size="sm" disabled={running}>
      {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
      Lær fra tidligere møter
    </Button>
  );
}
