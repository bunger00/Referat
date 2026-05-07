import { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function Section({ title, description, actions, children, className }: Props) {
  return (
    <section className={cn("space-y-4", className)}>
      {(title || description || actions) ? (
        <div className="flex items-end justify-between gap-3">
          <div>
            {title ? (
              <h2 className="font-display text-xl md:text-2xl font-semibold tracking-tightish text-foreground">
                {title}
              </h2>
            ) : null}
            {description ? (
              <p className="text-sm text-muted-foreground mt-1">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
