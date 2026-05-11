import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/components/AuthContext";
import { AppShell } from "@/components/AppShell";
import { LedgerProofBadge } from "@/components/LedgerProofBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Briefcase, Pill, Clock, ChevronDown, ChevronUp, Send, Receipt, BookOpen, FileBadge2, Building2 } from "lucide-react";
import { HelpGuide } from "@/components/HelpGuide";
import type { NavGroup } from "@/components/AppShell";
import type { Shift, Prescription, Claim, License, User } from "@/lib/types";
import { fmtDate, fmtMoney, statusColor, urgencyColor } from "@/lib/format";

const NAV: NavGroup[] = [
  {
    label: "Operations",
    items: [
      { label: "Rx queue", path: "/dashboard/pharmacy", testId: "nav-pharmacy-rx", icon: Pill },
      { label: "Claims & settlements", path: "/dashboard/pharmacy/claims", testId: "nav-pharmacy-claims", icon: Receipt },
    ],
  },
  {
    label: "Staffing",
    items: [
      { label: "Shifts", path: "/dashboard/pharmacy/shifts", testId: "nav-pharmacy-shifts", icon: Briefcase },
    ],
  },
  {
    label: "Pharmacy",
    items: [
      { label: "Profile", path: "/dashboard/pharmacy/profile", testId: "nav-pharmacy-profile", icon: Building2 },
    ],
  },
  {
    label: "Help",
    items: [
      { label: "User guide", path: "/dashboard/pharmacy/help", testId: "nav-pharmacy-help", icon: BookOpen },
    ],
  },
];

export default function PharmacyDashboard() {
  const [, params] = useRoute("/dashboard/pharmacy/:tab?");
  const tab = params?.tab || "rx";
  return (
    <AppShell title="Pharmacy operations" subtitle="Fill prescriptions, settle claims, post staffing shifts." nav={NAV}>
      {tab === "rx" && <Queue />}
      {tab === "claims" && <Claims />}
      {tab === "shifts" && <Shifts />}
      {tab === "profile" && <PharmacyProfile />}
      {tab === "help" && <HelpGuide role="pharmacy" />}
    </AppShell>
  );
}

function channelLabel(channel: string | null) {
  if (channel === "surescripts") return "Surescripts NewRx (SIMULATED)";
  if (channel === "direct") return "Direct Pharmacy Connect (SIMULATED)";
  return "Manual eRx";
}
function softwareLabel(soft: string | null) {
  if (!soft || soft === "manual") return "Manual hand-off";
  const map: Record<string, string> = {
    pioneer_rx: "PioneerRx (SIMULATED)",
    qs1: "QS/1 (SIMULATED)",
    best_rx: "BestRx (SIMULATED)",
    rx30: "Rx30 (SIMULATED)",
    liberty: "Liberty Software (SIMULATED)",
  };
  return map[soft] || soft;
}

