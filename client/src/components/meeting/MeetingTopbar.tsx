import { ReactNode } from "react";
import { Clock, ScrollText, Loader2, ChevronDown } from "lucide-react";
import { LiveIndicator, StatPill } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Props = {
  title: string;
  onTitleChange: (v: string) => void;
  elapsedSeconds: number;
  isRecording: boolean;
  isProcessing?: boolean;
  transcriptionEngine?: string | null;
  onGenerateSummary: () => void;
  isGeneratingSummary?: boolean;
  hasSummary?: boolean;
  /** Right-side menu (kebab dropdown content) — passed by caller */
  menu?: ReactNode;
};

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

export function MeetingTopbar({
  title,
  onTitleChange,
  elapsedSeconds,
  isRecording,
  isProcessing,
  transcriptionEngine,
  onGenerateSummary,
  isGeneratingSummary,
  hasSummary,
  menu,
}: Props) {
  return (
    <header className="shrink-0 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="flex items-center gap-3 px-4 py-2.5 sm:px-6">
        {/* Title input */}
        <Input
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Møtetittel…"
          className="border-0 bg-transparent px-0 h-9 font-display text-lg sm:text-xl font-semibold tracking-tightish focus-visible:ring-0 focus-visible:ring-offset-0 max-w-md min-w-0"
        />

        {/* Timer */}
        <div className="hidden sm:flex items-center gap-1.5 text-muted-foreground shrink-0">
          <Clock className="h-3.5 w-3.5" />
          <span className="font-mono text-sm tabular-nums">{formatTime(elapsedSeconds)}</span>
        </div>

        {isRecording ? <LiveIndicator label="Tar opp" /> : null}

        {isProcessing ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : null}

        {transcriptionEngine ? (
          <StatPill
            tone={transcriptionEngine.startsWith("nb-whisper") ? "success" : "warning"}
            className="hidden md:inline-flex"
          >
            {transcriptionEngine.startsWith("nb-whisper") ? "🇳🇴" : "⚡"} {transcriptionEngine}
          </StatPill>
        ) : null}

        <div className="flex-1" />

        {/* Generate summary CTA */}
        <Button
          variant="default"
          size="sm"
          onClick={onGenerateSummary}
          disabled={isGeneratingSummary}
          className="gap-1.5 shrink-0"
        >
          {isGeneratingSummary ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ScrollText className="h-4 w-4" />
          )}
          <span className="hidden sm:inline">{hasSummary ? "Vis referat" : "Lag referat"}</span>
        </Button>

        {menu}
      </div>
    </header>
  );
}
