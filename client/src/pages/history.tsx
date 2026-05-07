import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  History as HistoryIcon,
  Calendar,
  Trash2,
  ExternalLink,
  Pencil,
  MoreVertical,
} from "lucide-react";
import { Page, PageHeader, Section, Panel, EmptyState, StatPill } from "@/components/ds";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { MeetingSession } from "@shared/schema";

type SessionListItem = MeetingSession & { seriesName: string | null };

function formatDate(date: Date): string {
  return date.toLocaleDateString("nb-NO", { day: "numeric", month: "short", year: "numeric" });
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds < 60) return `${seconds ?? 0} sek`;
  const m = Math.floor(seconds / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}t ${m % 60}m`;
  return `${m} min`;
}

export default function HistoryPage() {
  const { data, isLoading } = useQuery<{ sessions: SessionListItem[] }>({
    queryKey: ["/api/sessions"],
  });
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [seriesFilter, setSeriesFilter] = useState<string>("all");
  const [renameTarget, setRenameTarget] = useState<SessionListItem | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<SessionListItem | null>(null);

  const sessions = data?.sessions ?? [];

  const seriesOptions = useMemo(() => {
    const map = new Map<string, string>();
    sessions.forEach((s) => {
      if (s.seriesId && s.seriesName) {
        map.set(String(s.seriesId), s.seriesName);
      }
    });
    return Array.from(map.entries());
  }, [sessions]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sessions
      .filter((s) => {
        if (seriesFilter !== "all" && String(s.seriesId ?? "") !== seriesFilter) return false;
        if (!q) return true;
        return (
          (s.title ?? "").toLowerCase().includes(q) ||
          (s.seriesName ?? "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  }, [sessions, search, seriesFilter]);

  const renameMutation = useMutation({
    mutationFn: async ({ id, title }: { id: number; title: string }) => {
      await apiRequest("PATCH", `/api/sessions/${id}`, { title });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
      toast({ title: "Møtet er oppdatert" });
      setRenameTarget(null);
    },
    onError: (e: any) => toast({ title: "Kunne ikke endre tittel", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/sessions/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
      toast({ title: "Møtet er slettet" });
      setDeleteTarget(null);
    },
    onError: (e: any) => toast({ title: "Kunne ikke slette", description: e.message, variant: "destructive" }),
  });

  return (
    <Page>
      <PageHeader
        eyebrow="Arkiv"
        title="Historikk"
        lead="Alle møter du har tatt opp. Søk i tittel eller serie, eller åpne et møte for å se transkript, aksjoner og referat."
      />

      <Section>
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Søk etter tittel eller serie…"
              className="pl-10 h-11 bg-card"
            />
          </div>
          {seriesOptions.length > 0 ? (
            <select
              value={seriesFilter}
              onChange={(e) => setSeriesFilter(e.target.value)}
              className="h-11 rounded-lg border border-input bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
            >
              <option value="all">Alle serier</option>
              {seriesOptions.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          ) : null}
        </div>

        {isLoading ? (
          <div className="space-y-2 mt-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <Panel key={i} className="h-16 animate-pulse bg-muted/40" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={HistoryIcon}
            title={sessions.length === 0 ? "Ingen møter ennå" : "Ingen treff"}
            description={
              sessions.length === 0
                ? "Når du tar opp ditt første møte havner det her — med tittel, dato og varighet."
                : "Prøv å justere søket eller filteret."
            }
            actions={
              sessions.length === 0 ? (
                <Link href="/mote">
                  <a><Button>Start ditt første møte</Button></a>
                </Link>
              ) : null
            }
            className="mt-4"
          />
        ) : (
          <Panel className="mt-4 overflow-hidden">
            <ul className="divide-y divide-card-border">
              {filtered.map((s) => {
                const date = new Date(s.startedAt);
                const actionsCount = (s.actionItems ?? []).filter((a) => a.status === "approved").length;
                const decisionsCount = (s.decisions ?? []).filter((d) => d.status === "confirmed").length;
                return (
                  <li key={s.id} className="group flex items-center gap-3 px-4 sm:px-5 py-3.5 hover-elevate">
                    <Link href={`/m/${s.id}`}>
                      <a className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-sm sm:text-base truncate">
                            {s.title || "Uten tittel"}
                          </div>
                          {s.seriesName ? (
                            <div className="text-xs text-muted-foreground mt-0.5 truncate">
                              {s.seriesName}
                              {s.seriesIndex ? ` · #${s.seriesIndex}` : ""}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatPill icon={<Calendar className="h-3 w-3" />}>
                            {formatDate(date)}
                          </StatPill>
                          <StatPill>{formatDuration(s.elapsedSeconds)}</StatPill>
                          {actionsCount > 0 ? (
                            <StatPill tone="success">{actionsCount}</StatPill>
                          ) : null}
                          {decisionsCount > 0 ? (
                            <StatPill tone="decision">{decisionsCount}</StatPill>
                          ) : null}
                        </div>
                      </a>
                    </Link>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-10 w-10 sm:h-9 sm:w-9 shrink-0" aria-label="Flere handlinger">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => {
                          setRenameTarget(s);
                          setRenameValue(s.title ?? "");
                        }}>
                          <Pencil className="h-4 w-4 mr-2" />
                          Endre tittel
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link href={`/m/${s.id}`}>
                            <a className="flex items-center w-full">
                              <ExternalLink className="h-4 w-4 mr-2" />
                              Åpne
                            </a>
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => setDeleteTarget(s)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Slett
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                );
              })}
            </ul>
          </Panel>
        )}
      </Section>

      <Dialog open={!!renameTarget} onOpenChange={(o) => !o && setRenameTarget(null)}>
        <DialogContent className="w-[95vw] max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Endre tittel</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder="Møtetittel"
            autoFocus
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameTarget(null)}>Avbryt</Button>
            <Button
              onClick={() => renameTarget && renameMutation.mutate({ id: renameTarget.id, title: renameValue.trim() })}
              disabled={!renameValue.trim() || renameMutation.isPending}
            >
              Lagre
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Slette møtet?</AlertDialogTitle>
            <AlertDialogDescription>
              «{deleteTarget?.title || "Uten tittel"}» og alt innhold (transkript, aksjoner,
              beslutninger, referat) blir borte. Dette kan ikke angres.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Slett møtet
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}
