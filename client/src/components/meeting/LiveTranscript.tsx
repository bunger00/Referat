import { forwardRef } from "react";
import { Mic, Loader2, Sparkles } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { OnboardingHint } from "@/components/ds";
import type { TranscriptSegment } from "@shared/schema";

type Props = {
  segments: TranscriptSegment[];
  isRecording: boolean;
  isCleaning?: boolean;
  audioLevels?: number[];
  onCleanTranscript: () => void;
  onSelectionChange?: () => void;
  endRef?: React.RefObject<HTMLDivElement>;
};

export const LiveTranscript = forwardRef<HTMLDivElement, Props>(function LiveTranscript(
  { segments, isRecording, isCleaning, audioLevels, onCleanTranscript, onSelectionChange, endRef },
  scrollRef
) {
  return (
    <section className="flex flex-col h-full min-h-0 bg-card/30">
      <header className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border shrink-0">
        <h2 className="font-display text-sm font-semibold tracking-tightish flex items-center gap-2">
          <Mic className="h-3.5 w-3.5 text-muted-foreground" />
          Transkript
          {segments.length > 0 ? (
            <span className="text-xs font-normal text-muted-foreground">
              {segments.length} segmenter
            </span>
          ) : null}
        </h2>
        {segments.length > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onCleanTranscript}
            disabled={isCleaning}
            className="h-7 text-xs gap-1 text-muted-foreground"
          >
            {isCleaning ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            Rens
          </Button>
        ) : null}
      </header>

      <ScrollArea className="flex-1 min-h-0" ref={scrollRef as any}>
        <div
          className="px-4 py-4 space-y-3"
          onMouseUp={onSelectionChange}
        >
          {segments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center px-4 gap-4">
              {isRecording && audioLevels ? (
                <>
                  <div className="flex items-end gap-[3px] h-12">
                    {audioLevels.map((level, i) => (
                      <div
                        key={i}
                        className="w-1 rounded-sm bg-accent transition-all duration-75"
                        style={{ height: `${Math.max(15, level * 100)}%` }}
                      />
                    ))}
                  </div>
                  <p className="text-sm text-muted-foreground">Lytter etter tale…</p>
                  <OnboardingHint
                    hintKey="firstRecording"
                    title="AI er i gang"
                    description="Etter ~1 min får du de første spørsmålsforslagene. Aksjoner og beslutninger fanges automatisk."
                    className="max-w-sm"
                  />
                </>
              ) : (
                <>
                  <Mic className="h-10 w-10 text-muted-foreground/50" strokeWidth={1.5} />
                  <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
                    Trykk på opptaksknappen nederst for å begynne. Transkriptet dukker opp her i sanntid.
                  </p>
                </>
              )}
            </div>
          ) : (
            segments.map((segment) => (
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
          <div ref={endRef} />
        </div>
      </ScrollArea>
    </section>
  );
});
