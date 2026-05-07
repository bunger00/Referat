import { useState } from "react";
import { Plus, X, UserCircle2, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type ActionFields = { text: string; owner: string; deadline: string };
type DecisionFields = { text: string; owner: string; context: string };

type Props =
  | {
      kind: "action";
      onAdd: (fields: ActionFields) => void;
    }
  | {
      kind: "decision";
      onAdd: (fields: DecisionFields) => void;
    };

export function ManualAddInline(props: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [owner, setOwner] = useState("");
  const [deadline, setDeadline] = useState("");
  const [context, setContext] = useState("");

  const reset = () => {
    setText("");
    setOwner("");
    setDeadline("");
    setContext("");
    setOpen(false);
  };

  const submit = () => {
    if (!text.trim()) return;
    if (props.kind === "action") {
      props.onAdd({ text: text.trim(), owner: owner.trim(), deadline: deadline.trim() });
    } else {
      props.onAdd({ text: text.trim(), owner: owner.trim(), context: context.trim() });
    }
    reset();
  };

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="w-full justify-center gap-1.5 h-9 text-xs text-muted-foreground hover:text-foreground border border-dashed border-border"
      >
        <Plus className="h-3.5 w-3.5" />
        Legg til {props.kind === "action" ? "aksjon" : "beslutning"} manuelt
      </Button>
    );
  }

  return (
    <div className="rounded-xl border border-warning/40 bg-warning/5 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-warning-foreground">
          Manuelt {props.kind === "action" ? "aksjonspunkt" : "beslutning"}
        </span>
        <Button variant="ghost" size="icon" onClick={reset} className="h-6 w-6">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      {props.kind === "action" ? (
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Beskriv aksjonspunktet…"
          className="h-9 text-sm"
          onKeyDown={(e) => e.key === "Enter" && submit()}
          autoFocus
        />
      ) : (
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Beskriv beslutningen…"
          className="text-sm min-h-[60px]"
          rows={2}
          autoFocus
        />
      )}
      <div className="grid grid-cols-2 gap-2">
        <div className="relative">
          <UserCircle2 className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            placeholder="Ansvarlig"
            className="h-9 text-sm pl-8"
          />
        </div>
        {props.kind === "action" ? (
          <div className="relative">
            <CalendarDays className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none z-10" />
            <input
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="h-9 w-full text-sm pl-8 pr-2 rounded-md border border-input bg-background text-foreground [color-scheme:light] dark:[color-scheme:dark] focus:outline-none focus:ring-2 focus:ring-ring/40"
            />
          </div>
        ) : (
          <Input
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="Kontekst (valgfritt)"
            className="h-9 text-sm"
          />
        )}
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={reset} className="h-7 text-xs">
          Avbryt
        </Button>
        <Button size="sm" onClick={submit} disabled={!text.trim()} className="h-7 text-xs">
          Legg til
        </Button>
      </div>
    </div>
  );
}
