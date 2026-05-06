import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Lock, Mic } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface LoginPageProps {
  onLoginSuccess: () => void;
}

export default function LoginPage({ onLoginSuccess }: LoginPageProps) {
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!password.trim()) {
      toast({
        title: "Passord påkrevd",
        description: "Vennligst skriv inn passordet",
        variant: "destructive",
      });
      return;
    }
    
    setIsLoading(true);
    
    try {
      const response = await apiRequest("POST", "/api/auth/login", { password });
      const data = await response.json();
      
      if (data.success) {
        toast({
          title: "Innlogget",
          description: "Velkommen til møtetranskripsjonsappen",
        });
        onLoginSuccess();
      }
    } catch (error: any) {
      toast({
        title: "Innlogging feilet",
        description: error.message || "Feil passord",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
            <Mic className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold">Møtetranskribering</CardTitle>
          <CardDescription>
            Logg inn for å bruke appen
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="password"
                  placeholder="Skriv inn passord..."
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10"
                  autoFocus
                  data-testid="input-password"
                />
              </div>
            </div>
            <Button 
              type="submit" 
              className="w-full" 
              disabled={isLoading}
              data-testid="button-login"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Logger inn...
                </>
              ) : (
                "Logg inn"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
