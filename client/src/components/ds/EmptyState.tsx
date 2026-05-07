import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

type Props = {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function EmptyState({ icon: Icon, title, description, actions, className }: Props) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-dashed border-border bg-card/40 px-8 py-12 text-center",
        className
      )}
    >
      {Icon ? (
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
          <Icon className="h-6 w-6" strokeWidth={1.75} />
        </div>
      ) : null}
      <h3 className="font-display text-xl font-semibold tracking-tightish text-foreground">
        {title}
      </h3>
      {description ? (
        <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
          {description}
        </p>
      ) : null}
      {actions ? <div className="mt-6 flex flex-wrap items-center justify-center gap-2">{actions}</div> : null}
    </div>
  );
}
