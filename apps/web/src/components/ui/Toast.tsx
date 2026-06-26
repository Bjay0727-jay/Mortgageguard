"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { cn } from "./cn";

export type ToastVariant = "success" | "error" | "info" | "warning";

export interface Toast {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
  duration: number;
}

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** Auto-dismiss after ms. Set 0 to keep until dismissed. Default 5000. */
  duration?: number;
}

interface ToastContextValue {
  toast: (opts: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** Imperative API: `const { toast } = useToast()`. */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a <ToastProvider>");
  return ctx;
}

const VARIANT_STYLE: Record<ToastVariant, { bar: string; icon: string; symbol: string }> = {
  success: { bar: "border-l-[var(--grn)]", icon: "text-[var(--grn)]", symbol: "✓" },
  error: { bar: "border-l-[var(--red)]", icon: "text-[var(--red)]", symbol: "!" },
  warning: { bar: "border-l-[var(--amb)]", icon: "text-[var(--amb)]", symbol: "!" },
  info: { bar: "border-l-[var(--royal-lt)]", icon: "text-[var(--royal-lt)]", symbol: "i" },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current[id];
    if (timer) {
      clearTimeout(timer);
      delete timers.current[id];
    }
  }, []);

  const toast = useCallback(
    (opts: ToastOptions) => {
      const id = ++idRef.current;
      const duration = opts.duration ?? 5000;
      setToasts((prev) => [...prev, { id, title: opts.title, description: opts.description, variant: opts.variant ?? "info", duration }]);
      if (duration > 0) {
        timers.current[id] = setTimeout(() => dismiss(id), duration);
      }
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      Object.values(map).forEach(clearTimeout);
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}
      <div
        className="pointer-events-none fixed right-4 top-4 z-[100] flex w-full max-w-sm flex-col gap-2"
        role="region"
        aria-label="Notifications"
      >
        {toasts.map((t) => {
          const style = VARIANT_STYLE[t.variant];
          return (
            <div
              key={t.id}
              role={t.variant === "error" ? "alert" : "status"}
              aria-live={t.variant === "error" ? "assertive" : "polite"}
              className={cn(
                "pointer-events-auto flex items-start gap-3 rounded-[var(--radius-lg)] border border-[var(--gray-200)] border-l-4 bg-white p-4 shadow-[var(--shadow-lg)]",
                style.bar,
              )}
            >
              <span className={cn("mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full text-xs font-bold", style.icon)} aria-hidden="true">
                {style.symbol}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[var(--gray-900)]">{t.title}</p>
                {t.description && <p className="mt-0.5 text-sm text-[var(--gray-500)]">{t.description}</p>}
              </div>
              <button
                type="button"
                aria-label="Dismiss notification"
                onClick={() => dismiss(t.id)}
                className="flex-none rounded p-0.5 text-[var(--gray-400)] hover:text-[var(--gray-700)]"
              >
                <span aria-hidden="true">✕</span>
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
