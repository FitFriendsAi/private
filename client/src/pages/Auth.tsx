import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dumbbell } from "lucide-react";

export default function Auth() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [form, setForm] = useState({ email: "", password: "", name: "" });
  const [err, setErr] = useState("");
  const { login, register } = useAuth();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      if (mode === "login") {
        await login.mutateAsync({ email: form.email, password: form.password });
      } else {
        await register.mutateAsync(form);
      }
    } catch (e: any) {
      setErr(e.message);
    }
  }

  const loading = login.isPending || register.isPending;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm border-border/50">
        <CardHeader className="text-center space-y-3 pb-4">
          <div className="flex justify-center">
            <div className="p-4 rounded-3xl bg-primary/20">
              <Dumbbell className="w-9 h-9 text-primary" />
            </div>
          </div>
          <CardTitle className="text-3xl font-bold">FitCore</CardTitle>
          <CardDescription className="text-sm">Your all-in-one fitness & nutrition tracker</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex rounded-2xl overflow-hidden bg-secondary p-1 mb-6 gap-1">
            <button onClick={() => setMode("login")} className={`flex-1 py-2 text-sm font-semibold rounded-xl transition-colors ${mode === "login" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>Sign In</button>
            <button onClick={() => setMode("register")} className={`flex-1 py-2 text-sm font-semibold rounded-xl transition-colors ${mode === "register" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>Create Account</button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "register" && (
              <div className="space-y-1.5">
                <Label>Full Name</Label>
                <Input placeholder="John Smith" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" placeholder="you@example.com" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required />
            </div>
            <div className="space-y-1.5">
              <Label>Password</Label>
              <Input type="password" placeholder={mode === "register" ? "Min. 8 characters" : "••••••••"} value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required minLength={mode === "register" ? 8 : undefined} />
            </div>

            {err && <p className="text-sm text-destructive">{err}</p>}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Loading..." : mode === "login" ? "Sign In" : "Create Account"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
