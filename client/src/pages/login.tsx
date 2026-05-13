import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/components/AuthContext";
import { HunaDocLogo } from "@/components/HunaDocLogo";
import { TestDataBanner } from "@/components/TestDataBanner";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ShieldCheck, Activity, Stethoscope, Building2, ClipboardList, User, HeartHandshake, Briefcase, PlayCircle } from "lucide-react";
import pitchVideoUrl from "@assets/video/hunadoc-pitch.mp4?url";
import pitchPosterUrl from "@assets/video/hunadoc-pitch-poster.jpg?url";
import type { Role } from "@/lib/types";

const DEMO_ACCOUNTS: { role: Role; email: string; name: string; icon: any }[] = [
  { role: "pharmacist", email: "pharmacist@demo.huna", name: "Marcus Tanaka, PharmD", icon: Activity },
  { role: "prescriber", email: "prescriber@demo.huna", name: "Dr. Aiyana Cole, MD", icon: Stethoscope },
  { role: "pharmacy", email: "pharmacy@demo.huna", name: "Kakaako Rx", icon: Building2 },
  { role: "manager", email: "manager@demo.huna", name: "Sarah Mendel", icon: ClipboardList },
  { role: "patient", email: "patient@demo.huna", name: "Kenji Nakamura", icon: User },
];

