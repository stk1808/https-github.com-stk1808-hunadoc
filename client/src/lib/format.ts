export function fmtDate(ts: number | string | null | undefined): string {
  if (!ts) return "—";
  const d = typeof ts === "number" ? new Date(ts) : new Date(ts);
  if (isNaN(d.getTime())) return String(ts);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function fmtDateTime(ts: number | string | null | undefined): string {
  if (!ts) return "—";
  const d = typeof ts === "number" ? new Date(ts) : new Date(ts);
  if (isNaN(d.getTime())) return String(ts);
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export function fmtMoney(n: number | string | null | undefined): string {
  if (n == null) return "—";
  const v = typeof n === "string" ? parseFloat(n) : n;
  if (isNaN(v)) return String(n);
  return v.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

export function statusColor(s: string): string {
  if (s === "verified" || s === "completed" || s === "filled" || s === "signed" || s === "transmitted") {
    return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30";
  }
  if (s === "pending" || s === "draft" || s === "scheduled" || s === "open") {
    return "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30";
  }
  if (s === "live" || s === "in_progress" || s === "accepted" || s === "received") {
    return "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30";
  }
  if (s === "rejected" || s === "cancelled" || s === "expired") {
    return "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30";
  }
  return "bg-muted text-muted-foreground border-border";
}

export function urgencyColor(u: string): string {
  if (u === "stat") return "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30";
  if (u === "urgent") return "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30";
  return "bg-muted text-muted-foreground border-border";
}
