import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/components/AuthContext";
import { HunaDocLogo } from "@/components/HunaDocLogo";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { KeyRound } from "lucide-react";

export default function ChangePasswordPage() {
  const { user, refreshUser } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast({ title: "Password too short", description: "Use at least 8 characters.", variant: "destructive" });
      return;
    }
    if (newPassword !== confirm) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const r = await apiRequest("POST", "/api/auth/change-password", { oldPassword, newPassword });
      await r.json();
      // Refetch the session so mustChangePassword flips to false in local state
      // BEFORE we navigate — otherwise ProtectedDashboard sees stale state and
      // bounces straight back to /change-password.
      const fresh = await refreshUser();
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "Password updated", description: "You're all set." });
      const role = fresh?.role || user?.role;
      if (role) setLocation(`/dashboard/${role}`);
      else setLocation("/login");
    } catch (err: any) {
      toast({ title: "Could not change password", description: err.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-6 py-10">
      <Card className="w-full max-w-md border-border">
        <CardHeader>
          <div className="flex items-center gap-3 mb-2">
            <HunaDocLogo size={24} />
            <span className="font-semibold tracking-tight">
              Huna<span className="text-primary">Doc</span>
            </span>
          </div>
          <CardTitle className="flex items-center gap-2 text-lg">
            <KeyRound className="h-5 w-5 text-primary" />
            Set a new password
          </CardTitle>
          <CardDescription>
            For security, please replace the temporary password issued by the Operations Manager.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="old">Temporary password</Label>
              <Input id="old" type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} required data-testid="input-old-password" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new">New password</Label>
              <Input id="new" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} data-testid="input-new-password" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm">Confirm new password</Label>
              <Input id="confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} data-testid="input-confirm-password" />
            </div>
            <Button type="submit" className="w-full" disabled={busy} data-testid="button-change-password-submit">
              {busy ? "Saving…" : "Update password"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
