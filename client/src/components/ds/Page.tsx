import { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = {
  children: ReactNode;
  className?: string;
  /** Default `true` — page has standard horizontal padding + max-width */
  padded?: boolean;
};

export function Page({ children, className, padded = true }: Props) {
  if (!padded) {
    return <div className={cn("min-h-[100dvh]", className)}>{children}</div>;
  }
  return (
    <div className={cn("min-h-[100dvh]", className)}>
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8 lg:px-12 py-8 lg:py-12 space-y-10">
        {children}
      </div>
    </div>
  );
}
