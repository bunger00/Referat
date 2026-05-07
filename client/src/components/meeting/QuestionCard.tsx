import { Check, X, Pencil, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StatPill } from "@/components/ds";
import type { Question, ExpertRole } from "@shared/schema";
import { expertRoleLabels } from "@shared/schema";

type Props = {
  question: Question;
  variant: "active" | "saved";
  onSave?: (id: string) => void;
  onDelete?: (id: string) => void;
  onEdit?: (q: Question) => void;
  onRemove?: (id: string) => void;
};

export function QuestionCard({ question, variant, onSave, onDelete, onEdit, onRemove }: Props) {
  const isCrossMeeting = question.type === "cross_meeting";

  return (
    <div
      className={cn(
        "rounded-xl border p-3 space-y-2",
        isCrossMeeting
          ? "border-destructive/40 bg-destructive/5"
          : variant === "saved"
          ? "border-primary/30 bg-primary/5"
          : "border-card-border bg-card hover:border-foreground/20"
      )}
    >
      <div className="flex items-start gap-2">
        {isCrossMeeting ? (
          <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
        ) : variant === "saved" ? (
          <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
        ) : null}
        <p
          className={cn(
            "flex-1 text-sm leading-snug",
            isCrossMeeting ? "font-medium" : ""
          )}
        >
          {question.text}
        </p>
        <div className="flex shrink-0 items-center gap-0.5">
          {variant === "active" && onSave ? (
            <Button
              size="icon"
              variant="ghost"
              onClick={() => onSave(question.id)}
              aria-label="Lagre spørsmål"
              className="h-7 w-7 text-success hover:bg-success/10"
            >
              <Check className="h-4 w-4" />
            </Button>
          ) : null}
          {variant === "saved" && onEdit ? (
            <Button
              size="icon"
              variant="ghost"
              onClick={() => onEdit(question)}
              aria-label="Rediger spørsmål"
              className="h-7 w-7"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          <Button
            size="icon"
            variant="ghost"
            onClick={() =>
              variant === "saved" ? onRemove?.(question.id) : onDelete?.(question.id)
            }
            aria-label={variant === "saved" ? "Fjern" : "Slett"}
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {(isCrossMeeting || question.expertRole || question.annotation) ? (
        <div className="flex flex-wrap items-center gap-1.5 pl-6">
          {isCrossMeeting ? (
            <StatPill tone="warning">Motstrid fra tidligere møte</StatPill>
          ) : question.expertRole ? (
            <StatPill>{expertRoleLabels[question.expertRole as ExpertRole]}</StatPill>
          ) : null}
          {question.annotation ? (
            <span className="text-xs italic text-muted-foreground">
              Notat: {question.annotation}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
