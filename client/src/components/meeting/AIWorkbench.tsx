import { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ClipboardList,
  Gavel,
  MessagesSquare,
  AlertTriangle,
  Sparkles,
  ScrollText,
  Brain,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ActionCard } from "./ActionCard";
import { DecisionCard } from "./DecisionCard";
import { WarningCard } from "./WarningCard";
import { QuestionCard } from "./QuestionCard";
import { ManualAddInline } from "./ManualAddInline";
import { OnboardingHint } from "@/components/ds";
import type { ActionItem, ProposedDecision, Question, Warning, ExpertRole } from "@shared/schema";
import { expertRoleLabels } from "@shared/schema";

type Props = {
  /* Data */
  pendingActions: ActionItem[];
  approvedActions: ActionItem[];
  pendingDecisions: ProposedDecision[];
  confirmedDecisions: ProposedDecision[];
  savedQuestions: Question[];
  groupedActiveQuestions: Record<number, Question[]>;
  sortedMinutes: number[];
  warnings: Warning[];
  isRecording: boolean;
  expertRole: ExpertRole;

  /* Action handlers */
  onApproveAction: (id: string, edits: { text: string; owner: string; deadline: string }) => void;
  onRejectAction: (id: string) => void;
  onMoveActionToDecision: (id: string) => void;
  onRemoveApprovedAction: (id: string) => void;
  onAddActionManually: (fields: { text: string; owner: string; deadline: string }) => void;

  /* Decision handlers */
  onConfirmDecision: (id: string, edits: { text: string }) => void;
  onRejectDecision: (id: string) => void;
  onMoveDecisionToAction: (id: string) => void;
  onRemoveConfirmedDecision: (id: string) => void;
  onAddDecisionManually: (fields: { text: string; owner: string; context: string }) => void;

  /* Question handlers */
  onSaveQuestion: (id: string) => void;
  onDeleteQuestion: (id: string) => void;
  onEditQuestion: (q: Question) => void;
  onRemoveSavedQuestion: (id: string) => void;

  /* Warning handlers */
  onDismissWarning: (id: string) => void;

  /* Summary slot — rendered inside the "Referat"-tab */
  summarySlot?: ReactNode;

  className?: string;
};

