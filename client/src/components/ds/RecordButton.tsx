import { Mic, Square, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  recording: boolean;
  loading?: boolean;
  onClick: () => void;
  size?: "lg" | "md";
  disabled?: boolean;
};

export function RecordButton({ recording, loading, onClick, size = "lg", disabled }: Props) {
  const dim = size === "lg" ? "h-16 w-16" : "h-12 w-12";
  const iconDim = size === "lg" ? "h-7 w-7" : "h-5 w-5";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      aria-label={recording ? "Stopp opptak" : "Start opptak"}
      aria-pressed={recording}
      className={cn(
        "relative grid place-items-center rounded-full transition-all duration-200",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        dim,
        recording
          ? "bg-accent text-accent-foreground pulse-recording shadow-lg"
          : "bg-primary text-primary-foreground hover:scale-[1.02] active:scale-[0.98] shadow-md"
      )}
    >
      {loading ? (
        <Loader2 className={cn(iconDim, "animate-spin")} />
      ) : recording ? (
        <Square className={cn(iconDim, "fill-current")} strokeWidth={0} />
      ) : (
        <Mic className={iconDim} strokeWidth={2.25} />
      )}
    </button>
  );
}
