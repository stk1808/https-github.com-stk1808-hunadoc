import { Switch, Route, Router, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/components/AuthContext";
import LoginPage from "@/pages/login";
import ChangePasswordPage from "@/pages/change-password";
import PharmacistDashboard from "@/pages/pharmacist-dashboard";
import PrescriberDashboard from "@/pages/prescriber-dashboard";
import PharmacyDashboard from "@/pages/pharmacy-dashboard";
import ManagerDashboard from "@/pages/manager-dashboard";
import PatientDashboard from "@/pages/patient-dashboard";
import NotFound from "@/pages/not-found";
import { useEffect } from "react";
import { HunaDocLogo } from "@/components/HunaDocLogo";

function HomeRedirect() {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();
  useEffect(() => {
    if (isLoading) return;
    if (!user) setLocation("/login");
    else setLocation(`/dashboard/${user.role}`);
  }, [user, isLoading, setLocation]);
  return <BootSplash />;
}

function ProtectedDashboard({ role, Component }: { role: string; Component: any }) {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();
  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      setLocation("/login");
    } else if (user.mustChangePassword) {
      setLocation("/change-password");
    } else if (user.role !== role) {
      setLocation(`/dashboard/${user.role}`);
    }
  }, [user, isLoading, role, setLocation]);
  if (isLoading) return <BootSplash />;
  if (!user || user.role !== role) return <BootSplash />;
  if (user.mustChangePassword) return <BootSplash />;
  return <Component />;
}

function BootSplash() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex items-center gap-3 text-muted-foreground">
        <HunaDocLogo size={28} className="animate-pulse" />
        <span className="text-sm">Loading HunaDoc…</span>
      </div>
    </div>
  );
}

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={HomeRedirect} />
      <Route path="/login" component={LoginPage} />
      <Route path="/change-password" component={ChangePasswordPage} />
      <Route path="/dashboard/pharmacist/:tab?">
        {() => <ProtectedDashboard role="pharmacist" Component={PharmacistDashboard} />}
      </Route>
      <Route path="/dashboard/prescriber/:tab?">
        {() => <ProtectedDashboard role="prescriber" Component={PrescriberDashboard} />}
      </Route>
      <Route path="/dashboard/pharmacy/:tab?">
        {() => <ProtectedDashboard role="pharmacy" Component={PharmacyDashboard} />}
      </Route>
      <Route path="/dashboard/manager/:tab?">
        {() => <ProtectedDashboard role="manager" Component={ManagerDashboard} />}
      </Route>
      <Route path="/dashboard/patient/:tab?">
        {() => <ProtectedDashboard role="patient" Component={PatientDashboard} />}
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <Toaster />
          <Router hook={useHashLocation}>
            <AppRouter />
          </Router>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
