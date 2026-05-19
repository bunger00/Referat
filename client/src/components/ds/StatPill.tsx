import { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "success" | "warning" | "decision" | "suggestion" | "accent";

type Props = {
  tone?: Tone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
};

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground border-border",
  success: "bg-success/10 text-success border-success/30",
  warning: "bg-warning/15 text-warning border-warning/40",
  decision: "bg-decision/12 text-decision border-decision/30",
  suggestion: "bg-suggestion/10 text-suggestion border-suggestion/30",
  accent: "bg-accent/12 text-accent border-accent/30",
};

export function StatPill({ tone = "neutral", icon, children, className }: Props) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        TONE_CLASSES[tone],
        className
      )}
    >
      {icon}
      {children}
    </span>
  );
}
