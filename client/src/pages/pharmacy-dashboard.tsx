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
import { Plus, Briefcase, Pill, Clock } from "lucide-react";
import type { Shift, Prescription } from "@/lib/types";
import { fmtDate, fmtMoney, statusColor, urgencyColor } from "@/lib/format";

const NAV = [
  { label: "Rx queue", path: "/dashboard/pharmacy", testId: "nav-pharmacy-rx" },
  { label: "My shifts", path: "/dashboard/pharmacy/shifts", testId: "nav-pharmacy-shifts" },
];

export default function PharmacyDashboard() {
  const [, params] = useRoute("/dashboard/pharmacy/:tab?");
  const tab = params?.tab || "rx";
  return (
    <AppShell title="Pharmacy operations" subtitle="Fill prescriptions, post and manage staffing shifts." nav={NAV}>
      {tab === "rx" && <Queue />}
      {tab === "shifts" && <Shifts />}
    </AppShell>
  );
}

function Queue() {
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
  const filled = rxs.filter((r) => r.status === "filled");
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold mb-2">Active queue ({queue.length})</h2>
        {isLoading && <Skel />}
        {!isLoading && queue.length === 0 && <Empty message="No prescriptions waiting. Signed Rx from prescribers appears here." />}
        <div className="space-y-2">
          {queue.map((r) => (
            <Card key={r.id}>
              <CardContent className="p-4 flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className="h-9 w-9 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <Pill className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-muted-foreground">{r.rxNumber}</span>
                      <Badge variant="outline" className={statusColor(r.status)}>{r.status}</Badge>
                      <Badge variant="outline" className="text-[10px]">{r.channel}</Badge>
                    </div>
                    <p className="text-sm font-medium mt-1">{r.drug} {r.strength} {r.form}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">qty {r.quantity} · refills {r.refills} · DAW {r.daw ? "yes" : "no"}</p>
                    <p className="text-xs italic text-muted-foreground mt-1">Sig: {r.sig}</p>
                    {r.ledgerTxHash && <div className="mt-2"><LedgerProofBadge txHash={r.ledgerTxHash} label="Prescriber-signed" size="sm" /></div>}
                  </div>
                </div>
                <Button size="sm" onClick={() => fillMut.mutate(r.id)} disabled={fillMut.isPending} data-testid={`button-fill-${r.id}`}>
                  Mark filled
                </Button>
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

function Shifts() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: shifts = [], isLoading } = useQuery<Shift[]>({ queryKey: ["/api/shifts"] });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    title: "Floater pharmacist", date: "", startTime: "09:00", endTime: "17:00",
    hourlyRate: "85", location: "Honolulu, HI", urgency: "routine" as const, notes: "",
  });
  const post = useMutation({
    mutationFn: async () => {
      const body = { ...form, hourlyRate: parseFloat(form.hourlyRate) };
      const r = await apiRequest("POST", "/api/shifts", body);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      toast({ title: "Shift posted" });
      setOpen(false);
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
            </div>
            <DialogFooter>
              <Button onClick={() => post.mutate()} disabled={!form.date || post.isPending} data-testid="button-submit-shift">Post shift</Button>
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
function Empty({ message }: { message: string }) {
  return <Card className="border-dashed"><CardContent className="p-8 text-center text-sm text-muted-foreground">{message}</CardContent></Card>;
}
