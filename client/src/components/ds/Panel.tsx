import { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = {
  children?: ReactNode;
  className?: string;
  /** "elevated" = card with shadow, "flat" = subtle border only, "ghost" = no chrome */
  variant?: "elevated" | "flat" | "ghost";
};

export function Panel({ children, className, variant = "flat" }: Props) {
  return (
    <div
      className={cn(
        "rounded-2xl",
        variant === "elevated" && "bg-card border border-card-border shadow-md",
        variant === "flat" && "bg-card border border-card-border",
        variant === "ghost" && "bg-transparent",
        className
      )}
    >
      {children}
    </div>
  );
}
