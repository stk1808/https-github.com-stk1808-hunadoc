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
import { Plus, FileSignature, Video, Phone, User as UserIcon, Calendar } from "lucide-react";
import type { Patient, Prescription, Visit, User } from "@/lib/types";
import { fmtDate, fmtDateTime, statusColor } from "@/lib/format";

const NAV = [
  { label: "Patients", path: "/dashboard/prescriber", testId: "nav-prescriber-patients" },
  { label: "Prescribe", path: "/dashboard/prescriber/prescribe", testId: "nav-prescriber-prescribe" },
  { label: "Telehealth", path: "/dashboard/prescriber/visits", testId: "nav-prescriber-visits" },
];

export default function PrescriberDashboard() {
  const [, params] = useRoute("/dashboard/prescriber/:tab?");
  const tab = params?.tab || "patients";
  return (
    <AppShell title="Prescriber workspace" subtitle="Manage patients, sign prescriptions, conduct telehealth visits." nav={NAV}>
      {tab === "patients" && <Patients />}
      {tab === "prescribe" && <Prescribe />}
      {tab === "visits" && <Visits />}
    </AppShell>
  );
}

function Patients() {
  const { toast } = useToast();
  const { data: patients = [], isLoading } = useQuery<Patient[]>({ queryKey: ["/api/patients"] });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    mrn: "", firstName: "", lastName: "", dob: "", sex: "M",
    email: "", phone: "", allergies: "",
  });
  const create = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/patients", form);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/patients"] });
      toast({ title: "Patient added" });
      setOpen(false);
      setForm({ mrn: "", firstName: "", lastName: "", dob: "", sex: "M", email: "", phone: "", allergies: "" });
    },
  });
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Patients ({patients.length})</h2>
          <p className="text-xs text-muted-foreground">Test-only records. Use synthetic identifiers.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="button-add-patient"><Plus className="h-3.5 w-3.5 mr-1" />New patient</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add patient (TEST)</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>MRN</Label>
                  <Input value={form.mrn} onChange={(e) => setForm({ ...form, mrn: e.target.value })} data-testid="input-patient-mrn" placeholder="MRN-885-XXXX" />
                </div>
                <div className="space-y-1.5">
                  <Label>Sex</Label>
                  <Select value={form.sex} onValueChange={(v) => setForm({ ...form, sex: v })}>
                    <SelectTrigger data-testid="select-patient-sex"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="M">M</SelectItem>
                      <SelectItem value="F">F</SelectItem>
                      <SelectItem value="X">Non-binary</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>First name</Label>
                  <Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} data-testid="input-patient-first" />
                </div>
                <div className="space-y-1.5">
                  <Label>Last name</Label>
                  <Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} data-testid="input-patient-last" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>DOB</Label>
                <Input type="date" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} data-testid="input-patient-dob" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="input-patient-email" />
                </div>
                <div className="space-y-1.5">
                  <Label>Phone</Label>
                  <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="input-patient-phone" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Allergies</Label>
                <Textarea rows={2} value={form.allergies} onChange={(e) => setForm({ ...form, allergies: e.target.value })} data-testid="input-patient-allergies" />
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => create.mutate()}
                disabled={!form.mrn || !form.firstName || !form.lastName || !form.dob || create.isPending}
                data-testid="button-submit-patient"
              >Save patient</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {isLoading && <Skel />}
      {!isLoading && patients.length === 0 && <Empty message="No patients yet. Add a test patient to start prescribing." />}
      <div className="grid gap-2">
        {patients.map((p) => (
          <Card key={p.id} data-testid={`card-patient-${p.id}`}>
            <CardContent className="p-3 flex items-center gap-4">
              <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <UserIcon className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="font-medium text-sm">{p.firstName} {p.lastName}</span>
                  <span className="text-xs font-mono text-muted-foreground">{p.mrn}</span>
                </div>
                <div className="text-xs text-muted-foreground">DOB {fmtDate(p.dob)} · {p.sex || "—"}{p.allergies ? ` · Allergies: ${p.allergies}` : ""}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Prescribe() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: patients = [] } = useQuery<Patient[]>({ queryKey: ["/api/patients"] });
  const { data: rxs = [], isLoading } = useQuery<Prescription[]>({ queryKey: ["/api/prescriptions"] });
  const { data: pharmacies = [] } = useQuery<any[]>({ queryKey: ["/api/users", "pharmacy"], queryFn: async () => {
    const r = await apiRequest("GET", "/api/users?role=pharmacy");
    return r.json();
  }});
  const { data: laiPharmacists = [] } = useQuery<User[]>({ queryKey: ["/api/users", "pharmacist", "laiCertified"], queryFn: async () => {
    const r = await apiRequest("GET", "/api/users?role=pharmacist&laiCertified=1");
    return r.json();
  }});
  const [form, setForm] = useState({
    patientId: "", drug: "", strength: "", form: "tablet", sig: "", quantity: "", refills: "0",
    channel: "manual" as "manual" | "surescripts" | "direct",
    destinationSoftware: "manual" as "manual" | "pioneer_rx" | "qs1" | "best_rx" | "rx30" | "liberty",
    pharmacyId: "",
    isLai: false,
    laiSchedule: "asap" as "asap" | "monthly" | "q2w" | "q4w" | "q3month" | "q6month",
    mobilePharmacistId: "",
  });
  const LAI_DRUG_KEYWORDS = [
    "aristada", "invega sustenna", "invega trinza", "invega hafyera",
    "abilify maintena", "abilify asimtufii", "asimtufii",
    "risperdal consta", "perseris", "uzedy", "zyprexa relprevv",
    "sublocade", "brixadi", "vivitrol",
    "haldol decanoate", "prolixin decanoate",
  ];
  const detectedLai = !!form.drug && LAI_DRUG_KEYWORDS.some((k) => form.drug.toLowerCase().includes(k));
  const showLaiSection = detectedLai || form.isLai;
  const create = useMutation({
    mutationFn: async () => {
      const body: any = {
        patientId: parseInt(form.patientId),
        drug: form.drug, strength: form.strength, form: form.form,
        sig: form.sig, quantity: form.quantity, refills: parseInt(form.refills),
        channel: form.channel, destinationSoftware: form.destinationSoftware,
      };
      if (form.pharmacyId) body.pharmacyId = parseInt(form.pharmacyId);
      const r = await apiRequest("POST", "/api/prescriptions", body);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/prescriptions"] });
      toast({ title: "Draft created", description: "Sign to broadcast to XRPL and route." });
      setForm({ patientId: "", drug: "", strength: "", form: "tablet", sig: "", quantity: "", refills: "0", channel: "manual", destinationSoftware: "manual", pharmacyId: "", isLai: false, laiSchedule: "asap", mobilePharmacistId: "" });
    },
  });
  const sign = useMutation({
    mutationFn: async (id: number) => {
      // Resend the routing fields at sign time — server uses these if the draft
      // didn't have them set yet.
      const body: any = {
        routingChannel: form.channel,
        destinationSoftware: form.destinationSoftware,
        pharmacyId: form.pharmacyId ? parseInt(form.pharmacyId) : undefined,
      };
      if (showLaiSection) {
        body.isLai = true;
        body.laiSchedule = form.laiSchedule;
        if (form.mobilePharmacistId) body.mobilePharmacistId = parseInt(form.mobilePharmacistId);
      }
      const r = await apiRequest("POST", `/api/prescriptions/${id}/sign`, body);
      return r.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/prescriptions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ledger"] });
      toast({
        title: "Prescription signed, anchored, and routed",
        description: `XRPL tx ${data.broadcast?.txHash?.slice(0, 12)}… · sent to pharmacy queue (SIMULATED).`,
      });
    },
  });
  const drafts = rxs.filter((r) => r.status === "draft");
  const signed = rxs.filter((r) => r.status !== "draft");
  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <Card>
        <CardContent className="p-5 space-y-3">
          <h2 className="text-base font-semibold">New prescription</h2>
          <div className="space-y-1.5">
            <Label>Patient</Label>
            <Select value={form.patientId} onValueChange={(v) => setForm({ ...form, patientId: v })}>
              <SelectTrigger data-testid="select-rx-patient"><SelectValue placeholder="Select patient" /></SelectTrigger>
              <SelectContent>
                {patients.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.firstName} {p.lastName} · {p.mrn}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Drug</Label>
              <Input value={form.drug} onChange={(e) => setForm({ ...form, drug: e.target.value })} data-testid="input-rx-drug" placeholder="Lisinopril" />
            </div>
            <div className="space-y-1.5">
              <Label>Strength</Label>
              <Input value={form.strength} onChange={(e) => setForm({ ...form, strength: e.target.value })} data-testid="input-rx-strength" placeholder="10 mg" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Form</Label>
              <Select value={form.form} onValueChange={(v) => setForm({ ...form, form: v })}>
                <SelectTrigger data-testid="select-rx-form"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="tablet">Tablet</SelectItem>
                  <SelectItem value="capsule">Capsule</SelectItem>
                  <SelectItem value="solution">Solution</SelectItem>
                  <SelectItem value="cream">Cream</SelectItem>
                  <SelectItem value="inhaler">Inhaler</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Quantity</Label>
              <Input value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} data-testid="input-rx-qty" placeholder="30" />
            </div>
            <div className="space-y-1.5">
              <Label>Refills</Label>
              <Input value={form.refills} onChange={(e) => setForm({ ...form, refills: e.target.value })} data-testid="input-rx-refills" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Sig</Label>
            <Textarea rows={2} value={form.sig} onChange={(e) => setForm({ ...form, sig: e.target.value })} data-testid="input-rx-sig" placeholder="Take 1 tablet by mouth daily" />
          </div>
          <div className="space-y-1.5">
            <Label>Routing channel</Label>
            <Select value={form.channel} onValueChange={(v) => setForm({ ...form, channel: v as any })}>
              <SelectTrigger data-testid="select-rx-channel"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual (alpha)</SelectItem>
                <SelectItem value="surescripts">Surescripts NewRx (SIMULATED)</SelectItem>
                <SelectItem value="direct">Direct Pharmacy Connect (SIMULATED)</SelectItem>
              </SelectContent>
            </Select>
            {form.channel !== "manual" && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                Honest label: HunaDoc is not yet a certified Surescripts/UEP node. The eRx payload is generated and the SHA-256 hash is anchored to XRPL Testnet.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Destination pharmacy software</Label>
            <Select value={form.destinationSoftware} onValueChange={(v) => setForm({ ...form, destinationSoftware: v as any })}>
              <SelectTrigger data-testid="select-rx-destination-software"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual hand-off</SelectItem>
                <SelectItem value="pioneer_rx">PioneerRx (SIMULATED)</SelectItem>
                <SelectItem value="qs1">QS/1 (SIMULATED)</SelectItem>
                <SelectItem value="best_rx">BestRx (SIMULATED)</SelectItem>
                <SelectItem value="rx30">Rx30 (SIMULATED)</SelectItem>
                <SelectItem value="liberty">Liberty Software (SIMULATED)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Pharmacy (HunaDoc)</Label>
            <Select value={form.pharmacyId} onValueChange={(v) => setForm({ ...form, pharmacyId: v })}>
              <SelectTrigger data-testid="select-rx-pharmacy"><SelectValue placeholder="Select pharmacy" /></SelectTrigger>
              <SelectContent>
                {pharmacies.map((p: any) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.organizationName || p.fullName} · NCPDP {p.ncpdp || "—"}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">When set, the signed Rx appears in this pharmacy’s Active queue immediately.</p>
          </div>

          {/* LAI section */}
          <div className="rounded-md border border-border bg-muted/30 p-3 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium">Long-acting injectable (LAI) administration</div>
                <div className="text-[11px] text-muted-foreground">
                  {detectedLai
                    ? "Detected from drug name. Toggle locked on. Pick a schedule and a mobile LAI-certified pharmacist below."
                    : "Toggle on for clinic-administered injectables (Aristada, Invega Sustenna, Sublocade, etc.)."}
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={showLaiSection}
                  disabled={detectedLai}
                  onChange={(e) => setForm({ ...form, isLai: e.target.checked })}
                  data-testid="toggle-rx-lai"
                  className="h-4 w-4"
                />
                <span>{showLaiSection ? "On" : "Off"}</span>
              </label>
            </div>
            {showLaiSection && (
              <>
                <div className="space-y-1.5">
                  <Label>Schedule</Label>
                  <Select value={form.laiSchedule} onValueChange={(v) => setForm({ ...form, laiSchedule: v as any })}>
                    <SelectTrigger data-testid="select-lai-schedule"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="asap">ASAP (one-time, timestamped on administration)</SelectItem>
                      <SelectItem value="monthly">Monthly recurring</SelectItem>
                      <SelectItem value="q2w">Every 2 weeks (q2w)</SelectItem>
                      <SelectItem value="q4w">Every 4 weeks (q4w)</SelectItem>
                      <SelectItem value="q3month">Every 3 months (q3 month)</SelectItem>
                      <SelectItem value="q6month">Every 6 months (q6 month)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Mobile pharmacist (LAI-certified)</Label>
                  <Select value={form.mobilePharmacistId} onValueChange={(v) => setForm({ ...form, mobilePharmacistId: v })}>
                    <SelectTrigger data-testid="select-lai-pharmacist"><SelectValue placeholder={laiPharmacists.length ? "Select pharmacist" : "No LAI-certified pharmacists available"} /></SelectTrigger>
                    <SelectContent>
                      {laiPharmacists.map((p) => (
                        <SelectItem key={p.id} value={String(p.id)}>{p.fullName} · {p.email}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    On signing, this pharmacist receives the order in their LAI administrations queue with a real XRPL Testnet anchor. Each administration is timestamped and triggers a SIMULATED $150 admin-fee claim with T0 settlement.
                  </p>
                </div>
              </>
            )}
          </div>

          <Button
            onClick={() => create.mutate()}
            disabled={!form.patientId || !form.drug || !form.sig || !form.quantity || create.isPending}
            className="w-full"
            data-testid="button-save-draft-rx"
          >Save as draft</Button>
        </CardContent>
      </Card>
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold mb-2">Drafts ({drafts.length})</h3>
          {drafts.length === 0 && <Empty message="No drafts. Create one on the left." />}
          <div className="space-y-2">
            {drafts.map((r) => (
              <Card key={r.id}>
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-mono text-muted-foreground">{r.rxNumber}</div>
                    <div className="text-sm font-medium">{r.drug} {r.strength}</div>
                    <div className="text-xs text-muted-foreground line-clamp-1">{r.sig}</div>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      {r.channel && r.channel !== "manual" && (
                        <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                          {r.channel === "surescripts" ? "Surescripts" : "Direct"} · SIM
                        </Badge>
                      )}
                      {r.destinationSoftware && r.destinationSoftware !== "manual" && (
                        <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                          {r.destinationSoftware.replace(/_/g, " ").toUpperCase()} · SIM
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Button size="sm" disabled={sign.isPending} onClick={() => sign.mutate(r.id)} data-testid={`button-sign-rx-${r.id}`}>
                    <FileSignature className="h-3.5 w-3.5 mr-1" />
                    {form.channel === "manual" ? "Sign + anchor" : "Send NewRx + anchor"}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
        <div>
          <h3 className="text-sm font-semibold mb-2">Signed history ({signed.length})</h3>
          {isLoading && <Skel />}
          <div className="space-y-2">
            {signed.map((r) => (
              <Card key={r.id}>
                <CardContent className="p-3">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-xs font-mono text-muted-foreground">{r.rxNumber}</span>
                    <Badge variant="outline" className={statusColor(r.status)}>{r.status}</Badge>
                  </div>
                  <div className="text-sm">{r.drug} {r.strength} · qty {r.quantity}</div>
                  {r.ledgerTxHash && <div className="mt-2"><LedgerProofBadge txHash={r.ledgerTxHash} size="sm" /></div>}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Visits() {
  const { toast } = useToast();
  const { data: patients = [] } = useQuery<Patient[]>({ queryKey: ["/api/patients"] });
  const { data: visits = [], isLoading } = useQuery<Visit[]>({ queryKey: ["/api/visits"] });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ patientId: "", scheduledFor: "", reason: "" });
  const [activeVisit, setActiveVisit] = useState<Visit | null>(null);
  const [endNotes, setEndNotes] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      const body = { ...form, patientId: parseInt(form.patientId) };
      const r = await apiRequest("POST", "/api/visits", body);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/visits"] });
      setOpen(false);
      setForm({ patientId: "", scheduledFor: "", reason: "" });
      toast({ title: "Visit scheduled" });
    },
  });
  const start = useMutation({
    mutationFn: async (id: number) => {
      const r = await apiRequest("POST", `/api/visits/${id}/start`);
      return r.json();
    },
    onSuccess: (v: Visit) => {
      queryClient.invalidateQueries({ queryKey: ["/api/visits"] });
      setActiveVisit(v);
      setEndNotes("");
    },
  });
  const end = useMutation({
    mutationFn: async () => {
      if (!activeVisit) return;
      const r = await apiRequest("POST", `/api/visits/${activeVisit.id}/end`, { notes: endNotes });
      return r.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/visits"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ledger"] });
      setActiveVisit(null);
      toast({
        title: "Visit completed and anchored",
        description: `Note hash anchored · ${data.broadcast?.txHash?.slice(0, 12)}…`,
      });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Telehealth visits ({visits.length})</h2>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="button-schedule-visit"><Plus className="h-3.5 w-3.5 mr-1" />Schedule visit</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Schedule telehealth visit</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Patient</Label>
                <Select value={form.patientId} onValueChange={(v) => setForm({ ...form, patientId: v })}>
                  <SelectTrigger data-testid="select-visit-patient"><SelectValue placeholder="Select patient" /></SelectTrigger>
                  <SelectContent>
                    {patients.map((p) => (<SelectItem key={p.id} value={String(p.id)}>{p.firstName} {p.lastName}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Scheduled for</Label>
                <Input type="datetime-local" value={form.scheduledFor} onChange={(e) => setForm({ ...form, scheduledFor: e.target.value })} data-testid="input-visit-scheduled" />
              </div>
              <div className="space-y-1.5">
                <Label>Reason</Label>
                <Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} data-testid="input-visit-reason" />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => create.mutate()} disabled={!form.patientId || !form.scheduledFor || create.isPending} data-testid="button-submit-visit">
                Schedule
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Active visit "video" panel — mock UI */}
      {activeVisit && (
        <Card className="border-primary/40 bg-primary/[0.03]" data-testid="card-active-visit">
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-xs font-medium uppercase tracking-wider">Live · simulated</span>
            </div>
            <div className="aspect-video w-full rounded-lg bg-gradient-to-br from-slate-900 to-slate-800 border border-border flex items-center justify-center relative overflow-hidden">
              <div className="absolute inset-0 opacity-20" style={{
                backgroundImage: "radial-gradient(circle at 50% 50%, hsl(var(--primary)) 0, transparent 60%)",
              }} />
              <div className="text-center text-slate-300 relative">
                <Video className="h-10 w-10 mx-auto mb-2 opacity-60" />
                <p className="text-sm">Telehealth video stream (mocked for alpha)</p>
                <p className="text-xs opacity-60 mt-1">Visit #{activeVisit.id} · {activeVisit.reason}</p>
              </div>
              <div className="absolute bottom-3 left-3 right-3 flex items-center justify-center gap-2">
                <Button size="icon" variant="secondary" className="h-9 w-9" data-testid="button-mute"><Phone className="h-4 w-4" /></Button>
                <Button size="icon" variant="secondary" className="h-9 w-9" data-testid="button-camera"><Video className="h-4 w-4" /></Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Visit notes (will be hashed and anchored)</Label>
              <Textarea
                rows={4}
                value={endNotes}
                onChange={(e) => setEndNotes(e.target.value)}
                placeholder="Subjective, objective, assessment, plan…"
                data-testid="input-visit-notes"
              />
              <p className="text-xs text-muted-foreground">Notes stay in HunaDoc. Only their SHA-256 hash is broadcast to XRPL.</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setActiveVisit(null)} data-testid="button-cancel-visit">Cancel</Button>
              <Button onClick={() => end.mutate()} disabled={!endNotes || end.isPending} data-testid="button-end-visit">
                End visit + anchor hash
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading && <Skel />}
      {!isLoading && visits.length === 0 && <Empty message="No visits scheduled." />}
      <div className="grid gap-2">
        {visits.map((v) => (
          <Card key={v.id}>
            <CardContent className="p-3 flex items-center gap-4">
              <div className="h-9 w-9 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Calendar className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{v.reason}</span>
                  <Badge variant="outline" className={statusColor(v.status)}>{v.status}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">{fmtDateTime(v.scheduledFor)}</div>
                {v.ledgerTxHash && <div className="mt-1"><LedgerProofBadge txHash={v.ledgerTxHash} label="Note hash anchored" size="sm" /></div>}
              </div>
              {v.status === "scheduled" && (
                <Button size="sm" onClick={() => start.mutate(v.id)} disabled={start.isPending} data-testid={`button-start-visit-${v.id}`}>
                  <Video className="h-3.5 w-3.5 mr-1" />Start
                </Button>
              )}
              {v.status === "live" && !activeVisit && (
                <Button size="sm" variant="outline" onClick={() => setActiveVisit(v)} data-testid={`button-rejoin-visit-${v.id}`}>Rejoin</Button>
              )}
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
function Empty({ message }: { message: string }) {
  return <Card className="border-dashed"><CardContent className="p-8 text-center text-sm text-muted-foreground">{message}</CardContent></Card>;
}
