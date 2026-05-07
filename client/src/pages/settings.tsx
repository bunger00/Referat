import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  User as UserIcon,
  Sparkles,
  Mic2,
  ScrollText,
  LogOut,
  Loader2,
  RotateCw,
  CheckCircle2,
} from "lucide-react";
import { Page, PageHeader, Section, Panel } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { supabase } from "@/lib/supabase";
import { resetAllHints } from "@/lib/hints";
import { expertRoleLabels, type ExpertRole } from "@shared/schema";

const PREFS_KEY = "referat:user-prefs";

type LocalPrefs = {
  expertRole: ExpertRole;
  questionInterval: 1 | 5 | 15 | 0;
  transcriptionModel: "medium" | "large" | "openai";
};

const DEFAULT_PREFS: LocalPrefs = {
  expertRole: "bygg",
  questionInterval: 1,
  transcriptionModel: "openai",
};

function loadPrefs(): LocalPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {/* ignore */}
  return DEFAULT_PREFS;
}

function savePrefs(p: LocalPrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {/* ignore */}
}

export default function SettingsPage() {
  return (
    <Page>
      <PageHeader
        eyebrow="Konto"
        title="Innstillinger"
        lead="Tilpass hvordan AI fungerer for deg, hvilken transkripsjonsmodell som brukes, og hva referatene dine skal inneholde."
      />

      <Tabs defaultValue="profile" className="space-y-6">
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 sm:w-auto sm:inline-flex">
          <TabsTrigger value="profile" className="gap-2"><UserIcon className="h-4 w-4" /> Profil</TabsTrigger>
          <TabsTrigger value="ai" className="gap-2"><Sparkles className="h-4 w-4" /> AI</TabsTrigger>
          <TabsTrigger value="transcribe" className="gap-2"><Mic2 className="h-4 w-4" /> Transkribering</TabsTrigger>
          <TabsTrigger value="summary" className="gap-2"><ScrollText className="h-4 w-4" /> Referat</TabsTrigger>
        </TabsList>

        <TabsContent value="profile"><ProfileTab /></TabsContent>
        <TabsContent value="ai"><AITab /></TabsContent>
        <TabsContent value="transcribe"><TranscribeTab /></TabsContent>
        <TabsContent value="summary"><SummaryTab /></TabsContent>
      </Tabs>
    </Page>
  );
}

function ProfileTab() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? "");
      setName(((data.user?.user_metadata as any)?.full_name as string) ?? "");
    });
  }, []);

  return (
    <div className="space-y-6">
      <Section title="Konto">
        <Panel className="p-5 space-y-3">
          <Field label="Navn" value={name || "—"} />
          <Field label="E-post" value={email} mono />
        </Panel>
      </Section>

      <Section title="Tips og veiledning">
        <Panel className="p-5 flex items-center justify-between gap-4">
          <div>
            <div className="font-medium">Førstegangs-tips</div>
            <p className="text-sm text-muted-foreground mt-0.5">
              Vis alle hint-bobler igjen — nyttig hvis noen andre skal prøve appen på maskinen din.
            </p>
          </div>
          <Button variant="outline" onClick={() => resetAllHints()}>
            <RotateCw className="h-4 w-4 mr-1.5" />
            Tilbakestill
          </Button>
        </Panel>
      </Section>

      <Section title="Sesjon">
        <Panel className="p-5 flex items-center justify-between gap-4">
          <div>
            <div className="font-medium">Logg ut</div>
            <p className="text-sm text-muted-foreground mt-0.5">
              Du blir sendt tilbake til innloggingsskjermen.
            </p>
          </div>
          <Button variant="outline" onClick={() => supabase.auth.signOut()}>
            <LogOut className="h-4 w-4 mr-1.5" />
            Logg ut
          </Button>
        </Panel>
      </Section>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={"text-sm" + (mono ? " font-mono" : "")}>{value}</span>
    </div>
  );
}

function AITab() {
  const [prefs, setPrefs] = useState<LocalPrefs>(loadPrefs);
  const setPref = (patch: Partial<LocalPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    savePrefs(next);
  };

  return (
    <div className="space-y-6">
      <Section
        title="Standard ekspertrolle"
        description="Velg hvilken faglig vinkling AI skal ta i nye møter. Du kan overstyre per møte."
      >
        <Panel className="p-5">
          <div className="grid sm:grid-cols-2 gap-2">
            {(Object.keys(expertRoleLabels) as ExpertRole[]).map((role) => (
              <button
                key={role}
                onClick={() => setPref({ expertRole: role })}
                className={
                  "rounded-xl border px-4 py-3 text-left text-sm transition-colors hover-elevate " +
                  (prefs.expertRole === role
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card border-card-border")
                }
              >
                <div className="font-medium">{expertRoleLabels[role]}</div>
              </button>
            ))}
          </div>
        </Panel>
      </Section>

      <Section
        title="Spørsmålsintervall"
        description="Hvor ofte AI skal foreslå spørsmål under møtet."
      >
        <Panel className="p-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { v: 1, label: "Hvert minutt" },
              { v: 5, label: "Hvert 5. min" },
              { v: 15, label: "Hvert 15. min" },
              { v: 0, label: "Bare manuelt" },
            ].map((opt) => (
              <button
                key={opt.v}
                onClick={() => setPref({ questionInterval: opt.v as LocalPrefs["questionInterval"] })}
                className={
                  "rounded-xl border px-4 py-3 text-sm transition-colors hover-elevate " +
                  (prefs.questionInterval === opt.v
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card border-card-border")
                }
              >
                {opt.label}
              </button>
            ))}
          </div>
        </Panel>
      </Section>

      <LearningProfile />

      <CommunityLearningSection />
    </div>
  );
}

