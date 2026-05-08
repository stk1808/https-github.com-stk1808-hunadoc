import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/components/AuthContext";
import { AppShell } from "@/components/AppShell";
import { LedgerProofBadge } from "@/components/LedgerProofBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { useLocation, useRoute } from "wouter";
import { Briefcase, CheckCircle2, Clock, MapPin, FileBadge2, Plus } from "lucide-react";
import type { Shift, License, Prescription, User } from "@/lib/types";
import { fmtDate, fmtMoney, statusColor, urgencyColor } from "@/lib/format";

const NAV = [
  { label: "Open shifts", path: "/dashboard/pharmacist", testId: "nav-pharmacist-shifts" },
  { label: "My shifts", path: "/dashboard/pharmacist/my", testId: "nav-pharmacist-my" },
  { label: "Rx queue", path: "/dashboard/pharmacist/rx", testId: "nav-pharmacist-rx" },
  { label: "Credentials", path: "/dashboard/pharmacist/credentials", testId: "nav-pharmacist-creds" },
];

export default function PharmacistDashboard() {
  const [, params] = useRoute("/dashboard/pharmacist/:tab?");
  const tab = params?.tab || "open";
  return (
    <AppShell title="Pharmacist workspace" subtitle="Accept shifts, fill prescriptions, manage your credentials." nav={NAV}>
      {tab === "open" && <OpenShifts />}
      {tab === "my" && <MyShifts />}
      {tab === "rx" && <RxQueue />}
      {tab === "credentials" && <Credentials />}
    </AppShell>
  );
}

