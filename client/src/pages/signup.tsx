import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Lock, Mail, Sparkles, CheckCircle2 } from "lucide-react";
import { supabase, supabaseConfigured } from "@/lib/supabase";

interface SignupPageProps {
  onSwitchToLogin: () => void;
}

export default function SignupPage({ onSwitchToLogin }: SignupPageProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  const { toast } = useToast();

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      toast({ title: "Mangler felt", description: "Skriv inn både epost og passord.", variant: "destructive" });
      return;
    }
    if (password.length < 8) {
      toast({ title: "For kort passord", description: "Passordet må være minst 8 tegn.", variant: "destructive" });
      return;
    }
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: `${window.location.origin}` },
      });
      if (error) throw error;
      setVerificationSent(true);
    } catch (error: any) {
      toast({
        title: "Registrering feilet",
        description: error?.message || "Prøv igjen, eller kontakt support hvis problemet vedvarer.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (!supabaseConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md rounded-2xl border border-card-border bg-card p-8 shadow-lg">
          <h1 className="font-display text-2xl font-semibold tracking-tightish">
            Auth er ikke konfigurert
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Miljøvariablene <code className="font-mono text-xs">VITE_SUPABASE_URL</code> og{" "}
            <code className="font-mono text-xs">VITE_SUPABASE_ANON_KEY</code> mangler.
          </p>
        </div>
      </div>
    );
  }

  if (verificationSent) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background p-6">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-success/15 text-success mb-6">
            <CheckCircle2 className="h-7 w-7" strokeWidth={2.25} />
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-display">
            Sjekk e-posten din
          </h1>
          <p className="mt-3 text-muted-foreground leading-relaxed">
            Vi har sendt en bekreftelseslenke til <strong className="text-foreground">{email}</strong>.
            Klikk lenken i e-posten for å aktivere kontoen.
          </p>
          <Button variant="outline" size="lg" className="mt-8" onClick={onSwitchToLogin}>
            Tilbake til innlogging
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] grid lg:grid-cols-2 bg-background">
      <aside className="hidden lg:flex flex-col justify-between bg-primary text-primary-foreground p-12 relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.06]" aria-hidden>
          <div className="absolute -top-32 -left-32 h-96 w-96 rounded-full bg-accent blur-3xl" />
          <div className="absolute bottom-0 right-0 h-[28rem] w-[28rem] rounded-full bg-suggestion blur-3xl" />
        </div>
        <div className="relative inline-flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-primary-foreground/12 backdrop-blur">
            <Sparkles className="h-6 w-6" strokeWidth={2.25} />
          </span>
          <span className="font-display text-2xl font-semibold tracking-display">Referat</span>
        </div>
        <div className="relative space-y-6 max-w-md">
          <h2 className="font-display text-4xl font-semibold tracking-display leading-[1.1]">
            Begynn med ditt første møte.
          </h2>
          <p className="text-primary-foreground/80 text-lg leading-relaxed">
            Du får ditt eget område for møter, regelverk og dokumenter.
            AI lærer av endringene dine og blir bedre for hvert møte.
          </p>
        </div>
        <p className="relative text-xs text-primary-foreground/50">© Referat</p>
      </aside>

      <main className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm space-y-8">
          <div className="lg:hidden inline-flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground">
              <Sparkles className="h-5 w-5" strokeWidth={2.25} />
            </span>
            <span className="font-display text-2xl font-semibold tracking-display leading-none">Referat</span>
          </div>

          <div className="space-y-2">
            <h1 className="font-display text-3xl font-semibold tracking-display leading-tight">
              Opprett konto
            </h1>
            <p className="text-muted-foreground">Det tar 30 sekunder.</p>
          </div>

          <form onSubmit={handleSignup} className="space-y-3">
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="email"
                placeholder="navn@firma.no"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-10 h-11"
                autoComplete="email"
                autoFocus
                data-testid="input-signup-email"
              />
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="password"
                placeholder="Passord (minst 8 tegn)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pl-10 h-11"
                autoComplete="new-password"
                data-testid="input-signup-password"
              />
            </div>
            <Button type="submit" size="lg" className="w-full h-11" disabled={isLoading} data-testid="button-signup">
              {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Registrerer…</> : "Registrer deg"}
            </Button>
          </form>

          <div className="text-center text-sm text-muted-foreground">
            Har du allerede konto?{" "}
            <button type="button" onClick={onSwitchToLogin} className="text-primary font-medium hover:underline" data-testid="link-login">
              Logg inn
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
