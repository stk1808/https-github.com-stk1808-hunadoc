import { createContext, useContext, ReactNode, useState, useEffect } from "react";
import { flushSync } from "react-dom";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { User } from "@/lib/types";

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<User | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Manual state instead of useQuery so login mutation result is authoritative.
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { credentials: "include" }).then(async (r) => {
      if (cancelled) return;
      if (r.ok) {
        const u = await r.json();
        setUser(u);
      } else setUser(null);
      setIsLoading(false);
    }).catch(() => {
      if (!cancelled) {
        setUser(null);
        setIsLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  const loginMutation = useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }) => {
      const r = await apiRequest("POST", "/api/auth/login", { email, password });
      const u = (await r.json()) as User;
      // Set state synchronously inside the mutationFn so onSuccess + caller see it on the same render tick
      flushSync(() => {
        setUser(u);
        setIsLoading(false);
      });
      return u;
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/auth/logout");
    },
    onSuccess: () => {
      setUser(null);
      queryClient.clear();
    },
  });

  const refreshUser = async (): Promise<User | null> => {
    try {
      const r = await fetch("/api/auth/me", { credentials: "include", cache: "no-store" });
      if (r.ok) {
        const u = (await r.json()) as User;
        flushSync(() => {
          setUser(u);
          setIsLoading(false);
        });
        return u;
      }
      flushSync(() => {
        setUser(null);
        setIsLoading(false);
      });
      return null;
    } catch {
      return null;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        login: async (email, password) => {
          return await loginMutation.mutateAsync({ email, password });
        },
        logout: async () => {
          await logoutMutation.mutateAsync();
        },
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
