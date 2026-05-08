import { ReactNode } from "react";
import { useLocation } from "wouter";
import { LogOut, Moon, Sun, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { HunaDocWordmark } from "./HunaDocLogo";
import { TestDataBanner } from "./TestDataBanner";
import { useAuth } from "./AuthContext";
import { useState, useEffect } from "react";
import type { Role } from "@/lib/types";

export interface NavItem {
  label: string;
  path: string;
  testId: string;
  icon?: LucideIcon;
}

export interface NavGroup {
  label?: string; // omit for ungrouped (single section)
  items: NavItem[];
}

interface Props {
  title: string;
  subtitle?: string;
  /** Either a flat list of items or grouped sections. */
  nav?: NavItem[] | NavGroup[];
  children: ReactNode;
}

const ROLE_LABEL: Record<Role, string> = {
  pharmacist: "Pharmacist",
  prescriber: "Prescriber",
  pharmacy: "Pharmacy",
  manager: "Operations Manager",
  patient: "Patient",
};

const ROLE_COLOR: Record<Role, string> = {
  pharmacist: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  prescriber: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30",
  pharmacy: "bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/30",
  manager: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  patient: "bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-500/30",
};

function isGrouped(nav: NavItem[] | NavGroup[]): nav is NavGroup[] {
  return nav.length > 0 && (nav[0] as NavGroup).items !== undefined;
}

export function AppShell({ title, subtitle, nav, children }: Props) {
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const m = window.matchMedia("(prefers-color-scheme: dark)");
    setDark(m.matches);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  if (!user) return null;

  const groups: NavGroup[] | null = nav && nav.length > 0
    ? (isGrouped(nav) ? nav : [{ items: nav }])
    : null;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <TestDataBanner />
      <header className="border-b border-border bg-card/30 backdrop-blur-sm sticky top-0 z-30">
        <div className="px-6 h-14 flex items-center justify-between gap-6">
          <div className="flex items-center gap-6">
            <HunaDocWordmark />
            <Badge variant="outline" className={`text-[10px] uppercase tracking-wider ${ROLE_COLOR[user.role]}`}>
              {ROLE_LABEL[user.role]}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setDark((d) => !d)}
              data-testid="button-theme-toggle"
              aria-label="Toggle theme"
            >
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <div className="flex items-center gap-2 pl-2 border-l border-border">
              <Avatar className="h-7 w-7">
                <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                  {user.fullName.split(" ").map((p) => p[0]).slice(0, 2).join("")}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col leading-tight text-xs">
                <span className="font-medium" data-testid="text-current-user-name">{user.fullName}</span>
                <span className="text-muted-foreground">{user.email}</span>
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={async () => {
                  await logout();
                  setLocation("/login");
                }}
                data-testid="button-logout"
                aria-label="Logout"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {groups && (
          <aside className="w-60 border-r border-border bg-sidebar/30 px-3 py-4 flex flex-col gap-4 shrink-0">
            {groups.map((g, gi) => (
              <div key={gi} className="flex flex-col gap-1">
                {g.label && (
                  <div className="px-3 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {g.label}
                  </div>
                )}
                {g.items.map((item) => (
                  <NavLink key={item.path} item={item} />
                ))}
              </div>
            ))}
          </aside>
        )}
        <main className="flex-1 min-w-0">
          <div className="px-6 py-5 border-b border-border bg-card/20">
            <h1 className="text-xl font-semibold tracking-tight" data-testid="text-page-title">{title}</h1>
            {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
          <div className="px-6 py-6">{children}</div>
        </main>
      </div>
    </div>
  );
}

function NavLink({ item }: { item: NavItem }) {
  const [location, setLocation] = useLocation();
  const active = location === item.path;
  const Icon = item.icon;
  return (
    <button
      data-testid={item.testId}
      onClick={() => setLocation(item.path)}
      className={`text-left text-sm px-3 py-2 rounded-md transition-colors flex items-center gap-2 ${
        active
          ? "bg-primary/10 text-primary font-medium"
          : "text-foreground/70 hover:bg-accent hover:text-foreground"
      }`}
    >
      {Icon && <Icon className="h-4 w-4 shrink-0" />}
      <span className="truncate">{item.label}</span>
    </button>
  );
}