function Queue() {
  const { toast } = useToast();
  const { data: rxs = [], isLoading } = useQuery<Prescription[]>({ queryKey: ["/api/prescriptions"] });
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const fillAndClaim = useMutation({
    mutationFn: async (rx: Prescription) => {
      // Fill the Rx
      await apiRequest("POST", `/api/prescriptions/${rx.id}/fill`);
      // Auto-submit a $50 claim to DemoPBM (SIMULATED) so the pharmacy has
      // something to adjudicate + settle on the Claims tab.
      const claimRes = await apiRequest("POST", "/api/claims", {
        prescriptionId: rx.id,
        billedAmount: 50,
        payerName: "DemoPBM (SIMULATED)",
      });
      return claimRes.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/prescriptions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/claims"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ledger"] });
      toast({
        title: "Filled and claim submitted",
        description: `Claim ${data.claim?.claimNumber} anchored on XRPL Testnet · DemoPBM (SIMULATED).`,
      });
    },
    onError: (e: any) => toast({ title: "Could not fill / submit claim", description: e?.message, variant: "destructive" as any }),
  });

  const queue = rxs.filter((r) => r.status === "signed" || r.status === "transmitted" || r.status === "received");
  const filled = rxs.filter((r) => r.status === "filled");
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold mb-2">Active queue ({queue.length})</h2>
        <p className="text-xs text-muted-foreground mb-3">
          Signed prescriptions appear here once a prescriber routes them to this pharmacy. Each card shows the SIMULATED eRx outbox payload alongside the real XRPL Testnet anchor.
        </p>
        {isLoading && <Skel />}
        {!isLoading && queue.length === 0 && <Empty message="No prescriptions waiting. Signed Rx from prescribers appears here." />}
        <div className="space-y-2">
          {queue.map((r) => (
            <Card key={r.id} data-testid={`card-rx-${r.id}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="h-9 w-9 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <Pill className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs text-muted-foreground">{r.rxNumber}</span>
                        <Badge variant="outline" className={statusColor(r.status)}>{r.status}</Badge>
                        <Badge variant="outline" className="text-[10px]">{channelLabel(r.channel)}</Badge>
                        <Badge variant="outline" className="text-[10px]">{softwareLabel(r.destinationSoftware)}</Badge>
                      </div>
                      <p className="text-sm font-medium mt-1">{r.drug} {r.strength} {r.form}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">qty {r.quantity} · refills {r.refills} · DAW {r.daw ? "yes" : "no"}</p>
                      <p className="text-xs text-muted-foreground mt-1">Sig: {r.sig}</p>
                      {r.ledgerTxHash && <div className="mt-2"><LedgerProofBadge txHash={r.ledgerTxHash} label="Prescriber-signed" size="sm" /></div>}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    <Button size="sm" onClick={() => fillAndClaim.mutate(r)} disabled={fillAndClaim.isPending} data-testid={`button-fill-${r.id}`}>
                      Mark filled + submit claim
                    </Button>
                    {r.ncpdpScript && (
                      <Button size="sm" variant="ghost" onClick={() => setExpanded((s) => ({ ...s, [r.id]: !s[r.id] }))} data-testid={`button-toggle-erx-${r.id}`}>
                        {expanded[r.id] ? <><ChevronUp className="h-3.5 w-3.5 mr-1" />Hide eRx payload</> : <><ChevronDown className="h-3.5 w-3.5 mr-1" />View eRx payload</>}
                      </Button>
                    )}
                  </div>
                </div>
                {expanded[r.id] && r.ncpdpScript && (
                  <div className="mt-3 border-t border-border pt-3">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <Send className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-xs font-medium">eRx outbox · {channelLabel(r.channel)}</span>
                      <Badge variant="outline" className="text-[10px] border-amber-400/40 text-amber-700 dark:text-amber-300">SIMULATED</Badge>
                    </div>
                    <pre className="text-[10px] leading-snug bg-muted/40 border border-border rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-all max-h-64" data-testid={`pre-erx-${r.id}`}>{r.ncpdpScript}</pre>
                    <p className="text-[11px] text-muted-foreground mt-2">
                      HunaDoc is not a certified Surescripts or UEP node. The payload above is generated locally; the SHA-256 hash of this payload is anchored to XRPL Testnet via the prescriber-signed transaction shown above.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
      <div>
        <h3 className="text-sm font-semibold mb-2">Recently filled ({filled.length})</h3>
        <div className="space-y-1">
          {filled.slice(0, 8).map((r) => (
            <div key={r.id} className="flex items-center justify-between text-xs px-3 py-2 rounded-md border border-border bg-card/40">
              <span className="font-mono text-muted-foreground">{r.rxNumber}</span>
              <span>{r.drug} {r.strength}</span>
              <span className="text-muted-foreground">qty {r.quantity}</span>
              <Badge variant="outline" className={statusColor(r.status)}>{r.status}</Badge>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Claims() {
  const { toast } = useToast();
  const { data: claims = [], isLoading } = useQuery<Claim[]>({ queryKey: ["/api/claims"] });
  const { data: rxs = [] } = useQuery<Prescription[]>({ queryKey: ["/api/prescriptions"] });
  const { data: payerWallet } = useQuery<any>({ queryKey: ["/api/ledger/payer-wallet"] });
  const { data: pharmacyWallet } = useQuery<any>({ queryKey: ["/api/ledger/wallet"] });

  const adjudicate = useMutation({
    mutationFn: async (id: number) => {
      const r = await apiRequest("POST", `/api/claims/${id}/adjudicate`);
      return r.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/claims"] });
      const c = data.claim;
      toast({
        title: c.status === "rejected" ? "Claim rejected (SIMULATED)" : "Claim adjudicated (SIMULATED)",
        description: c.status === "rejected" ? c.rejectReason : `Approved $${c.adjudicatedAmount} · patient resp $${c.patientResponsibility}`,
      });
    },
  });
  const settle = useMutation({
    mutationFn: async (id: number) => {
      const r = await apiRequest("POST", `/api/claims/${id}/settle`);
      return r.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/claims"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ledger"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ledger/wallet"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ledger/payer-wallet"] });
      toast({
        title: "T0 settlement complete",
        description: `${data.broadcast?.amountXrp} XRP · tx ${data.broadcast?.txHash?.slice(0, 12)}…`,
      });
    },
    onError: (e: any) => toast({ title: "Settlement failed", description: e?.message, variant: "destructive" as any }),
  });

  const submitted = claims.filter((c) => c.status === "submitted");
  const adjudicated = claims.filter((c) => c.status === "adjudicated");
  const paid = claims.filter((c) => c.status === "paid");
  const rejected = claims.filter((c) => c.status === "rejected");

  const rxByIdMap = new Map(rxs.map((r) => [r.id, r]));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold mb-1">Claims & T0 settlements</h2>
        <p className="text-xs text-muted-foreground">
          PBM adjudication is SIMULATED. The settlement Payment is a real XRPL Testnet transaction from the SIMULATED PBM payer wallet to this pharmacy&rsquo;s HunaDoc wallet.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">DemoPBM payer wallet</span>
              <Badge variant="outline" className="text-[10px] border-amber-400/40 text-amber-700 dark:text-amber-300">SIMULATED PBM</Badge>
            </div>
            <div className="font-mono text-xs break-all">{payerWallet?.address || "—"}</div>
            <div className="text-sm font-semibold mt-1">{payerWallet?.balanceXRP?.toFixed(2) ?? "—"} XRP <span className="text-xs text-muted-foreground font-normal">on Testnet</span></div>
            {payerWallet?.explorerUrl && <a href={payerWallet.explorerUrl} target="_blank" rel="noreferrer" className="text-[11px] text-primary underline">View on XRPL Testnet explorer</a>}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Pharmacy receiving wallet</span>
              <Badge variant="outline" className="text-[10px]">REAL Testnet</Badge>
            </div>
            <div className="font-mono text-xs break-all">{pharmacyWallet?.address || "—"}</div>
            <div className="text-sm font-semibold mt-1">{pharmacyWallet?.balanceXRP?.toFixed(2) ?? "—"} XRP <span className="text-xs text-muted-foreground font-normal">on Testnet</span></div>
            {pharmacyWallet?.explorerUrl && <a href={pharmacyWallet.explorerUrl} target="_blank" rel="noreferrer" className="text-[11px] text-primary underline">View on XRPL Testnet explorer</a>}
          </CardContent>
        </Card>
      </div>

      {isLoading && <Skel />}
      {!isLoading && claims.length === 0 && <Empty message="No claims yet. Mark an Rx as filled to auto-submit a claim." />}

      <Section title={`Awaiting adjudication (${submitted.length})`} when={submitted.length > 0}>
        {submitted.map((c) => {
          const rx = rxByIdMap.get(c.prescriptionId);
          return (
            <ClaimRow key={c.id} claim={c} rx={rx} action={
              <Button size="sm" onClick={() => adjudicate.mutate(c.id)} disabled={adjudicate.isPending} data-testid={`button-adjudicate-${c.id}`}>
                <Receipt className="h-3.5 w-3.5 mr-1" />Adjudicate (SIMULATED)
              </Button>
            } />
          );
        })}
      </Section>

      <Section title={`Adjudicated · ready to settle (${adjudicated.length})`} when={adjudicated.length > 0}>
        {adjudicated.map((c) => {
          const rx = rxByIdMap.get(c.prescriptionId);
          return (
            <ClaimRow key={c.id} claim={c} rx={rx} action={
              <Button size="sm" onClick={() => settle.mutate(c.id)} disabled={settle.isPending} data-testid={`button-settle-${c.id}`}>
                Settle on XRPL
              </Button>
            } />
          );
        })}
      </Section>

      <Section title={`Paid · T0 settled (${paid.length})`} when={paid.length > 0}>
        {paid.map((c) => {
          const rx = rxByIdMap.get(c.prescriptionId);
          return <ClaimRow key={c.id} claim={c} rx={rx} />;
        })}
      </Section>

      <Section title={`Rejected (${rejected.length})`} when={rejected.length > 0}>
        {rejected.map((c) => {
          const rx = rxByIdMap.get(c.prescriptionId);
          return <ClaimRow key={c.id} claim={c} rx={rx} />;
        })}
      </Section>
    </div>
  );
}

function Section({ title, when, children }: { title: string; when: boolean; children: React.ReactNode }) {
  if (!when) return null;
  return (
    <div>
      <h3 className="text-sm font-semibold mb-2">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function ClaimRow({ claim, rx, action }: { claim: Claim; rx?: Prescription; action?: React.ReactNode }) {
  return (
    <Card data-testid={`card-claim-${claim.id}`}>
      <CardContent className="p-3 flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs text-muted-foreground">{claim.claimNumber}</span>
            <Badge variant="outline" className={statusColor(claim.status as any)}>{claim.status}</Badge>
            <Badge variant="outline" className="text-[10px]">{claim.payerName}</Badge>
            {rx && <span className="text-xs text-muted-foreground">Rx {rx.rxNumber} · {rx.drug} {rx.strength}</span>}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 mt-2 text-xs">
            <div><span className="text-muted-foreground">Billed</span><div className="font-medium">{fmtMoney(claim.billedAmount)}</div></div>
            <div><span className="text-muted-foreground">Adjudicated</span><div className="font-medium">{claim.adjudicatedAmount != null ? fmtMoney(claim.adjudicatedAmount) : "—"}</div></div>
            <div><span className="text-muted-foreground">Patient resp.</span><div className="font-medium">{claim.patientResponsibility != null ? fmtMoney(claim.patientResponsibility) : "—"}</div></div>
            <div><span className="text-muted-foreground">Settled</span><div className="font-medium">{claim.settlementAmountXrp != null ? `${claim.settlementAmountXrp} XRP` : "—"}</div></div>
          </div>
          {claim.rejectReason && <div className="mt-2 text-xs text-red-600 dark:text-red-400">Reject reason: {claim.rejectReason}</div>}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {claim.submitTxHash && <LedgerProofBadge txHash={claim.submitTxHash} label="Claim submitted" size="sm" />}
            {claim.settlementTxHash && <LedgerProofBadge txHash={claim.settlementTxHash} label="T0 settlement" size="sm" />}
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </CardContent>
    </Card>
  );
}

function Shifts() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: shifts = [], isLoading } = useQuery<Shift[]>({ queryKey: ["/api/shifts"] });
  // Newly-registered pharmacists available for staffing. The pharmacy view of
  // /api/users?role=pharmacist already excludes its own org, but we also hide
  // the seeded demo pharmacist so only self-registered pharmacists show.
  const { data: pharmacists = [] } = useQuery<User[]>({
    queryKey: ["/api/users", { role: "pharmacist" }],
    queryFn: async () => {
      const r = await apiRequest("GET", "/api/users?role=pharmacist");
      return r.json();
    },
  });
  const newPharmacists = pharmacists.filter((p) => p.email !== "pharmacist@demo.huna");
  // Medipharm employed pharmacists (permanent employees, not floaters).
  // Match by org name (case-insensitive, trimmed) OR by the three known emails,
  // so the picker always surfaces all three even if org metadata varies.
  const MEDIPHARM_EMAILS = new Set([
    "scottkim@yahoo.com",
    "cariniimi@gmail.com",
    "whitdang@yahoo.com",
  ]);
  const medipharmEmployees = newPharmacists.filter((p) => {
    const org = (p.organizationName ?? "").trim().toLowerCase();
    return org === "medipharm" || MEDIPHARM_EMAILS.has((p.email ?? "").toLowerCase());
  });
  const [open, setOpen] = useState(false);
  // "floater" = open marketplace shift; "employed" = pre-assigned to a Medipharm employee.
  const [shiftMode, setShiftMode] = useState<"floater" | "employed">("floater");
  const [assigneeId, setAssigneeId] = useState<string>("unassigned");
  const [form, setForm] = useState({
    title: "Floater pharmacist", date: "", startTime: "09:00", endTime: "17:00",
    hourlyRate: "85", location: "Honolulu, HI", urgency: "routine" as const, notes: "",
  });
  // Switch the default title and assignee list as the operator toggles between
  // a marketplace floater shift and a permanent employee shift.
  const handleShiftModeChange = (mode: "floater" | "employed") => {
    setShiftMode(mode);
    if (mode === "employed") {
      // Force a fresh fetch so the picker always shows the latest seeded employees.
      queryClient.invalidateQueries({ queryKey: ["/api/users", { role: "pharmacist" }] });
      setForm((f) => ({
        ...f,
        title: f.title === "Floater pharmacist" ? "Employed Pharmacist" : f.title,
      }));
      // Default to first Medipharm employee if available, otherwise unassigned.
      setAssigneeId(medipharmEmployees[0] ? String(medipharmEmployees[0].id) : "unassigned");
    } else {
      setForm((f) => ({
        ...f,
        title: f.title === "Employed Pharmacist" ? "Floater pharmacist" : f.title,
      }));
      setAssigneeId("unassigned");
    }
  };
  const post = useMutation({
    mutationFn: async () => {
      const body = { ...form, hourlyRate: parseFloat(form.hourlyRate) };
      const r = await apiRequest("POST", "/api/shifts", body);
      const created = await r.json();
      // If the pharmacy pre-selected a pharmacist, auto-assign the shift.
      if (assigneeId && assigneeId !== "unassigned" && created?.id) {
        await apiRequest("POST", `/api/shifts/${created.id}/assign`, {
          pharmacistId: parseInt(assigneeId, 10),
        });
      }
      return created;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      toast({
        title: assigneeId !== "unassigned" ? "Shift posted and assigned" : "Shift posted",
      });
      setOpen(false);
      setAssigneeId("unassigned");
      setShiftMode("floater");
      setForm((f) => ({ ...f, title: "Floater pharmacist" }));
    },
  });
  const mine = shifts.filter((s) => s.pharmacyId === user?.id);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">My shifts ({mine.length})</h2>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="button-post-shift"><Plus className="h-3.5 w-3.5 mr-1" />Post shift</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Post staffing shift</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Shift type</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant={shiftMode === "floater" ? "default" : "outline"}
                    size="sm"
                    onClick={() => handleShiftModeChange("floater")}
                    data-testid="button-shift-mode-floater"
                  >
                    Floater (marketplace)
                  </Button>
                  <Button
                    type="button"
                    variant={shiftMode === "employed" ? "default" : "outline"}
                    size="sm"
                    onClick={() => handleShiftModeChange("employed")}
                    data-testid="button-shift-mode-employed"
                  >
                    Employed Pharmacist
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {shiftMode === "employed"
                    ? "Permanent employee — pre-assigns the shift to an active Medipharm pharmacist."
                    : "Open marketplace shift — any verified pharmacist can accept."}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Title</Label>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="input-shift-title" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>Date</Label>
                  <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} data-testid="input-shift-date" />
                </div>
                <div className="space-y-1.5">
                  <Label>Start</Label>
                  <Input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} data-testid="input-shift-start" />
                </div>
                <div className="space-y-1.5">
                  <Label>End</Label>
                  <Input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} data-testid="input-shift-end" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Hourly rate (USD)</Label>
                  <Input type="number" value={form.hourlyRate} onChange={(e) => setForm({ ...form, hourlyRate: e.target.value })} data-testid="input-shift-rate" />
                </div>
                <div className="space-y-1.5">
                  <Label>Urgency</Label>
                  <Select value={form.urgency} onValueChange={(v) => setForm({ ...form, urgency: v as any })}>
                    <SelectTrigger data-testid="select-shift-urgency"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="routine">Routine</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                      <SelectItem value="stat">STAT</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Location</Label>
                <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} data-testid="input-shift-location" />
              </div>
              <div className="space-y-1.5">
                <Label>Notes</Label>
                <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} data-testid="input-shift-notes" />
              </div>
              {shiftMode === "employed" ? (
                <div className="space-y-1.5">
                  <Label>Actively assigned</Label>
                  <Select value={assigneeId} onValueChange={setAssigneeId}>
                    <SelectTrigger data-testid="select-shift-employee">
                      <SelectValue placeholder="Select a Medipharm pharmacist" />
                    </SelectTrigger>
                    <SelectContent className="max-h-64 overflow-y-auto">
                      {medipharmEmployees.length === 0 && (
                        <div className="px-2 py-3 text-xs text-muted-foreground">No Medipharm pharmacists registered yet.</div>
                      )}
                      {medipharmEmployees.map((p) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.fullName}
                          {p.organizationName ? ` · ${p.organizationName}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    Scroll to pick a permanent Medipharm employee. The shift will be pre-assigned and anchored to the ledger.
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label>Assign pharmacist (optional)</Label>
                  <Select value={assigneeId} onValueChange={setAssigneeId}>
                    <SelectTrigger data-testid="select-shift-pharmacist">
                      <SelectValue placeholder="Leave open to the pharmacist marketplace" />
                    </SelectTrigger>
                    <SelectContent className="max-h-64 overflow-y-auto">
                      <SelectItem value="unassigned">Leave open to marketplace</SelectItem>
                      {newPharmacists.length === 0 && (
                        <div className="px-2 py-3 text-xs text-muted-foreground">No newly registered pharmacists yet.</div>
                      )}
                      {newPharmacists.map((p) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.fullName}
                          {p.organizationName ? ` · ${p.organizationName}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    Scroll to pick a newly registered pharmacist, or leave open so any verified pharmacist can accept.
                  </p>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button
                onClick={() => post.mutate()}
                disabled={
                  !form.date ||
                  post.isPending ||
                  (shiftMode === "employed" && (assigneeId === "unassigned" || !assigneeId))
                }
                data-testid="button-submit-shift"
              >
                {shiftMode === "employed" ? "Post and assign" : "Post shift"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {isLoading && <Skel />}
      {!isLoading && mine.length === 0 && <Empty message="No shifts posted yet." />}
      <div className="grid gap-2">
        {mine.map((s) => (
          <Card key={s.id}>
            <CardContent className="p-4 flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-medium text-sm">{s.title}</h3>
                  <Badge variant="outline" className={statusColor(s.status)}>{s.status}</Badge>
                  <Badge variant="outline" className={urgencyColor(s.urgency)}>{s.urgency}</Badge>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 text-xs text-muted-foreground">
                  <span><Clock className="h-3 w-3 inline mr-1" />{fmtDate(s.date)} {s.startTime}-{s.endTime}</span>
                  <span><Briefcase className="h-3 w-3 inline mr-1" />{fmtMoney(s.hourlyRate)}/hr</span>
                </div>
                {s.ledgerTxHash && <div className="mt-2"><LedgerProofBadge txHash={s.ledgerTxHash} size="sm" /></div>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Skel() {
  return <div className="grid gap-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 rounded-lg border border-border bg-card animate-pulse" />)}</div>;
}

function pharmacyTypeLabel(t: string): string {
  if (t === "ncpdp") return "NCPDP";
  if (t === "pharmacy_dea") return "DEA #";
  if (t === "pharmacy_npi") return "NPI #";
  if (t === "pharmacy_license") return "Pharmacy License #";
  if (t === "pic_number") return "PIC # (Pharmacist In Charge)";
  return t.replace(/_/g, " ");
}

function PharmacyProfile() {
  const { toast } = useToast();
  const { data: licenses = [], isLoading } = useQuery<License[]>({ queryKey: ["/api/licenses"] });
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("ncpdp");
  const [number, setNumber] = useState("");
  const [state, setState] = useState("HI");
  const [exp, setExp] = useState("");
  const create = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/licenses", {
        type, number, issuingState: state, expirationDate: exp || null,
      });
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/licenses"] });
      toast({ title: "Credential submitted", description: "Awaiting manager verification + XRPL anchor." });
      setOpen(false);
      setNumber("");
    },
  });
  const pharmacyTypes = ["ncpdp", "pharmacy_dea", "pharmacy_npi", "pharmacy_license", "pic_number"];
  const pharmacyLicenses = licenses.filter((l) => pharmacyTypes.includes(l.type));
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Pharmacy profile</h2>
        <p className="text-xs text-muted-foreground mt-1">Manage your pharmacy registrations and licenses. Each is verified by a manager and anchored to the XRP Ledger.</p>
      </div>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Credentials</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="button-add-pharmacy-credential"><Plus className="h-3.5 w-3.5 mr-1" />Add credential</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add pharmacy credential</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger data-testid="select-pharmacy-credential-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ncpdp">NCPDP</SelectItem>
                    <SelectItem value="pharmacy_dea">DEA #</SelectItem>
                    <SelectItem value="pharmacy_npi">NPI #</SelectItem>
                    <SelectItem value="pharmacy_license">Pharmacy License #</SelectItem>
                    <SelectItem value="pic_number">PIC # (Pharmacist In Charge)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>License number</Label>
                  <Input value={number} onChange={(e) => setNumber(e.target.value)} data-testid="input-pharmacy-credential-number" />
                </div>
                <div className="space-y-1.5">
                  <Label>State</Label>
                  <Input value={state} onChange={(e) => setState(e.target.value)} maxLength={2} data-testid="input-pharmacy-credential-state" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Expiration</Label>
                <Input type="date" value={exp} onChange={(e) => setExp(e.target.value)} data-testid="input-pharmacy-credential-exp" />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => create.mutate()} disabled={!number || create.isPending} data-testid="button-submit-pharmacy-credential">
                Submit for verification
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {isLoading && <Skel />}
      {!isLoading && pharmacyLicenses.length === 0 && <Empty message="No pharmacy credentials on file. Add NCPDP, DEA, NPI, Pharmacy License, and PIC." />}
      <div className="grid gap-3">
        {pharmacyLicenses.map((l) => (
          <Card key={l.id}>
            <CardContent className="p-4 flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <div className="h-9 w-9 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <FileBadge2 className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-medium text-sm">{pharmacyTypeLabel(l.type)}</h3>
                    <Badge variant="outline" className={statusColor(l.status)}>{l.status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 font-mono">{l.number} · {l.issuingState} · expires {l.expirationDate || "—"}</p>
                  {l.ledgerTxHash && (
                    <div className="mt-2"><LedgerProofBadge txHash={l.ledgerTxHash} label="Manager-verified" size="sm" /></div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
function Empty({ message }: { message: string }) {
  return <Card className="border-dashed"><CardContent className="p-8 text-center text-sm text-muted-foreground">{message}</CardContent></Card>;
}
