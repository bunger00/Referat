import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Mic, Upload, History, BookOpen, Calendar, Sparkles, ArrowRight } from "lucide-react";
import { Page, PageHeader, Section, Panel, EmptyState, CTACard, StatPill } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { useEffect, useState } from "react";
import type { MeetingSession } from "@shared/schema";

type SessionListItem = MeetingSession & { seriesName: string | null };

function formatNorwegianDate(date: Date): string {
  return date.toLocaleDateString("nb-NO", { day: "numeric", month: "short", year: "numeric" });
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds < 60) return `${seconds ?? 0} sek`;
  const m = Math.floor(seconds / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}t ${m % 60}m`;
  return `${m} min`;
}

export default function HomePage() {
  const { data, isLoading } = useQuery<{ sessions: SessionListItem[] }>({
    queryKey: ["/api/sessions"],
  });

  const sessions = data?.sessions ?? [];
  const recent = [...sessions]
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, 4);

  const [firstName, setFirstName] = useState<string>("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const fullName = (data.user?.user_metadata as any)?.full_name as string | undefined;
      const email = data.user?.email ?? "";
      const name = fullName?.split(" ")[0] ?? email.split("@")[0] ?? "";
      setFirstName(name.charAt(0).toUpperCase() + name.slice(1));
    });
  }, []);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 5) return "God natt";
    if (h < 11) return "God morgen";
    if (h < 17) return "God dag";
    return "God kveld";
  })();

  return (
    <Page>
      <PageHeader
        eyebrow="Referat"
        title={firstName ? `${greeting}, ${firstName}.` : `${greeting}.`}
        lead="Start et nytt møte, last opp et opptak, eller fortsett der du slapp. AI lytter, foreslår spørsmål og samler aksjoner og beslutninger automatisk."
      />

      <Section title="Kom i gang">
        <div className="grid gap-4 md:grid-cols-3">
          <Link href="/mote">
            <a className="block">
              <CTACard
                icon={Mic}
                tone="accent"
                title="Start nytt møte"
                description="Sanntids-transkripsjon med AI-spørsmål og automatisk aksjon-/beslutningsfangst."
              />
            </a>
          </Link>
          <Link href="/mote?upload=1">
            <a className="block">
              <CTACard
                icon={Upload}
                tone="primary"
                title="Last opp lydfil"
                description="Har du allerede et opptak? Slipp det inn så får du transkript og referat."
              />
            </a>
          </Link>
          <Link href="/historikk">
            <a className="block">
              <CTACard
                icon={History}
                tone="muted"
                title="Se historikk"
                description="Alle tidligere møter, sortert og søkbare. Åpne, eksporter eller fortsett."
              />
            </a>
          </Link>
        </div>
      </Section>

      <Section
        title="Siste møter"
        actions={
          recent.length > 0 ? (
            <Link href="/historikk">
              <a className="text-sm font-medium text-primary inline-flex items-center gap-1.5 hover:underline">
                Se alle <ArrowRight className="h-4 w-4" />
              </a>
            </Link>
          ) : null
        }
      >
        {isLoading ? (
          <div className="grid gap-3 md:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <Panel key={i} className="h-28 animate-pulse bg-muted/40" />
            ))}
          </div>
        ) : recent.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="Du har ingen møter ennå"
            description="Start ditt første møte for å se hvordan AI hjelper deg å fange aksjoner, beslutninger og generere referater du faktisk vil sende ut."
            actions={
              <Link href="/mote">
                <a>
                  <Button size="lg" className="gap-2">
                    <Mic className="h-4 w-4" />
                    Start ditt første møte
                  </Button>
                </a>
              </Link>
            }
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {recent.map((s) => {
              const date = new Date(s.startedAt);
              const actionsCount = (s.actionItems ?? []).filter((a) => a.status === "approved").length;
              const decisionsCount = (s.decisions ?? []).filter((d) => d.status === "confirmed").length;
              return (
                <Link key={s.id} href={`/m/${s.id}`}>
                  <a className="block">
                    <Panel
                      variant="flat"
                      className="p-5 hover-elevate transition-shadow hover:shadow-md cursor-pointer"
                    >
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="min-w-0">
                          <h3 className="font-display text-lg font-semibold tracking-tightish leading-snug truncate">
                            {s.title || "Uten tittel"}
                          </h3>
                          {s.seriesName ? (
                            <p className="text-xs text-muted-foreground mt-0.5 truncate">
                              Serie: {s.seriesName}
                            </p>
                          ) : null}
                        </div>
                        <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        <StatPill icon={<Calendar className="h-3 w-3" />}>
                          {formatNorwegianDate(date)}
                        </StatPill>
                        <StatPill>{formatDuration(s.elapsedSeconds)}</StatPill>
                        {actionsCount > 0 ? (
                          <StatPill tone="success">{actionsCount} aksjoner</StatPill>
                        ) : null}
                        {decisionsCount > 0 ? (
                          <StatPill tone="decision">{decisionsCount} beslutninger</StatPill>
                        ) : null}
                      </div>
                    </Panel>
                  </a>
                </Link>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Tilpass appen til deg">
        <div className="grid gap-3 md:grid-cols-2">
          <Link href="/kunnskapsbase">
            <a className="block">
              <Panel className="p-5 hover-elevate cursor-pointer flex items-start gap-4">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-suggestion/15 text-suggestion shrink-0">
                  <BookOpen className="h-5 w-5" strokeWidth={2} />
                </span>
                <div>
                  <h3 className="font-medium">Kunnskapsbase</h3>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Last opp regelverk, ordrettelser og kontekstdokumenter for smartere AI-forslag.
                  </p>
                </div>
              </Panel>
            </a>
          </Link>
          <Link href="/innstillinger">
            <a className="block">
              <Panel className="p-5 hover-elevate cursor-pointer flex items-start gap-4">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/15 text-primary shrink-0">
                  <Sparkles className="h-5 w-5" strokeWidth={2} />
                </span>
                <div>
                  <h3 className="font-medium">Innstillinger</h3>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Standard ekspertrolle, transkripsjonsmodell og hvordan AI lærer dine preferanser.
                  </p>
                </div>
              </Panel>
            </a>
          </Link>
        </div>
      </Section>
    </Page>
  );
}
