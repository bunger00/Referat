import { Mic, NotebookPen, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  value: string;
  onChange: (v: string) => void;
  isRecording: boolean;
  className?: string;
};

/**
 * Brukerens egne stikkord under møtet. Inspirert av Granola sin "primary
 * canvas"-tilnærming: rotnotater her brukes som primær struktur når AI
 * genererer referat. Bare en ren textarea — ingen markdown-magi for nå,
 * brukeren kan skrive fritt.
 */
export function UserNotesPane({ value, onChange, isRecording, className }: Props) {
  const wordCount = value.trim().split(/\s+/).filter(Boolean).length;

  return (
    <section className={cn("flex flex-col h-full min-h-0 bg-card/30", className)}>
      <header className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border shrink-0">
        <h2 className="font-display text-sm font-semibold tracking-tightish flex items-center gap-2">
          <NotebookPen className="h-3.5 w-3.5 text-muted-foreground" />
          Mine notater
          {wordCount > 0 ? (
            <span className="text-xs font-normal text-muted-foreground">
              {wordCount} {wordCount === 1 ? "ord" : "ord"}
            </span>
          ) : null}
        </h2>
        <span className="hidden sm:inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/70">
          <Sparkles className="h-3 w-3" />
          AI bruker disse som primær struktur i referatet
        </span>
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={
            isRecording
              ? "Skriv stikkord underveis…\n\nF.eks.:\n– Per: rapport til mandag\n– Avklare leveringstid med UE\n– Marianne tar møtet med kunden\n– Tørkerom vs tørkeskap → vurdere\n\nAI bruker dette som primær struktur når referatet lages."
              : "Skriv stikkord her — AI flettes dem inn i referatet med transkript-kontekst når møtet er ferdig."
          }
          className="w-full h-full min-h-[300px] resize-none border-0 rounded-none bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 px-4 py-4 text-sm leading-relaxed font-sans"
        />
      </div>
    </section>
  );
}
