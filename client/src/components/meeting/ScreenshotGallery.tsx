import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Trash2, Loader2, ImageIcon } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { MeetingScreenshot } from "@shared/schema";

type Props = {
  screenshots: MeetingScreenshot[];
  onToggleInclude: (id: number, included: boolean) => void;
  onDelete: (id: number) => void;
  className?: string;
};

export function ScreenshotGallery({ screenshots, onToggleInclude, onDelete, className }: Props) {
  const [zoomed, setZoomed] = useState<MeetingScreenshot | null>(null);

  if (screenshots.length === 0) {
    return (
      <div className={cn("rounded-2xl border border-dashed border-border p-6 text-center", className)}>
        <ImageIcon className="h-7 w-7 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">
          Ingen skjermbilder fanget ennå. Aktiver skjermdeling og trykk "Fang skjermbilde" for å lagre relevante visninger til referatet.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      {screenshots.map((s) => (
        <div
          key={s.id}
          className={cn(
            "rounded-xl border bg-card p-3 transition-colors",
            s.includedInSummary ? "border-success/40 bg-success/5" : "border-card-border"
          )}
        >
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setZoomed(s)}
              className="shrink-0 group"
            >
              <img
                src={`data:${s.mimeType};base64,${stripDataUrlPrefix(s.imageData)}`}
                alt={s.description.slice(0, 80)}
                className="h-24 w-32 sm:h-28 sm:w-40 rounded-lg object-cover border border-card-border group-hover:opacity-90 transition-opacity"
                loading="lazy"
              />
            </button>
            <div className="flex-1 min-w-0 flex flex-col">
              <div className="flex items-start justify-between gap-2">
                <span className="text-[11px] text-muted-foreground/70 font-mono">
                  {new Date(s.capturedAt).toLocaleTimeString("no-NO", { hour: "2-digit", minute: "2-digit" })}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onDelete(s.id)}
                  aria-label="Slett skjermbilde"
                  className="h-9 w-9 sm:h-7 sm:w-7 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className="mt-1 text-sm leading-snug line-clamp-3">{s.description}</p>
              <label className="mt-auto inline-flex items-center gap-2 text-xs cursor-pointer pt-2">
                <Switch
                  checked={s.includedInSummary}
                  onCheckedChange={(v) => onToggleInclude(s.id, v)}
                />
                <span className={s.includedInSummary ? "text-success font-medium" : "text-muted-foreground"}>
                  {s.includedInSummary ? "Inkludert i referat" : "Ikke i referat"}
                </span>
              </label>
            </div>
          </div>
        </div>
      ))}

      {zoomed ? (
        <div
          className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setZoomed(null)}
        >
          <img
            src={`data:${zoomed.mimeType};base64,${stripDataUrlPrefix(zoomed.imageData)}`}
            alt={zoomed.description}
            className="max-w-full max-h-full rounded-xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </div>
  );
}

function stripDataUrlPrefix(s: string): string {
  return s.startsWith("data:") ? s.split(",")[1] ?? s : s;
}
