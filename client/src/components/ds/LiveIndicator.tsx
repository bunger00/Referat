import { cn } from "@/lib/utils";

type Props = {
  active?: boolean;
  label?: string;
  className?: string;
};

export function LiveIndicator({ active = true, label = "Tar opp", className }: Props) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium",
        active
          ? "border-accent/30 bg-accent/10 text-accent"
          : "border-border bg-muted text-muted-foreground",
        className
      )}
    >
      <span
        className={cn(
          "h-2 w-2 rounded-full",
          active ? "bg-accent pulse-dot" : "bg-muted-foreground/50"
        )}
      />
      {label}
    </span>
  );
}
