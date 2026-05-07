import { useEffect, useRef, useState } from "react";
import { Check, X, ArrowRightLeft, UserCircle2, CalendarDays, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionItem } from "@shared/schema";

type Props = {
  action: ActionItem;
  index?: number;
  onApprove: (id: string, edits: { text: string; owner: string; deadline: string }) => void;
  onReject: (id: string) => void;
  onMoveToDecision: (id: string) => void;
  onRemove?: (id: string) => void;
  /** When true, card opens in inline-edit mode immediately */
  autoExpand?: boolean;
};

function formatDeadline(value: string | undefined | null): string {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(value + "T12:00:00").toLocaleDateString("nb-NO", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }
  return value;
}

function formatClock(iso: string | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("no-NO", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function ActionCard({
  action,
  index,
  onApprove,
  onReject,
  onMoveToDecision,
  onRemove,
  autoExpand,
}: Props) {
  const isApproved = action.status === "approved";
  const isProposed = action.status === "proposed";
  const [expanded, setExpanded] = useState(!!autoExpand && isProposed);
  const [text, setText] = useState(action.text);
  const [owner, setOwner] = useState(action.suggestedOwner ?? "");
  const [deadline, setDeadline] = useState(
    /^\d{4}-\d{2}-\d{2}$/.test(action.suggestedDeadline ?? "") ? action.suggestedDeadline! : ""
  );
  const textRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setText(action.text);
    setOwner(action.suggestedOwner ?? "");
    const sd = action.suggestedDeadline ?? "";
    setDeadline(/^\d{4}-\d{2}-\d{2}$/.test(sd) ? sd : "");
  }, [action.id, action.text, action.suggestedOwner, action.suggestedDeadline]);

  useEffect(() => {
    if (expanded) {
      requestAnimationFrame(() => textRef.current?.focus());
    }
  }, [expanded]);

  const handleApprove = () => {
    onApprove(action.id, {
      text: text.trim() || action.text,
      owner: owner.trim(),
      deadline: deadline.trim(),
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!expanded) return;
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleApprove();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setExpanded(false);
    }
  };

  if (isApproved) {
    return (
      <div
        className={cn(
          "group flex items-start gap-3 rounded-xl border p-3 transition-colors",
          action.source === "manual"
            ? "border-warning/40 bg-warning/5"
            : "border-success/30 bg-success/5"
        )}
      >
        <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-success/15 text-[10px] font-bold text-success">
          {index !== undefined ? index + 1 : <Check className="h-3 w-3" />}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm leading-snug">{action.text}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {action.owner ? (
              <span className="inline-flex items-center gap-1">
                <UserCircle2 className="h-3 w-3" />
                {action.owner}
              </span>
            ) : null}
            {action.deadline ? (
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="h-3 w-3" />
                {formatDeadline(action.deadline)}
              </span>
            ) : null}
            {action.createdAt ? (
              <span className="font-mono text-muted-foreground/70">
                {formatClock(action.createdAt)}
              </span>
            ) : null}
          </div>
        </div>
        {onRemove ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onRemove(action.id)}
            aria-label="Fjern aksjon"
            className="opacity-0 group-hover:opacity-100 transition-opacity h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>
    );
  }

  // Proposed
  return (
    <div
      onKeyDown={handleKeyDown}
      className={cn(
        "rounded-xl border bg-card p-3 transition-shadow",
        expanded ? "border-suggestion shadow-sm" : "border-suggestion/30 hover:border-suggestion/60"
      )}
    >
      {!expanded ? (
        <>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="text-left w-full"
            aria-label="Rediger og godkjenn"
          >
            <p className="text-sm font-medium leading-snug">{action.text}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {action.suggestedOwner ? (
                <span className="inline-flex items-center gap-1">
                  <UserCircle2 className="h-3 w-3" />
                  {action.suggestedOwner}
                </span>
              ) : null}
              {action.suggestedDeadline ? (
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="h-3 w-3" />
                  {action.suggestedDeadline}
                </span>
              ) : null}
              {action.createdAt ? (
                <span className="font-mono text-muted-foreground/70">
                  {formatClock(action.createdAt)}
                </span>
              ) : null}
            </div>
          </button>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              onClick={() => setExpanded(true)}
              className="h-7 px-2.5 text-xs gap-1 bg-success text-success-foreground hover:bg-success/90"
            >
              <Check className="h-3.5 w-3.5" />
              Godkjenn
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onMoveToDecision(action.id)}
              className="h-7 px-2 text-xs gap-1 text-decision hover:bg-decision/10"
              title="Flytt til beslutninger"
            >
              <ArrowRightLeft className="h-3 w-3" />
              Til beslutning
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onReject(action.id)}
              className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-destructive"
            >
              <X className="h-3.5 w-3.5" />
              Avvis
            </Button>
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-suggestion">
            <Pencil className="h-3 w-3" />
            Rediger og godkjenn
          </div>
          <Input
            ref={textRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Aksjonspunkt"
            className="h-9 text-sm font-medium"
          />
          <div className="grid grid-cols-2 gap-2">
            <div className="relative">
              <UserCircle2 className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                placeholder="Ansvarlig"
                className="h-9 text-sm pl-8"
              />
            </div>
            <div className="relative">
              <CalendarDays className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none z-10" />
              <input
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="h-9 w-full text-sm pl-8 pr-2 rounded-md border border-input bg-background text-foreground [color-scheme:light] dark:[color-scheme:dark] focus:outline-none focus:ring-2 focus:ring-ring/40"
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="text-[10px] text-muted-foreground">
              <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono">⌘ Enter</kbd> godkjenn ·{" "}
              <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono">Esc</kbd> lukk
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setExpanded(false)}
                className="h-7 text-xs"
              >
                Avbryt
              </Button>
              <Button
                size="sm"
                onClick={handleApprove}
                className="h-7 px-3 text-xs gap-1 bg-success text-success-foreground hover:bg-success/90"
              >
                <Check className="h-3.5 w-3.5" />
                Godkjenn
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
