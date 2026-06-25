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
  mustChangePassword?: boolean;
}

interface RegisterData {
  email: string;
  password: string;
  name: string;
  companyName: string;
  nmlsId?: string;
}

interface InviteDetails {
  email: string;
  role: string;
  companyName: string;
  expiresAt: string;
}

interface RegisterInviteData {
  token: string;
  name: string;
  password: string;
  nmlsId?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (data: RegisterData) => Promise<User>;
  getInvite: (token: string) => Promise<InviteDetails>;
  registerWithInvite: (data: RegisterInviteData) => Promise<User>;
  changePassword: (newPassword: string, currentPassword?: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

function persistAuth(token: string, user: User) {
  api.setToken(token);
  localStorage.setItem("mg_user", JSON.stringify(user));
}

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
    persistAuth(data.token, data.user);
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(async (body: RegisterData) => {
    const data = await api.post<{ token: string; user: User }>(
      "/api/v1/auth/register",
      body,
    );
    persistAuth(data.token, data.user);
    setUser(data.user);
    return data.user;
  }, []);

  const getInvite = useCallback(async (token: string) => {
    return api.get<InviteDetails>(`/api/v1/auth/invite/${encodeURIComponent(token)}`);
  }, []);

  const registerWithInvite = useCallback(async (body: RegisterInviteData) => {
    const data = await api.post<{ token: string; user: User }>(
      "/api/v1/auth/register-invite",
      body,
    );
    persistAuth(data.token, data.user);
    setUser(data.user);
    return data.user;
  }, []);

  const changePassword = useCallback(async (newPassword: string, currentPassword?: string) => {
    await api.post("/api/v1/auth/change-password", { newPassword, currentPassword });
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, mustChangePassword: false };
      localStorage.setItem("mg_user", JSON.stringify(next));
      return next;
    });
  }, []);

  const logout = useCallback(() => {
    api.post("/api/v1/auth/logout").catch(() => {});
    api.setToken(null);
    localStorage.removeItem("mg_user");
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading, login, register, getInvite, registerWithInvite, changePassword, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