export function AIWorkbench(p: Props) {
  const actionsCount = p.pendingActions.length;
  const decisionsCount = p.pendingDecisions.length;
  const questionsCount = p.sortedMinutes.reduce(
    (n, m) => n + (p.groupedActiveQuestions[m]?.length ?? 0),
    0
  );
  const warningsCount = p.warnings.length;

  return (
    <Tabs defaultValue="actions" className={cn("flex flex-col min-h-0", p.className)}>
      <TabsList className="w-full justify-start rounded-none border-b border-border bg-transparent p-0 h-auto overflow-x-auto">
        <WorkbenchTab value="actions" icon={ClipboardList} label="Aksjoner" badge={actionsCount} tone="success" />
        <WorkbenchTab value="decisions" icon={Gavel} label="Beslutninger" badge={decisionsCount} tone="decision" />
        <WorkbenchTab value="questions" icon={MessagesSquare} label="Spørsmål" badge={questionsCount} tone="suggestion" />
        <WorkbenchTab
          value="warnings"
          icon={AlertTriangle}
          label="Advarsler"
          badge={warningsCount}
          tone="warning"
          pulse={warningsCount > 0}
        />
        {p.summarySlot ? (
          <WorkbenchTab value="summary" icon={ScrollText} label="Referat" />
        ) : null}
      </TabsList>

      {/* Actions */}
      <TabsContent value="actions" className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 mt-0">
        {p.pendingActions.length === 0 && p.approvedActions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center">
            <Sparkles className="h-7 w-7 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground leading-relaxed max-w-xs mx-auto">
              AI foreslår aksjonspunkter automatisk når den oppdager konkrete oppgaver eller ansvar i samtalen.
            </p>
          </div>
        ) : (
          <>
            {p.pendingActions.length > 0 ? (
              <Section label="Til vurdering" tone="suggestion" count={p.pendingActions.length}>
                <OnboardingHint
                  hintKey="firstProposal"
                  title="AI foreslår aksjoner — ett klikk for å godkjenne"
                  description="Klikk forslaget for å redigere ansvarlig og frist, eller bruk ⌘ Enter for å godkjenne raskt. Esc lukker."
                />
                {p.pendingActions.map((a) => (
                  <ActionCard
                    key={a.id}
                    action={a}
                    onApprove={p.onApproveAction}
                    onReject={p.onRejectAction}
                    onMoveToDecision={p.onMoveActionToDecision}
                  />
                ))}
              </Section>
            ) : null}
            {p.approvedActions.length > 0 ? (
              <Section label="Aksjonsliste" tone="success" count={p.approvedActions.length}>
                {p.approvedActions.map((a, i) => (
                  <ActionCard
                    key={a.id}
                    action={a}
                    index={i}
                    onApprove={p.onApproveAction}
                    onReject={p.onRejectAction}
                    onMoveToDecision={p.onMoveActionToDecision}
                    onRemove={p.onRemoveApprovedAction}
                  />
                ))}
              </Section>
            ) : null}
          </>
        )}
        <ManualAddInline kind="action" onAdd={p.onAddActionManually} />
      </TabsContent>

      {/* Decisions */}
      <TabsContent value="decisions" className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 mt-0">
        {p.pendingDecisions.length === 0 && p.confirmedDecisions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center">
            <Gavel className="h-7 w-7 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground leading-relaxed max-w-xs mx-auto">
              AI oppdager beslutninger som tas i møtet og foreslår dem for bekreftelse. Bekreftede beslutninger tas med i referatet.
            </p>
          </div>
        ) : (
          <>
            {p.pendingDecisions.length > 0 ? (
              <Section label="Til vurdering" tone="decision" count={p.pendingDecisions.length}>
                {p.pendingDecisions.map((d) => (
                  <DecisionCard
                    key={d.id}
                    decision={d}
                    onConfirm={p.onConfirmDecision}
                    onReject={p.onRejectDecision}
                    onMoveToAction={p.onMoveDecisionToAction}
                  />
                ))}
              </Section>
            ) : null}
            {p.confirmedDecisions.length > 0 ? (
              <Section label="Bekreftet" tone="decision" count={p.confirmedDecisions.length}>
                {p.confirmedDecisions.map((d, i) => (
                  <DecisionCard
                    key={d.id}
                    decision={d}
                    index={i}
                    onConfirm={p.onConfirmDecision}
                    onReject={p.onRejectDecision}
                    onMoveToAction={p.onMoveDecisionToAction}
                    onRemove={p.onRemoveConfirmedDecision}
                  />
                ))}
              </Section>
            ) : null}
          </>
        )}
        <ManualAddInline kind="decision" onAdd={p.onAddDecisionManually} />
      </TabsContent>

      {/* Questions */}
      <TabsContent value="questions" className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 mt-0">
        {p.savedQuestions.length === 0 && questionsCount === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center">
            <MessagesSquare className="h-7 w-7 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground leading-relaxed max-w-xs mx-auto">
              {p.isRecording
                ? "AI genererer spørsmålsforslag automatisk under møtet."
                : "Start opptak for å få spørsmålsforslag."}
            </p>
          </div>
        ) : (
          <>
            {p.savedQuestions.length > 0 ? (
              <Section label="Lagret" tone="primary" count={p.savedQuestions.length}>
                {p.savedQuestions.map((q) => (
                  <QuestionCard
                    key={q.id}
                    question={q}
                    variant="saved"
                    onEdit={p.onEditQuestion}
                    onRemove={p.onRemoveSavedQuestion}
                  />
                ))}
              </Section>
            ) : null}
            {p.sortedMinutes.length > 0 ? (
              <Section
                label={`Forslag · ${expertRoleLabels[p.expertRole]}`}
                tone="suggestion"
                icon={<Brain className="h-3 w-3" />}
              >
                {p.sortedMinutes.map((minute) => (
                  <div key={minute} className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      Minutt {minute}–{minute + 1}
                    </p>
                    <div className="space-y-2">
                      {p.groupedActiveQuestions[minute].map((q) => (
                        <QuestionCard
                          key={q.id}
                          question={q}
                          variant="active"
                          onSave={p.onSaveQuestion}
                          onDelete={p.onDeleteQuestion}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </Section>
            ) : null}
          </>
        )}
      </TabsContent>

      {/* Warnings */}
      <TabsContent value="warnings" className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3 mt-0">
        {p.warnings.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center">
            <AlertTriangle className="h-7 w-7 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground leading-relaxed max-w-xs mx-auto">
              Ingen regelbrudd oppdaget. AI sjekker mot regelverket du har lastet opp i kunnskapsbasen.
            </p>
          </div>
        ) : (
          p.warnings.map((w) => <WarningCard key={w.id} warning={w} onDismiss={p.onDismissWarning} />)
        )}
      </TabsContent>

      {/* Summary */}
      {p.summarySlot ? (
        <TabsContent value="summary" className="flex-1 min-h-0 overflow-y-auto mt-0">
          {p.summarySlot}
        </TabsContent>
      ) : null}
    </Tabs>
  );
}

function WorkbenchTab({
  value,
  icon: Icon,
  label,
  badge,
  tone,
  pulse,
}: {
  value: string;
  icon: typeof ClipboardList;
  label: string;
  badge?: number;
  tone?: "success" | "decision" | "suggestion" | "warning";
  pulse?: boolean;
}) {
  return (
    <TabsTrigger
      value={value}
      className={cn(
        "relative gap-2 rounded-none border-b-2 border-transparent bg-transparent px-3.5 py-2.5 text-sm font-medium",
        "data-[state=active]:border-foreground data-[state=active]:shadow-none",
        "hover:bg-transparent hover:text-foreground/90 transition-colors"
      )}
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
      {badge && badge > 0 ? (
        <span
          className={cn(
            "inline-flex items-center justify-center rounded-full px-1.5 py-0 min-w-[1.25rem] h-[1.25rem] text-[10px] font-semibold",
            tone === "success" && "bg-success/15 text-success",
            tone === "decision" && "bg-decision/15 text-decision",
            tone === "suggestion" && "bg-suggestion/15 text-suggestion",
            tone === "warning" && "bg-warning/20 text-warning-foreground",
            !tone && "bg-muted text-muted-foreground",
            pulse && "animate-pulse"
          )}
        >
          {badge}
        </span>
      ) : null}
    </TabsTrigger>
  );
}

function Section({
  label,
  tone,
  count,
  icon,
  children,
}: {
  label: string;
  tone: "success" | "decision" | "suggestion" | "warning" | "primary";
  count?: number;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            "h-1 w-1 rounded-full",
            tone === "success" && "bg-success",
            tone === "decision" && "bg-decision",
            tone === "suggestion" && "bg-suggestion",
            tone === "warning" && "bg-warning",
            tone === "primary" && "bg-primary"
          )}
        />
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {icon ? <span className="inline-flex items-center gap-1">{icon} {label}</span> : label}
          {count !== undefined ? (
            <span className="ml-1.5 font-normal text-muted-foreground/70">({count})</span>
          ) : null}
        </p>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