export default function LoginPage() {
  const { login } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState<"login" | "register">("login");

  // login state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  // register state
  const [reg, setReg] = useState({
    email: "",
    password: "",
    fullName: "",
    role: "pharmacist" as Role,
    npi: "",
    pharmacistLicense: "",
    ncpdp: "",
    organizationName: "",
    specialty: "",
    state: "HI",
  });

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const u = await login(email, password);
      toast({ title: "Welcome back", description: u.fullName });
      setLocation(`/dashboard/${u.role}`);
    } catch (err: any) {
      toast({ title: "Login failed", description: err.message || "Invalid credentials", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function handleQuickLogin(demoEmail: string) {
    setBusy(true);
    try {
      const u = await login(demoEmail, "demo1234");
      setLocation(`/dashboard/${u.role}`);
    } catch (err: any) {
      toast({ title: "Login failed", description: err.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body: any = {
        email: reg.email,
        password: reg.password,
        fullName: reg.fullName,
        role: reg.role,
        state: reg.state,
      };
      if (reg.role === "prescriber") {
        body.npi = reg.npi;
        body.specialty = reg.specialty;
      }
      if (reg.role === "pharmacist") body.pharmacistLicense = reg.pharmacistLicense;
      if (reg.role === "pharmacy") {
        body.ncpdp = reg.ncpdp;
        body.organizationName = reg.organizationName;
      }
      if (reg.role === "manager") body.organizationName = reg.organizationName;
      const r = await apiRequest("POST", "/api/auth/register", body);
      const u = await r.json();
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "Account created", description: `Welcome to HunaDoc, ${u.fullName}` });
      setLocation(`/dashboard/${u.role}`);
    } catch (err: any) {
      toast({ title: "Registration failed", description: err.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <TestDataBanner />
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-5">
        {/* Left side — brand panel */}
        <div className="hidden lg:flex lg:col-span-3 flex-col justify-between p-12 bg-gradient-to-br from-primary/5 via-card/40 to-primary/10 border-r border-border relative overflow-hidden">
          <div className="absolute inset-0 opacity-[0.05] pointer-events-none" style={{
            backgroundImage: "radial-gradient(circle at 25% 30%, hsl(var(--primary)) 0, transparent 50%), radial-gradient(circle at 75% 70%, hsl(var(--primary)) 0, transparent 50%)",
          }} />
          <div className="flex items-center gap-3 relative">
            <HunaDocLogo size={36} />
            <div>
              <div className="font-semibold tracking-tight text-xl">
                Huna<span className="text-primary">Doc</span>
              </div>
              <div className="text-xs text-muted-foreground">Verifiable healthcare workflows</div>
            </div>
          </div>

          <div className="space-y-6 relative">
            <h1 className="text-3xl font-semibold tracking-tight leading-tight max-w-md">
              Every prescription, license, and shift — cryptographically anchored.
            </h1>
            <p className="text-muted-foreground max-w-md text-sm leading-relaxed">
              HunaDoc connects pharmacists, prescribers, pharmacies, and patients
              through a single workflow. Every state-changing action writes a
              SHA-256 proof to the XRP Ledger so auditors, boards of pharmacy, and
              patients can independently verify what happened.
            </p>
            <div className="grid grid-cols-2 gap-3 max-w-md">
              <Feature icon={ShieldCheck} title="Tamper-evident" desc="Hashes anchored to XRPL Testnet" />
              <Feature icon={Activity} title="Shift marketplace" desc="Pharmacists and pharmacies clear in real time" />
              <Feature icon={Stethoscope} title="Telehealth + eRx" desc="Sign and route in one motion" />
              <Feature icon={ClipboardList} title="Auditable ledger" desc="Public ledger sequence numbers, anytime" />
            </div>

            <JoinTheTeam />

            <InvestorPartnership />
          </div>

          <div className="text-xs text-muted-foreground relative">
            Alpha build · TEST DATA ONLY · No PHI · No real money · No production care decisions
          </div>
        </div>

        {/* Right side — auth */}
        <div className="lg:col-span-2 flex flex-col justify-center px-6 sm:px-10 py-10">
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <HunaDocLogo size={28} />
            <span className="font-semibold tracking-tight">
              Huna<span className="text-primary">Doc</span>
            </span>
          </div>

          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-lg">Sign in to HunaDoc</CardTitle>
              <CardDescription>Use a demo account or register a new one.</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
                <TabsList className="grid grid-cols-2 w-full">
                  <TabsTrigger value="login" data-testid="tab-login">Login</TabsTrigger>
                  <TabsTrigger value="register" data-testid="tab-register">Register</TabsTrigger>
                </TabsList>

                <TabsContent value="login" className="space-y-4 mt-4">
                  <form onSubmit={handleLogin} className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        data-testid="input-login-email"
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="password">Password</Label>
                      <Input
                        id="password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        data-testid="input-login-password"
                        required
                      />
                    </div>
                    <Button type="submit" className="w-full" disabled={busy} data-testid="button-login-submit">
                      {busy ? "Signing in…" : "Sign in"}
                    </Button>
                  </form>

                  <div className="pt-3 border-t border-border">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Quick demo access</div>
                    <div className="grid gap-1.5">
                      {DEMO_ACCOUNTS.map((d) => (
                        <button
                          key={d.role}
                          onClick={() => handleQuickLogin(d.email)}
                          disabled={busy}
                          data-testid={`button-quick-login-${d.role}`}
                          className="flex items-center justify-between gap-3 px-3 py-2 rounded-md border border-border hover-elevate active-elevate-2 text-left disabled:opacity-50"
                        >
                          <div className="flex items-center gap-3">
                            <d.icon className="h-4 w-4 text-primary shrink-0" />
                            <div className="leading-tight">
                              <div className="text-sm font-medium capitalize">{d.role}</div>
                              <div className="text-xs text-muted-foreground">{d.name}</div>
                            </div>
                          </div>
                          <div className="text-[10px] font-mono text-muted-foreground">demo1234</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="register" className="mt-4">
                  <form onSubmit={handleRegister} className="space-y-3">
                    <div className="space-y-1.5">
                      <Label>I am a</Label>
                      <Select value={reg.role} onValueChange={(v) => setReg({ ...reg, role: v as Role })}>
                        <SelectTrigger data-testid="select-register-role"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pharmacist">Pharmacist</SelectItem>
                          <SelectItem value="prescriber">Prescriber (MD/DO/NP/PA)</SelectItem>
                          <SelectItem value="pharmacy">Pharmacy</SelectItem>
                          <SelectItem value="manager">Operations Manager</SelectItem>
                          <SelectItem value="patient">Patient</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label>Full name</Label>
                        <Input
                          value={reg.fullName}
                          onChange={(e) => setReg({ ...reg, fullName: e.target.value })}
                          required
                          data-testid="input-register-fullname"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>State</Label>
                        <Input
                          value={reg.state}
                          onChange={(e) => setReg({ ...reg, state: e.target.value })}
                          maxLength={2}
                          data-testid="input-register-state"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Email</Label>
                      <Input
                        type="email"
                        value={reg.email}
                        onChange={(e) => setReg({ ...reg, email: e.target.value })}
                        required
                        data-testid="input-register-email"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Password</Label>
                      <Input
                        type="password"
                        value={reg.password}
                        onChange={(e) => setReg({ ...reg, password: e.target.value })}
                        minLength={6}
                        required
                        data-testid="input-register-password"
                      />
                    </div>

                    {reg.role === "prescriber" && (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label>NPI</Label>
                          <Input value={reg.npi} onChange={(e) => setReg({ ...reg, npi: e.target.value })} data-testid="input-register-npi" />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Specialty</Label>
                          <Input value={reg.specialty} onChange={(e) => setReg({ ...reg, specialty: e.target.value })} data-testid="input-register-specialty" />
                        </div>
                      </div>
                    )}
                    {reg.role === "pharmacist" && (
                      <div className="space-y-1.5">
                        <Label>Pharmacist license number</Label>
                        <Input value={reg.pharmacistLicense} onChange={(e) => setReg({ ...reg, pharmacistLicense: e.target.value })} data-testid="input-register-license" />
                      </div>
                    )}
                    {reg.role === "pharmacy" && (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label>NCPDP</Label>
                          <Input value={reg.ncpdp} onChange={(e) => setReg({ ...reg, ncpdp: e.target.value })} data-testid="input-register-ncpdp" />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Organization name</Label>
                          <Input value={reg.organizationName} onChange={(e) => setReg({ ...reg, organizationName: e.target.value })} data-testid="input-register-org" />
                        </div>
                      </div>
                    )}
                    {reg.role === "manager" && (
                      <div className="space-y-1.5">
                        <Label>Organization</Label>
                        <Input value={reg.organizationName} onChange={(e) => setReg({ ...reg, organizationName: e.target.value })} data-testid="input-register-org" />
                      </div>
                    )}

                    <Button type="submit" className="w-full" disabled={busy} data-testid="button-register-submit">
                      {busy ? "Creating account…" : "Create account"}
                    </Button>
                  </form>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Feature({ icon: Icon, title, desc }: { icon: any; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-2">
      <div className="h-8 w-8 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </div>
    </div>
  );
}

// Public "Join the Team" form. Visitors select a role, leave a short note (50
// words max), and provide return contact info. Submissions are stored on the
// server and surfaced inside the Manager dashboard.
const JOIN_ROLES = [
  { value: "prescriber", label: "Prescriber" },
  { value: "pharmacist", label: "Pharmacist" },
  { value: "pharmacy", label: "Pharmacy" },
  { value: "mental_health", label: "Mental Health / Outreach program" },
  { value: "investor", label: "Investor / Partnership" },
];
const MAX_JOIN_WORDS = 50;

function JoinTheTeam() {
  const { toast } = useToast();
  const [role, setRole] = useState<string>("prescriber");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const wordCount = message.trim() ? message.trim().split(/\s+/).length : 0;
  const overLimit = wordCount > MAX_JOIN_WORDS;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (overLimit) {
      toast({ title: "Message too long", description: `Please keep it to ${MAX_JOIN_WORDS} words or fewer.`, variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const r = await apiRequest("POST", "/api/contact", { kind: "join_team", role, name, email, phone, message });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || "Submission failed");
      toast({ title: "Thank you", description: "Your message has been received. The HunaDoc team will reach back to you shortly." });
      setName(""); setEmail(""); setPhone(""); setMessage("");
    } catch (err: any) {
      toast({ title: "Could not submit", description: err.message || "Please try again.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 max-w-md pt-2">
      <div className="flex items-center gap-2">
        <HeartHandshake className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold tracking-tight">Join the Team</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Prescriber, pharmacist, pharmacy, or mental health / outreach program — tell us how you'd like to plug in. Replies route directly to HunaDoc operations.
      </p>
      <form onSubmit={submit} className="space-y-2.5">
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2 sm:col-span-1 space-y-1">
            <Label className="text-xs">I am a</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="h-9 text-sm" data-testid="select-join-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {JOIN_ROLES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 sm:col-span-1 space-y-1">
            <Label className="text-xs">Full name</Label>
            <Input className="h-9 text-sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" data-testid="input-join-name" />
          </div>
          <div className="col-span-2 sm:col-span-1 space-y-1">
            <Label className="text-xs">Return email</Label>
            <Input className="h-9 text-sm" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" data-testid="input-join-email" />
          </div>
          <div className="col-span-2 sm:col-span-1 space-y-1">
            <Label className="text-xs">Phone (optional)</Label>
            <Input className="h-9 text-sm" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 000 0000" data-testid="input-join-phone" />
          </div>
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Message (up to {MAX_JOIN_WORDS} words)</Label>
            <span className={`text-[10px] tabular-nums ${overLimit ? "text-destructive" : "text-muted-foreground"}`}>
              {wordCount}/{MAX_JOIN_WORDS}
            </span>
          </div>
          <Textarea
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Briefly describe your role, organization, and what you'd like to explore with HunaDoc."
            data-testid="input-join-message"
            className="text-sm resize-none"
          />
        </div>
        <Button type="submit" size="sm" disabled={busy || overLimit || !email} data-testid="button-join-submit">
          {busy ? "Sending…" : "Send message"}
        </Button>
      </form>
    </div>
  );
}

// Investor / Partnership block. Plays the 4-minute HunaDoc pitch video inline.
function InvestorPartnership() {
  const [playing, setPlaying] = useState(false);
  return (
    <div className="space-y-3 max-w-md pt-2">
      <div className="flex items-center gap-2">
        <Briefcase className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold tracking-tight">Investor / Partnership</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Watch the HunaDoc investor pitch — a 4-minute walkthrough of the problem, the platform, and the market opportunity.
      </p>
      <div
        className="relative rounded-lg overflow-hidden border border-border bg-black aspect-video group cursor-pointer"
        data-testid="button-play-pitch"
        onClick={() => setPlaying(true)}
      >
        {!playing ? (
          <>
            <img
              src={pitchPosterUrl}
              alt="HunaDoc investor pitch video"
              className="absolute inset-0 w-full h-full object-cover opacity-80"
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-t from-black/70 via-black/20 to-transparent">
              <div className="h-14 w-14 rounded-full bg-primary/90 text-primary-foreground flex items-center justify-center group-hover:scale-105 transition-transform shadow-lg">
                <PlayCircle className="h-8 w-8" />
              </div>
              <div className="text-xs font-medium text-white drop-shadow">
                HunaDoc investor pitch · ~4 minutes
              </div>
            </div>
          </>
        ) : (
          <video
            src={pitchVideoUrl}
            poster={pitchPosterUrl}
            controls
            autoPlay
            className="absolute inset-0 w-full h-full"
            data-testid="video-pitch"
          >
            Your browser does not support embedded video.
          </video>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Interested in partnership or investment? Use the form above and select "Investor / Partnership" — your message routes directly to HunaDoc leadership.
      </p>
    </div>
  );
}
