import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Lock, Mic, Mail, CheckCircle2 } from "lucide-react";
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
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Auth er ikke konfigurert</CardTitle>
            <CardDescription>
              Miljøvariablene <code>VITE_SUPABASE_URL</code> og <code>VITE_SUPABASE_ANON_KEY</code> mangler.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (verificationSent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center space-y-2">
            <div className="mx-auto w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-4">
              <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
            </div>
            <CardTitle>Sjekk eposten din</CardTitle>
            <CardDescription>
              Vi har sendt en bekreftelseslenke til <strong>{email}</strong>. Klikk på lenken i eposten for å aktivere kontoen.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="w-full" onClick={onSwitchToLogin}>
              Tilbake til innlogging
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
            <Mic className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold">Opprett konto</CardTitle>
          <CardDescription>Hver bruker får sitt eget område for møter og dokumenter</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSignup} className="space-y-3">
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="email"
                placeholder="navn@firma.no"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-10"
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
                className="pl-10"
                autoComplete="new-password"
                data-testid="input-signup-password"
              />
            </div>
            <Button type="submit" className="w-full" disabled={isLoading} data-testid="button-signup">
              {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Registrerer…</> : "Registrer deg"}
            </Button>
          </form>

          <div className="text-center text-sm text-muted-foreground mt-4">
            Har du allerede konto?{" "}
            <button type="button" onClick={onSwitchToLogin} className="text-primary hover:underline" data-testid="link-login">
              Logg inn
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