function OpenShifts() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: shifts = [], isLoading } = useQuery<Shift[]>({ queryKey: ["/api/shifts"] });
  const acceptMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await apiRequest("POST", `/api/shifts/${id}/accept`);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      toast({ title: "Shift accepted", description: "You'll see it under My shifts." });
    },
  });
  const open = shifts.filter((s) => s.status === "open");
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Open shifts ({open.length})</h2>
          <p className="text-xs text-muted-foreground">Accept a shift to commit. Completion is broadcast to XRPL.</p>
        </div>
      </div>
      {isLoading && <SkeletonList />}
      {!isLoading && open.length === 0 && <EmptyCard message="No open shifts right now. Check back soon." />}
      <div className="grid gap-3">
        {open.map((s) => (
          <Card key={s.id} className="hover-elevate">
            <CardContent className="p-4 flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-sm" data-testid={`text-shift-title-${s.id}`}>{s.title}</h3>
                  <Badge variant="outline" className={urgencyColor(s.urgency)}>{s.urgency}</Badge>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 text-xs text-muted-foreground">
                  <Cell icon={Clock}>{fmtDate(s.date)} · {s.startTime}–{s.endTime}</Cell>
                  <Cell icon={MapPin}>{s.location}</Cell>
                  <Cell icon={Briefcase}>{fmtMoney(s.hourlyRate)}/hr</Cell>
                </div>
                {s.notes && <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{s.notes}</p>}
              </div>
              <Button
                size="sm"
                disabled={acceptMut.isPending}
                onClick={() => acceptMut.mutate(s.id)}
                data-testid={`button-accept-shift-${s.id}`}
              >
                Accept shift
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function MyShifts() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: shifts = [], isLoading } = useQuery<Shift[]>({ queryKey: ["/api/shifts"] });
  const completeMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await apiRequest("POST", `/api/shifts/${id}/complete`);
      return r.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ledger"] });
      toast({
        title: "Shift completed",
        description: `Anchored to XRPL · ${data.broadcast?.txHash?.slice(0, 12)}…`,
      });
    },
  });
  const mine = shifts.filter((s) => s.pharmacistId === user?.id);
  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold">My shifts ({mine.length})</h2>
      {isLoading && <SkeletonList />}
      {!isLoading && mine.length === 0 && <EmptyCard message="You haven't accepted any shifts yet." />}
      <div className="grid gap-3">
        {mine.map((s) => (
          <Card key={s.id} data-testid={`card-my-shift-${s.id}`}>
            <CardContent className="p-4 flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-sm">{s.title}</h3>
                  <Badge variant="outline" className={statusColor(s.status)}>{s.status}</Badge>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 text-xs text-muted-foreground">
                  <Cell icon={Clock}>{fmtDate(s.date)} · {s.startTime}–{s.endTime}</Cell>
                  <Cell icon={MapPin}>{s.location}</Cell>
                  <Cell icon={Briefcase}>{fmtMoney(s.hourlyRate)}/hr</Cell>
                </div>
                {s.ledgerTxHash && (
                  <div className="mt-3">
                    <LedgerProofBadge txHash={s.ledgerTxHash} label="Shift completion" />
                  </div>
                )}
              </div>
              {(s.status === "accepted" || s.status === "in_progress") && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={completeMut.isPending}
                  onClick={() => completeMut.mutate(s.id)}
                  data-testid={`button-complete-shift-${s.id}`}
                >
                  Mark complete + sign
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function RxQueue() {
  const { toast } = useToast();
  const { data: rxs = [], isLoading } = useQuery<Prescription[]>({ queryKey: ["/api/prescriptions"] });
  const fillMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await apiRequest("POST", `/api/prescriptions/${id}/fill`);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/prescriptions"] });
      toast({ title: "Prescription filled" });
    },
  });
  const queue = rxs.filter((r) => r.status === "signed" || r.status === "transmitted" || r.status === "received");
  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold">Rx queue ({queue.length})</h2>
      {isLoading && <SkeletonList />}
      {!isLoading && queue.length === 0 && <EmptyCard message="No prescriptions to fill. Signed orders from prescribers appear here." />}
      <div className="grid gap-3">
        {queue.map((r) => (
          <Card key={r.id}>
            <CardContent className="p-4 flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-sm font-mono" data-testid={`text-rx-number-${r.id}`}>{r.rxNumber}</h3>
                  <Badge variant="outline" className={statusColor(r.status)}>{r.status}</Badge>
                  <Badge variant="outline" className="text-[10px]">{r.channel}</Badge>
                </div>
                <p className="text-sm mt-1">
                  <span className="font-medium">{r.drug}</span> {r.strength} {r.form} · qty {r.quantity} · refills {r.refills}
                </p>
                <p className="text-xs text-muted-foreground mt-1 italic">Sig: {r.sig}</p>
                {r.ledgerTxHash && (
                  <div className="mt-2"><LedgerProofBadge txHash={r.ledgerTxHash} label="Prescriber signature" size="sm" /></div>
                )}
              </div>
              <Button
                size="sm"
                disabled={fillMut.isPending}
                onClick={() => fillMut.mutate(r.id)}
                data-testid={`button-fill-rx-${r.id}`}
              >
                Mark filled
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Credentials() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: licenses = [], isLoading } = useQuery<License[]>({ queryKey: ["/api/licenses"] });
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("pharmacist_license");
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
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Credentials</h2>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="button-add-credential"><Plus className="h-3.5 w-3.5 mr-1" />Add credential</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add credential</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger data-testid="select-credential-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pharmacist_license">Pharmacist license</SelectItem>
                    <SelectItem value="dea">DEA</SelectItem>
                    <SelectItem value="controlled_substance">Controlled substance permit</SelectItem>
                    <SelectItem value="telehealth_license">Telehealth license</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>License number</Label>
                  <Input value={number} onChange={(e) => setNumber(e.target.value)} data-testid="input-credential-number" />
                </div>
                <div className="space-y-1.5">
                  <Label>State</Label>
                  <Input value={state} onChange={(e) => setState(e.target.value)} maxLength={2} data-testid="input-credential-state" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Expiration</Label>
                <Input type="date" value={exp} onChange={(e) => setExp(e.target.value)} data-testid="input-credential-exp" />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => create.mutate()} disabled={!number || create.isPending} data-testid="button-submit-credential">
                Submit for verification
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {isLoading && <SkeletonList />}
      {!isLoading && licenses.length === 0 && <EmptyCard message="No credentials on file." />}
      <div className="grid gap-3">
        {licenses.map((l) => (
          <Card key={l.id}>
            <CardContent className="p-4 flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <div className="h-9 w-9 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <FileBadge2 className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-medium text-sm capitalize">{l.type.replace(/_/g, " ")}</h3>
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

function Cell({ icon: Icon, children }: { icon: any; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{children}</span>
    </div>
  );
}
function SkeletonList() {
  return (
    <div className="grid gap-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-24 rounded-lg border border-border bg-card animate-pulse" />
      ))}
    </div>
  );
}
function EmptyCard({ message }: { message: string }) {
  return (
    <Card className="border-dashed">
      <CardContent className="p-8 text-center text-sm text-muted-foreground">{message}</CardContent>
    </Card>
  );
}
