import { cn } from "@/lib/utils";
import { Check, Minus } from "lucide-react";
import type { StarStatus } from "@shared/schema";

type Props = {
  star: StarStatus | null;
  className?: string;
};

const STAR_LABELS: Array<{ key: keyof StarStatus; label: string; description: string }> = [
  { key: "situation", label: "Situasjon", description: "Setter prosjekt og kontekst" },
  { key: "task", label: "Oppgave", description: "Hva skulle løses" },
  { key: "action", label: "Handling", description: "Hva kandidaten gjorde" },
  { key: "result", label: "Resultat", description: "Hva utfallet ble" },
];

export function StarPanel({ star, className }: Props) {
  return (
    <div className={cn("rounded-2xl border border-card-border bg-card p-4", className)}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-sm font-semibold tracking-tightish">STAR-struktur</h3>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Siste svar</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {STAR_LABELS.map((item) => {
          const filled = !!star?.[item.key];
          return (
            <div
              key={item.key}
              className={cn(
                "rounded-xl border p-2.5 transition-all duration-500",
                filled
                  ? "border-success/40 bg-success/8"
                  : "border-dashed border-border bg-muted/30"
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "grid h-5 w-5 place-items-center rounded-full transition-colors",
                    filled ? "bg-success text-success-foreground" : "bg-muted text-muted-foreground"
                  )}
                >
                  {filled ? <Check className="h-3 w-3" strokeWidth={3} /> : <Minus className="h-3 w-3" />}
                </span>
                <span className={cn("text-sm font-medium", filled ? "" : "text-muted-foreground")}>
                  {item.label}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground leading-tight pl-7">
                {item.description}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
