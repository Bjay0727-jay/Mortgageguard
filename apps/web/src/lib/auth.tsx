"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { ReactNode } from "react";
import { api } from "./api";

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  companyId: string;
  companyName: string;
  nmlsId: string | null;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => void;
}

interface RegisterData {
  email: string;
  password: string;
  name: string;
  companyId: string;
  role?: string;
  nmlsId?: string;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = api.getToken();
    const stored = localStorage.getItem("mg_user");
    if (token && stored) {
      try {
        setUser(JSON.parse(stored));
      } catch {
        api.setToken(null);
        localStorage.removeItem("mg_user");
      }
    }
    setLoading(false);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api.post<{ token: string; user: User }>(
      "/api/v1/auth/login",
      { email, password },
    );
    api.setToken(data.token);
    localStorage.setItem("mg_user", JSON.stringify(data.user));
    setUser(data.user);
  }, []);

  const register = useCallback(async (body: RegisterData) => {
    const data = await api.post<{ token: string; user: User }>(
      "/api/v1/auth/register",
      body,
    );
    api.setToken(data.token);
    localStorage.setItem("mg_user", JSON.stringify(data.user));
    setUser(data.user);
  }, []);

  const logout = useCallback(() => {
    api.post("/api/v1/auth/logout").catch(() => {});
    api.setToken(null);
    localStorage.removeItem("mg_user");
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
