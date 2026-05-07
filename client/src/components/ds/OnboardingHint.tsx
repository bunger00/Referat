import { ReactNode, useEffect, useState } from "react";
import { Lightbulb, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { dismissHint, isHintDismissed, type HintKey } from "@/lib/hints";

type Props = {
  hintKey: HintKey;
  title: ReactNode;
  description?: ReactNode;
  className?: string;
};

export function OnboardingHint({ hintKey, title, description, className }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(!isHintDismissed(hintKey));
  }, [hintKey]);

  if (!visible) return null;

  return (
    <div
      role="note"
      className={cn(
        "relative flex gap-3 rounded-xl border border-suggestion/30 bg-suggestion/5 p-4 pr-10 text-sm",
        className
      )}
    >
      <Lightbulb className="h-5 w-5 shrink-0 text-suggestion" strokeWidth={2} />
      <div className="space-y-1 min-w-0">
        <p className="font-medium text-foreground leading-snug">{title}</p>
        {description ? (
          <p className="text-muted-foreground leading-relaxed">{description}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => {
          dismissHint(hintKey);
          setVisible(false);
        }}
        aria-label="Skjul tips"
        className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover-elevate"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
