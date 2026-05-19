import { useEffect, useRef, useState } from "react";
import { Check, X, ArrowRightLeft, UserCircle2, Quote, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ProposedDecision } from "@shared/schema";

function formatClock(iso: string | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("no-NO", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

type Props = {
  decision: ProposedDecision;
  index?: number;
  onConfirm: (id: string, edits: { text: string }) => void;
  onReject: (id: string) => void;
  onMoveToAction: (id: string) => void;
  onRemove?: (id: string) => void;
  /** Re-edit av allerede bekreftet beslutning. Lar bruker rette feil i tekst
   * uten å nullstille status. Hvis ikke angitt, vises ingen pencil-knapp på bekreftede kort. */
  onUpdate?: (id: string, edits: { text: string }) => void;
  autoExpand?: boolean;
};

export function DecisionCard({
  decision,
  index,
  onConfirm,
  onReject,
  onMoveToAction,
  onRemove,
  onUpdate,
  autoExpand,
}: Props) {
  const isConfirmed = decision.status === "confirmed";
  const isProposed = decision.status === "proposed";
  const [expanded, setExpanded] = useState(!!autoExpand && isProposed);
  const [text, setText] = useState(decision.text);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setText(decision.text);
  }, [decision.id, decision.text]);

  useEffect(() => {
    if (expanded) requestAnimationFrame(() => textRef.current?.focus());
  }, [expanded]);

  const handleSave = () => {
    const edits = { text: text.trim() || decision.text };
    if (isConfirmed) {
      onUpdate?.(decision.id, edits);
    } else {
      onConfirm(decision.id, edits);
    }
    setExpanded(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!expanded) return;
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setExpanded(false);
    }
  };

  const editFormJsx = (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-decision">
        <Pencil className="h-3 w-3" />
        {isConfirmed ? "Rediger beslutning" : "Rediger og bekreft"}
      </div>
      <Textarea
        ref={textRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Beslutning"
        className="text-sm font-medium min-h-[60px]"
        rows={2}
      />
      {decision.context ? (
        <p className="text-xs italic text-muted-foreground border-l-2 border-decision/40 pl-2">
          "{decision.context}"
        </p>
      ) : null}
      <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 pt-1">
        <div className="hidden sm:block text-[10px] text-muted-foreground">
          <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono">⌘ Enter</kbd> {isConfirmed ? "lagre" : "bekreft"} ·{" "}
          <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono">Esc</kbd> lukk
        </div>
        <div className="grid grid-cols-2 gap-1.5 sm:flex sm:items-center">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setExpanded(false)}
            className="h-10 sm:h-8 text-sm sm:text-xs"
          >
            Avbryt
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            className="h-10 sm:h-8 px-3 text-sm sm:text-xs gap-1.5 bg-decision text-decision-foreground hover:bg-decision/90"
          >
            <Check className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
            {isConfirmed ? "Lagre" : "Bekreft"}
          </Button>
        </div>
      </div>
    </div>
  );

  if (isConfirmed && expanded) {
    return (
      <div
        onKeyDown={handleKeyDown}
        className="rounded-xl border bg-card p-3 border-decision shadow-sm transition-shadow"
      >
        {editFormJsx}
      </div>
    );
  }

  if (isConfirmed) {
    return (
      <div
        className={cn(
          "group flex items-start gap-3 rounded-xl border p-3",
          decision.source === "manual"
            ? "border-warning/40 bg-warning/5"
            : "border-decision/30 bg-decision/5"
        )}
      >
        <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-decision/15 text-[10px] font-bold text-decision">
          {index !== undefined ? index + 1 : <Check className="h-3 w-3" />}
        </span>
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-sm leading-snug">{decision.text}</p>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {decision.owner ? (
              <span className="inline-flex items-center gap-1">
                <UserCircle2 className="h-3 w-3" />
                {decision.owner}
              </span>
            ) : null}
            {decision.createdAt ? (
              <span className="font-mono text-muted-foreground/70">
                {formatClock(decision.createdAt)}
              </span>
            ) : null}
          </div>
          {decision.context ? (
            <p className="text-xs italic text-muted-foreground">"{decision.context}"</p>
          ) : null}
        </div>
        <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          {onUpdate ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setExpanded(true)}
              aria-label="Rediger beslutning"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          {onRemove ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onRemove(decision.id)}
              aria-label="Fjern beslutning"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div
      onKeyDown={handleKeyDown}
      className={cn(
        "rounded-xl border bg-card p-3 transition-shadow",
        expanded ? "border-decision shadow-sm" : "border-decision/30 hover:border-decision/60"
      )}
    >
      {!expanded ? (
        <>
          <div className="space-y-1.5">
            <p className="text-sm font-medium leading-snug">{decision.text}</p>
            {decision.createdAt ? (
              <p className="text-xs text-muted-foreground/70 font-mono">
                {formatClock(decision.createdAt)}
              </p>
            ) : null}
            {decision.context ? (
              <p className="text-xs italic text-muted-foreground inline-flex items-start gap-1">
                <Quote className="h-3 w-3 mt-0.5 shrink-0" />
                <span>"{decision.context}"</span>
              </p>
            ) : null}
          </div>
          {/* Én-tap "Bekreft" på mobil. "Rediger" åpner inline-edit. */}
          <div className="mt-3 grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap sm:items-center">
            <Button
              size="sm"
              onClick={() => onConfirm(decision.id, { text: decision.text })}
              className="h-10 sm:h-8 px-3 text-sm sm:text-xs gap-1.5 bg-decision text-decision-foreground hover:bg-decision/90"
            >
              <Check className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
              Bekreft
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setExpanded(true)}
              className="h-10 sm:h-8 px-3 text-sm sm:text-xs gap-1.5"
              aria-label="Rediger og bekreft"
            >
              <Pencil className="h-3.5 w-3.5" />
              Rediger
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onMoveToAction(decision.id)}
              className="h-10 sm:h-8 px-3 text-sm sm:text-xs gap-1.5 text-success hover:bg-success/10"
              title="Flytt til aksjoner"
            >
              <ArrowRightLeft className="h-3.5 w-3.5" />
              Til aksjon
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onReject(decision.id)}
              className="h-10 sm:h-8 px-3 text-sm sm:text-xs gap-1.5 text-muted-foreground hover:text-destructive"
            >
              <X className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
              Avvis
            </Button>
          </div>
        </>
      ) : (
        editFormJsx
      )}
    </div>
  );
}