function CommunityLearningSection() {
  const { data, refetch } = useQuery<{ optOut: boolean; contributions: number }>({
    queryKey: ["/api/community/preferences"],
  });
  const { toast } = useToast();
  const toggle = useMutation({
    mutationFn: async (optOut: boolean) => {
      await apiRequest("PATCH", "/api/community/preferences", { optOut });
    },
    onSuccess: () => {
      refetch();
      toast({ title: "Lagret" });
    },
  });

  return (
    <Section
      title="Kollektiv læring"
      description="Anonymiserte mønstre fra dine manuelle tillegg deles med fellesskapet slik at AI-en blir bedre for alle. Aldri rådata, aldri navn — kun abstraherte fang-regler."
    >
      <Panel className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="font-medium">Bidra til fellesskapet</div>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-prose">
              Når du legger til en aksjon eller beslutning manuelt, sender vi mønsteret (uten navn, prosjekt eller sted) til en delt læringspott. AI-en til alle brukere blir gradvis bedre på å fange samme type signal.
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Du har bidratt med <strong className="text-foreground">{data?.contributions ?? 0}</strong> anonymiserte signaler.
            </p>
          </div>
          <Switch
            checked={!data?.optOut}
            onCheckedChange={(checked) => toggle.mutate(!checked)}
            disabled={toggle.isPending}
            aria-label="Bidra til kollektiv læring"
          />
        </div>
      </Panel>
    </Section>
  );
}

function TranscribeTab() {
  const [prefs, setPrefs] = useState<LocalPrefs>(loadPrefs);
  const setPref = (patch: Partial<LocalPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    savePrefs(next);
  };

  const options: Array<{ v: LocalPrefs["transcriptionModel"]; label: string; desc: string }> = [
    { v: "openai", label: "OpenAI Whisper", desc: "Whisper-large-v2 (1.55B params). Robust på fjernstemmer og bakgrunnsstøy. Standard og anbefalt for møterom." },
    { v: "large", label: "nb-whisper Large", desc: "Norsk-finetunet, høyest presisjon på norsk språk og fagord. Krever at HF-endepunktet er aktivt." },
    { v: "medium", label: "nb-whisper Medium", desc: "Norsk-finetunet, raskere men mindre robust på rotete lyd. Velg dette kun hvis lyden er nær mikrofonen og ren." },
  ];

  return (
    <Section
      title="Standard transkripsjonsmodell"
      description="Hvilken motor som transkriberer lyd til tekst i sanntid."
    >
      <Panel className="p-5 space-y-2">
        {options.map((o) => (
          <button
            key={o.v}
            onClick={() => setPref({ transcriptionModel: o.v })}
            className={
              "w-full rounded-xl border px-4 py-3 text-left transition-colors hover-elevate " +
              (prefs.transcriptionModel === o.v
                ? "bg-primary/8 border-primary"
                : "bg-card border-card-border")
            }
          >
            <div className="flex items-center gap-2">
              <span className="font-medium">{o.label}</span>
              {prefs.transcriptionModel === o.v ? (
                <CheckCircle2 className="h-4 w-4 text-primary" />
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">{o.desc}</p>
          </button>
        ))}
      </Panel>
    </Section>
  );
}

function SummaryTab() {
  return (
    <Section
      title="Hvordan AI lærer av referatene dine"
      description="AI husker hva du endrer i referatene og bruker det til å skrive nye møter mer i din stil."
    >
      <LearningProfile summary />
    </Section>
  );
}

type LearningResp = {
  aiProfile: string;
  aiSignalCount: number;
  aiLastUpdated: string | null;
  summaryProfile: string;
  summaryFeedbackCount: number;
  summaryLastUpdated: string | null;
};

function LearningProfile({ summary }: { summary?: boolean } = {}) {
  const { data, isLoading } = useQuery<LearningResp>({ queryKey: ["/api/learning/profiles"] });
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const refresh = useMutation({
    mutationFn: async () => {
      const url = summary ? "/api/learning/update-summary-profile" : "/api/learning/update-profile";
      await apiRequest("POST", url);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/learning/profiles"] });
      toast({ title: "Profil oppdatert" });
    },
    onError: (e: any) => toast({ title: "Feil", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <Panel className="h-32 animate-pulse bg-muted/40" />;

  const profile = summary ? data?.summaryProfile : data?.aiProfile;
  const count = summary ? data?.summaryFeedbackCount : data?.aiSignalCount;
  const updated = summary ? data?.summaryLastUpdated : data?.aiLastUpdated;

  return (
    <Panel className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-medium">{summary ? "Referat-profil" : "AI-læringsprofil"}</div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
            <span>{count ?? 0} signaler</span>
            {updated ? (
              <span>Sist oppdatert {new Date(updated).toLocaleDateString("nb-NO")}</span>
            ) : null}
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
          {refresh.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <RotateCw className="h-4 w-4 mr-1.5" />}
          Oppdater
        </Button>
      </div>
      {profile ? (
        <pre className="whitespace-pre-wrap text-sm text-muted-foreground bg-muted/40 rounded-lg p-4 max-h-72 overflow-y-auto leading-relaxed">
          {profile}
        </pre>
      ) : (
        <p className="text-sm text-muted-foreground">
          AI har ikke nok signaler ennå. Etter noen møter — der du godkjenner/avviser
          forslag og redigerer referatene — bygger AI en profil av hva du foretrekker.
        </p>
      )}
    </Panel>
  );
}
