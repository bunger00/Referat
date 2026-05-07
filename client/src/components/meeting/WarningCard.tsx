import { useState } from "react";
import { AlertTriangle, X, ChevronDown, ChevronUp, Quote, BookOpen, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StatPill } from "@/components/ds";
import type { Warning } from "@shared/schema";

type Props = {
  warning: Warning;
  onDismiss: (id: string) => void;
};

export function WarningCard({ warning, onDismiss }: Props) {
  const [expanded, setExpanded] = useState(false);
  const isViolation = warning.level === "violation";

  return (
    <div
      className={cn(
        "rounded-xl border p-3.5",
        isViolation
          ? "border-destructive/40 bg-destructive/5"
          : "border-warning/40 bg-warning/5"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <StatPill tone={isViolation ? "warning" : "warning"} icon={<AlertTriangle className="h-3 w-3" />}>
              {isViolation ? "Brudd" : "Risiko"}
            </StatPill>
            <span className="text-sm font-medium leading-tight">{warning.title}</span>
          </div>
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded ? "Skjul detaljer" : "Vis detaljer"}
          </button>
          {expanded ? (
            <div className="mt-2.5 space-y-2.5 text-xs">
              <p className="leading-relaxed">{warning.explanation}</p>
              {warning.transcript_snippet ? (
                <p className="inline-flex items-start gap-1.5 italic text-muted-foreground">
                  <Quote className="h-3 w-3 mt-0.5 shrink-0" />
                  <span>"{warning.transcript_snippet}"</span>
                </p>
              ) : null}
              {warning.rule_reference ? (
                <div className="rounded-lg bg-muted/60 p-2.5">
                  <div className="flex items-center gap-1.5 font-medium">
                    <BookOpen className="h-3 w-3 text-muted-foreground" />
                    {warning.rule_reference.document_name} · {warning.rule_reference.section}
                  </div>
                  <p className="mt-1 text-muted-foreground leading-relaxed">
                    {warning.rule_reference.summary}
                  </p>
                </div>
              ) : null}
              {warning.suggested_questions?.length ? (
                <div>
                  <p className="font-medium inline-flex items-center gap-1.5">
                    <Lightbulb className="h-3 w-3 text-suggestion" />
                    Foreslåtte oppfølgingsspørsmål
                  </p>
                  <ul className="mt-1 list-disc list-inside space-y-0.5 text-muted-foreground">
                    {warning.suggested_questions.map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onDismiss(warning.id)}
          aria-label="Skjul advarsel"
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
