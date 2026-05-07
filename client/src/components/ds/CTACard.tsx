import { ReactNode } from "react";
import { LucideIcon, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  icon: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  onClick?: () => void;
  href?: string;
  /** If `accent`, paints with corall accent. If `primary`, fjord-teal. */
  tone?: "primary" | "accent" | "muted";
  className?: string;
};

export function CTACard({ icon: Icon, title, description, onClick, href, tone = "muted", className }: Props) {
  const Tag: any = href ? "a" : "button";
  const toneClasses =
    tone === "accent"
      ? "bg-accent text-accent-foreground border-transparent shadow-lg hover:shadow-xl"
      : tone === "primary"
      ? "bg-primary text-primary-foreground border-transparent shadow-md hover:shadow-lg"
      : "bg-card text-card-foreground border-card-border hover:border-foreground/20 shadow-sm";

  return (
    <Tag
      href={href}
      onClick={onClick}
      className={cn(
        "group relative flex w-full flex-col rounded-2xl border p-6 text-left transition-all duration-200",
        "hover:-translate-y-0.5 active:translate-y-0",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/30",
        toneClasses,
        className
      )}
    >
      <div
        className={cn(
          "mb-5 grid h-11 w-11 place-items-center rounded-xl",
          tone === "muted" ? "bg-muted text-foreground" : "bg-white/10 text-current"
        )}
      >
        <Icon className="h-5 w-5" strokeWidth={2.25} />
      </div>
      <div className="space-y-1.5 mb-5">
        <h3 className="font-display text-xl font-semibold tracking-tightish leading-tight">
          {title}
        </h3>
        {description ? (
          <p className={cn("text-sm leading-relaxed", tone === "muted" ? "text-muted-foreground" : "opacity-90")}>
            {description}
          </p>
        ) : null}
      </div>
      <div className="mt-auto inline-flex items-center gap-1.5 text-sm font-medium">
        <span>Velg</span>
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </div>
    </Tag>
  );
}
