import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Sparkles, TrendingUp, AlertCircle } from "lucide-react";
import { Speedometer } from "./Speedometer";
import { interviewCriterionLabels, type InterviewCriterion, type InterviewReport, type InterviewEvalSnapshot } from "@shared/schema";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  report: InterviewReport | null;
  evalHistory: InterviewEvalSnapshot[];
  onExport?: () => void;
};

const CRITERIA: InterviewCriterion[] = ["konkretisering", "fagdybde", "eierskap", "refleksjon", "samhandling", "struktur"];

export function InterviewReportDialog({ open, onOpenChange, report, evalHistory, onExport }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl tracking-display">
            Intervjurapport
          </DialogTitle>
        </DialogHeader>

        {!report ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            Ingen rapport ennå.
          </p>
        ) : (
          <div className="space-y-6">
            {/* Summary */}
            <section>
              <p className="text-base leading-relaxed">{report.summary}</p>
            </section>

            {/* Speedometers */}
            <section className="grid grid-cols-2 sm:grid-cols-3 gap-3 py-2">
              {CRITERIA.map((c) => {
                const item = report.finalScores[c];
                return (
                  <Speedometer
                    key={c}
                    score={item.score}
                    label={interviewCriterionLabels[c]}
                    rationale={item.rationale}
                    size="md"
                  />
                );
              })}
            </section>

            {/* Trend */}
            {evalHistory.length >= 2 ? (
              <section>
                <h3 className="font-display text-base font-semibold tracking-tightish mb-3 inline-flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-suggestion" />
                  Trend gjennom intervjuet
                </h3>
                <div className="rounded-xl border border-card-border bg-card p-4">
                  <TrendChart history={evalHistory} />
                </div>
              </section>
            ) : null}

            {/* Strengths */}
            <section>
              <h3 className="font-display text-base font-semibold tracking-tightish mb-2 inline-flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-success" />
                Styrker
              </h3>
              <ul className="space-y-2">
                {report.strengths.map((s, i) => (
                  <li key={i} className="flex gap-2 text-sm">
                    <span className="text-success shrink-0 mt-0.5">▸</span>
                    <span className="leading-relaxed">{s}</span>
                  </li>
                ))}
              </ul>
            </section>

            {/* Improvements */}
            <section>
              <h3 className="font-display text-base font-semibold tracking-tightish mb-2 inline-flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-warning" />
                Forbedringspunkter
              </h3>
              <ul className="space-y-2">
                {report.improvements.map((s, i) => (
                  <li key={i} className="flex gap-2 text-sm">
                    <span className="text-warning shrink-0 mt-0.5">▸</span>
                    <span className="leading-relaxed">{s}</span>
                  </li>
                ))}
              </ul>
            </section>

            {/* Actions */}
            {onExport ? (
              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                <Button variant="outline" onClick={onExport}>
                  <Download className="h-4 w-4 mr-2" />
                  Eksporter som markdown
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const COLORS: Record<InterviewCriterion, string> = {
  konkretisering: "hsl(195 50% 55%)",
  fagdybde: "hsl(280 35% 60%)",
  eierskap: "hsl(8 70% 56%)",
  refleksjon: "hsl(150 40% 50%)",
  samhandling: "hsl(35 78% 55%)",
  struktur: "hsl(220 30% 50%)",
};

function TrendChart({ history }: { history: InterviewEvalSnapshot[] }) {
  if (history.length < 2) return null;

  const W = 600;
  const H = 200;
  const PADX = 30;
  const PADY = 20;

  const xFor = (i: number) => PADX + ((W - PADX * 2) * i) / Math.max(1, history.length - 1);
  const yFor = (s: number) => H - PADY - ((H - PADY * 2) * s) / 10;

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-48">
        {/* Grid lines */}
        {[0, 2, 4, 6, 8, 10].map((v) => (
          <g key={v}>
            <line
              x1={PADX}
              y1={yFor(v)}
              x2={W - PADX}
              y2={yFor(v)}
              stroke="hsl(var(--border))"
              strokeOpacity={0.3}
              strokeDasharray="2 4"
            />
            <text x={4} y={yFor(v) + 4} fontSize={10} fill="hsl(var(--muted-foreground))">
              {v}
            </text>
          </g>
        ))}

        {/* Lines per criterion */}
        {CRITERIA.map((c) => {
          const path = history
            .map((h, i) => `${i === 0 ? "M" : "L"} ${xFor(i)} ${yFor(h.scores[c].score)}`)
            .join(" ");
          return (
            <g key={c}>
              <path d={path} fill="none" stroke={COLORS[c]} strokeWidth={2.5} strokeLinecap="round" />
              {history.map((h, i) => (
                <circle
                  key={i}
                  cx={xFor(i)}
                  cy={yFor(h.scores[c].score)}
                  r={3}
                  fill={COLORS[c]}
                />
              ))}
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
        {CRITERIA.map((c) => (
          <span key={c} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: COLORS[c] }} />
            {interviewCriterionLabels[c]}
          </span>
        ))}
      </div>
    </div>
  );
}
