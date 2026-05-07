import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { authFetch, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RecordButton, LiveIndicator } from "@/components/ds";
import { Speedometer } from "@/components/interview/Speedometer";
import { StarPanel } from "@/components/interview/StarPanel";
import { InterviewReportDialog } from "@/components/interview/InterviewReportDialog";
import {
  Sparkles,
  Mic,
  Clock,
  Loader2,
  Square,
  CheckCircle2,
  ChevronRight,
} from "lucide-react";
import {
  type TranscriptSegment,
  type InterviewScores,
  type StarStatus,
  type InterviewEvalSnapshot,
  type InterviewReport,
  type InterviewCriterion,
  interviewCriterionLabels,
} from "@shared/schema";

const TARGET_SAMPLE_RATE = 16000;
const FLUSH_INTERVAL_MS = 28000;
const ANALYZE_INTERVAL_MS = 60000;

const CRITERIA: InterviewCriterion[] = [
  "konkretisering",
  "fagdybde",
  "eierskap",
  "refleksjon",
  "samhandling",
  "struktur",
];

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

function downsampleTo16k(input: Float32Array, inputRate: number): Float32Array {
  if (inputRate === TARGET_SAMPLE_RATE) return input;
  const ratio = inputRate / TARGET_SAMPLE_RATE;
  const outLength = Math.round(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const srcIdx = i * ratio;
    const a = Math.floor(srcIdx);
    const b = Math.min(a + 1, input.length - 1);
    const t = srcIdx - a;
    out[i] = input[a] * (1 - t) + input[b] * t;
  }
  return out;
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export default function InterviewPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [sessionId, setSessionId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const [scores, setScores] = useState<InterviewScores | null>(null);
  const [star, setStar] = useState<StarStatus | null>(null);
  const [evalHistory, setEvalHistory] = useState<InterviewEvalSnapshot[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const [report, setReport] = useState<InterviewReport | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);

  // Audio refs
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioDataRef = useRef<Uint8Array | null>(null);
  const levelFrameRef = useRef<number | null>(null);
  const pcmBufferRef = useRef<Float32Array[]>([]);
  const pcmRateRef = useRef<number>(48000);
  const flushTimerRef = useRef<number | null>(null);
  const analyzeTimerRef = useRef<number | null>(null);
  const tickTimerRef = useRef<number | null>(null);
  const transcriptRef = useRef<TranscriptSegment[]>([]);

  const [audioBars, setAudioBars] = useState<number[]>(Array(20).fill(0));

  // Keep transcriptRef synced
  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  const flushPcm = (): Blob | null => {
    const frames = pcmBufferRef.current;
    if (frames.length === 0) return null;
    pcmBufferRef.current = [];
    let total = 0;
    for (const f of frames) total += f.length;
    if (total < pcmRateRef.current * 0.5) return null;
    const merged = new Float32Array(total);
    let pos = 0;
    for (const f of frames) {
      merged.set(f, pos);
      pos += f.length;
    }
    const downsampled = downsampleTo16k(merged, pcmRateRef.current);
    return encodeWav(downsampled, TARGET_SAMPLE_RATE);
  };

  const sendAudioChunk = async (blob: Blob) => {
    setIsProcessing(true);
    try {
      const reader = new FileReader();
      const base64Audio = await new Promise<string>((resolve, reject) => {
        reader.onloadend = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const res = await authFetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: base64Audio, mimeType: "audio/wav", model: "openai" }),
      });
      if (!res.ok) {
        console.error("Transkripsjonsfeil:", res.status, await res.text());
        return;
      }
      const data = (await res.json()) as { segments: TranscriptSegment[] };
      if (data.segments && data.segments.length > 0) {
        setTranscript((prev) => [...prev, ...data.segments]);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsProcessing(false);
    }
  };

  const runAnalyze = async () => {
    const current = transcriptRef.current;
    if (current.length === 0) return;
    setIsAnalyzing(true);
    try {
      const res = await authFetch("/api/interview/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: current,
          industry: "bygg",
          minute: Math.floor(elapsedSeconds / 60),
        }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        scores: InterviewScores | null;
        star: StarStatus | null;
        snapshot?: InterviewEvalSnapshot;
      };
      if (data.scores) setScores(data.scores);
      if (data.star) setStar(data.star);
      if (data.snapshot) setEvalHistory((prev) => [...prev, data.snapshot!]);
    } catch (e) {
      console.error("Analyze feil:", e);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const startRecording = async () => {
    try {
      setIsStarting(true);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      streamRef.current = stream;

      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      pcmRateRef.current = ctx.sampleRate;
      pcmBufferRef.current = [];

      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.7;
      source.connect(analyser);
      analyserRef.current = analyser;
      audioDataRef.current = new Uint8Array(analyser.frequencyBinCount);

      const NUM_BARS = 20;
      const animate = () => {
        if (!analyserRef.current || !audioDataRef.current) return;
        analyserRef.current.getByteFrequencyData(audioDataRef.current);
        const data = audioDataRef.current;
        const bars: number[] = [];
        for (let i = 0; i < NUM_BARS; i++) {
          const mirroredIdx = i < NUM_BARS / 2 ? i : NUM_BARS - 1 - i;
          const binIdx = Math.floor((mirroredIdx / (NUM_BARS / 2)) * Math.min(data.length - 1, 14));
          const raw = data[binIdx] / 255;
          bars.push(Math.max(raw, 0.03 + Math.random() * 0.06));
        }
        setAudioBars(bars);
        levelFrameRef.current = requestAnimationFrame(animate);
      };
      levelFrameRef.current = requestAnimationFrame(animate);

      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      processor.onaudioprocess = (e) => {
        const ch = e.inputBuffer.getChannelData(0);
        pcmBufferRef.current.push(new Float32Array(ch));
      };
      source.connect(processor);
      processor.connect(ctx.destination);

      // Opprett DB-økt hvis ikke finnes
      if (!sessionId) {
        try {
          const res = await apiRequest("POST", "/api/interview/sessions", {
            title: title || `Intervjutrening ${new Date().toLocaleDateString("nb-NO")}`,
            industry: "bygg",
          });
          const data = (await res.json()) as { session: { id: number } };
          setSessionId(data.session.id);
        } catch {
          /* fortsetter uten persistens */
        }
      }

      setIsRecording(true);
      setIsStarting(false);

      flushTimerRef.current = window.setInterval(() => {
        const blob = flushPcm();
        if (blob) sendAudioChunk(blob);
      }, FLUSH_INTERVAL_MS);

      analyzeTimerRef.current = window.setInterval(() => {
        runAnalyze();
      }, ANALYZE_INTERVAL_MS);

      tickTimerRef.current = window.setInterval(() => {
        setElapsedSeconds((s) => s + 1);
      }, 1000);

      toast({ title: "Intervju startet", description: "AI evaluerer hvert minutt." });
    } catch (e: any) {
      setIsStarting(false);
      toast({
        title: "Kunne ikke starte opptak",
        description: e?.message || "Sjekk at mikrofonen er tilgjengelig.",
        variant: "destructive",
      });
    }
  };

  const stopRecording = async () => {
    setIsRecording(false);

    if (flushTimerRef.current) {
      clearInterval(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    if (analyzeTimerRef.current) {
      clearInterval(analyzeTimerRef.current);
      analyzeTimerRef.current = null;
    }
    if (tickTimerRef.current) {
      clearInterval(tickTimerRef.current);
      tickTimerRef.current = null;
    }
    if (levelFrameRef.current) {
      cancelAnimationFrame(levelFrameRef.current);
      levelFrameRef.current = null;
    }

    // Flush any remaining audio
    const tail = flushPcm();
    if (tail) await sendAudioChunk(tail);

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    analyserRef.current = null;
    audioDataRef.current = null;

    // Persist final state
    if (sessionId) {
      try {
        await apiRequest("PATCH", `/api/interview/sessions/${sessionId}`, {
          transcript: transcriptRef.current,
          currentScores: scores,
          currentStar: star,
          evalHistory,
          elapsedSeconds,
          endedAt: new Date().toISOString(),
        });
      } catch {
        /* ignore */
      }
    }
  };

  const generateReport = async () => {
    setIsGeneratingReport(true);
    try {
      const res = await authFetch("/api/interview/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: transcriptRef.current,
          evalHistory,
          industry: "bygg",
        }),
      });
      if (!res.ok) {
        toast({
          title: "Kunne ikke lage rapport",
          description: await res.text(),
          variant: "destructive",
        });
        return;
      }
      const data = (await res.json()) as { report: InterviewReport };
      setReport(data.report);
      setReportOpen(true);
      if (sessionId) {
        try {
          await apiRequest("PATCH", `/api/interview/sessions/${sessionId}`, {
            report: data.report,
          });
        } catch {
          /* ignore */
        }
      }
    } catch (e: any) {
      toast({ title: "Feil", description: e?.message || "Ukjent feil", variant: "destructive" });
    } finally {
      setIsGeneratingReport(false);
    }
  };

  const exportReport = () => {
    if (!report) return;
    const md = renderReportAsMarkdown(report, transcript, title);
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `intervjurapport-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Cleanup på unmount er IKKE nødvendig her — siden /intervju også keep-mountes
  // via App.tsx-strategien? Faktisk: bare meeting holdes mountet. Intervju-siden
  // unmounter når brukeren navigerer bort. Hvis bruker forlater mid-intervju må
  // vi rydde opp.
  useEffect(() => {
    return () => {
      if (flushTimerRef.current) clearInterval(flushTimerRef.current);
      if (analyzeTimerRef.current) clearInterval(analyzeTimerRef.current);
      if (tickTimerRef.current) clearInterval(tickTimerRef.current);
      if (levelFrameRef.current) cancelAnimationFrame(levelFrameRef.current);
      if (processorRef.current) {
        try { processorRef.current.disconnect(); } catch {}
      }
      if (sourceRef.current) {
        try { sourceRef.current.disconnect(); } catch {}
      }
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const hasData = transcript.length > 0;
  const showEvalEmpty = !scores && !isAnalyzing && hasData;
  const showEarlyState = !hasData && !isRecording;

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-background overflow-hidden">
      {/* Topbar */}
      <header className="shrink-0 border-b border-border bg-background/85 backdrop-blur">
        <div className="flex items-center gap-3 px-4 py-2.5 sm:px-6">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Intervju-tittel…"
            className="border-0 bg-transparent px-0 h-9 font-display text-base sm:text-xl font-semibold tracking-tightish focus-visible:ring-0 focus-visible:ring-offset-0 sm:max-w-md min-w-0 flex-1"
          />
          <div className="hidden sm:flex items-center gap-1.5 text-muted-foreground shrink-0">
            <Clock className="h-3.5 w-3.5" />
            <span className="font-mono text-sm tabular-nums">{formatTime(elapsedSeconds)}</span>
          </div>
          {isRecording ? <LiveIndicator label="Tar opp" /> : null}
          {isAnalyzing ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-suggestion">
              <Loader2 className="h-3 w-3 animate-spin" />
              Evaluerer…
            </span>
          ) : null}
          {isProcessing ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : null}
          <div className="flex-1" />
          {transcript.length > 0 && !isRecording ? (
            <Button onClick={generateReport} disabled={isGeneratingReport} className="gap-1.5">
              {isGeneratingReport ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {report ? "Vis rapport" : "Lag rapport"}
            </Button>
          ) : null}
        </div>
      </header>

      {/* Main grid */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] overflow-hidden">
        {/* Transcript */}
        <section className="flex flex-col min-h-0 border-r border-border bg-card/30">
          <header className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border shrink-0">
            <h2 className="font-display text-sm font-semibold tracking-tightish flex items-center gap-2">
              <Mic className="h-3.5 w-3.5 text-muted-foreground" />
              Transkript
              {transcript.length > 0 ? (
                <span className="text-xs font-normal text-muted-foreground">
                  {transcript.length}
                </span>
              ) : null}
            </h2>
          </header>
          <ScrollArea className="flex-1 min-h-0">
            <div className="px-4 py-4 space-y-3">
              {transcript.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center px-4 gap-4">
                  {isRecording ? (
                    <>
                      <div className="flex items-end gap-[3px] h-12">
                        {audioBars.map((level, i) => (
                          <div
                            key={i}
                            className="w-1 rounded-sm bg-accent transition-all duration-75"
                            style={{ height: `${Math.max(15, level * 100)}%` }}
                          />
                        ))}
                      </div>
                      <p className="text-sm text-muted-foreground">Lytter…</p>
                    </>
                  ) : (
                    <>
                      <Mic className="h-10 w-10 text-muted-foreground/50" strokeWidth={1.5} />
                      <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
                        Trykk opptaksknappen for å starte intervjuet. AI lytter, skiller intervjuer fra kandidat, og evaluerer kandidatens svar hvert minutt.
                      </p>
                    </>
                  )}
                </div>
              ) : (
                transcript.map((segment) => (
                  <div key={segment.id} className="space-y-1">
                    <span className="text-[11px] text-muted-foreground/60 font-mono">
                      {new Date(segment.timestamp).toLocaleTimeString("no-NO", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <p className="text-sm leading-relaxed">{segment.text}</p>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </section>

        {/* Eval panel */}
        <section className="flex flex-col min-h-0">
          <ScrollArea className="flex-1 min-h-0">
            <div className="p-5 space-y-5">
              {showEarlyState ? (
                <div className="rounded-2xl border border-dashed border-border bg-card/40 p-8 text-center">
                  <Sparkles className="h-7 w-7 text-muted-foreground mx-auto mb-3" />
                  <h3 className="font-display text-lg font-semibold tracking-tightish">
                    Klar for intervjutrening
                  </h3>
                  <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
                    Når intervjuet starter, vises 6 speedometre som live-evaluerer
                    kandidaten på konkretisering, fagdybde, eierskap, refleksjon,
                    samhandling og struktur. AI oppdaterer hvert minutt.
                  </p>
                </div>
              ) : null}

              {showEvalEmpty ? (
                <div className="rounded-2xl border border-suggestion/30 bg-suggestion/5 p-5 text-center">
                  <Loader2 className="h-5 w-5 text-suggestion mx-auto mb-2 animate-spin" />
                  <p className="text-sm text-muted-foreground">
                    Første evaluering kommer etter ~1 minutt.
                  </p>
                </div>
              ) : null}

              {scores ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {CRITERIA.map((c) => (
                    <Speedometer
                      key={c}
                      score={scores[c].score}
                      label={interviewCriterionLabels[c]}
                      rationale={scores[c].rationale}
                      size="md"
                    />
                  ))}
                </div>
              ) : null}

              {(scores || star) ? (
                <StarPanel star={star} />
              ) : null}
            </div>
          </ScrollArea>

          {/* Bottom bar with record button */}
          <footer className="shrink-0 border-t border-border bg-card/60 backdrop-blur">
            <div className="flex items-center gap-3 px-4 py-3 sm:px-6 sm:py-4">
              <RecordButton
                recording={isRecording}
                loading={isStarting}
                onClick={() => (isRecording ? stopRecording() : startRecording())}
              />
              <div className="hidden sm:flex items-end gap-[3px] h-10 w-32" aria-hidden>
                {audioBars.map((level, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-sm bg-accent/60 transition-all duration-75"
                    style={{
                      height: isRecording ? `${Math.max(10, level * 100)}%` : "12%",
                      opacity: isRecording ? 1 : 0.35,
                    }}
                  />
                ))}
              </div>
              <div className="flex-1" />
              {isRecording ? (
                <span className="text-xs text-muted-foreground hidden sm:inline">
                  Trykk stopp når intervjuet er ferdig — så får du detaljert rapport.
                </span>
              ) : transcript.length > 0 ? (
                <Button variant="outline" onClick={generateReport} disabled={isGeneratingReport} className="gap-1.5">
                  {isGeneratingReport ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
                  Lag rapport
                </Button>
              ) : null}
            </div>
          </footer>
        </section>
      </div>

      <InterviewReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        report={report}
        evalHistory={evalHistory}
        onExport={exportReport}
      />
    </div>
  );
}

function renderReportAsMarkdown(report: InterviewReport, transcript: TranscriptSegment[], title: string): string {
  const lines: string[] = [];
  lines.push(`# Intervjurapport${title ? `: ${title}` : ""}`);
  lines.push("");
  lines.push(`*Generert ${new Date(report.generatedAt).toLocaleString("nb-NO")}*`);
  lines.push("");
  lines.push("## Sammendrag");
  lines.push(report.summary);
  lines.push("");
  lines.push("## Score per kriterium");
  for (const key of Object.keys(report.finalScores) as (keyof InterviewScores)[]) {
    const item = report.finalScores[key];
    lines.push(`- **${interviewCriterionLabels[key]}**: ${item.score.toFixed(1)} / 10 — ${item.rationale}`);
  }
  lines.push("");
  lines.push("## Styrker");
  for (const s of report.strengths) lines.push(`- ${s}`);
  lines.push("");
  lines.push("## Forbedringspunkter");
  for (const s of report.improvements) lines.push(`- ${s}`);
  lines.push("");
  lines.push("## Full transkripsjon");
  for (const seg of transcript) {
    const t = new Date(seg.timestamp).toLocaleTimeString("no-NO", { hour: "2-digit", minute: "2-digit" });
    lines.push(`*${t}* — ${seg.text}`);
  }
  return lines.join("\n");
}
