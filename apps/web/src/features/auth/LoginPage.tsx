import { useMutation } from "@tanstack/react-query";
import { Lock, ScanLine, ShieldCheck, Smartphone } from "lucide-react";
import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import { z } from "zod";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { api, errorMessage } from "@/lib/api";
import { authStore, useAuth } from "@/lib/auth";
import type { Staff } from "@/types/api";

const schema = z.object({
  username: z.string().trim().min(1, "Enter your username"),
  password: z.string().min(1, "Enter your password"),
});

export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/overview";
  const [form, setForm] = useState({ username: "manager", password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const login = useMutation({
    mutationFn: (body: z.infer<typeof schema>) =>
      api.post<{ token: string; expires_in: number; staff: Staff }>("/api/auth/login", body, "none"),
    onSuccess: (r) => {
      authStore.set(r.token, r.staff, r.expires_in);
      navigate(from, { replace: true });
    },
  });

  if (auth) return <Navigate to={from} replace />;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    login.mutate(parsed.data);
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden border-r border-line bg-surface lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="grid-bg absolute inset-0 opacity-60" aria-hidden />
        <div className="absolute -left-32 top-1/3 size-[520px] rounded-full bg-accent/10 blur-[120px]" aria-hidden />
        <Logo className="relative" />
        <div className="relative max-w-lg">
          <p className="label-eyebrow text-accent">Everseen CV Hackathon · Problem Statement 2</p>
          <h2 className="mt-3 text-4xl font-semibold leading-tight tracking-tight text-fg">
            Checkout anywhere. <br />
            <span className="bg-gradient-to-r from-teal to-accent bg-clip-text text-transparent">Verify everything.</span>
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-muted">
            KORTEX reconciles what a shopper scans with what the shelf camera observes — and resolves the difference
            with the customer instead of accusing them.
          </p>
          <ul className="mt-8 space-y-3 text-sm">
            {[
              { icon: ScanLine, text: "Uncertainty-aware matching of scans and candidate shelf interactions" },
              { icon: ShieldCheck, text: "Self-correcting cart with full, append-only evidence trail" },
              { icon: Lock, text: "Backend-enforced checkout eligibility — never frontend-only" },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-muted">
                <span className="grid size-8 place-items-center rounded-md border border-line bg-surface-2 text-accent">
                  <Icon className="size-4" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-subtle">Prototype for demonstration — not production-certified.</p>
      </section>

      <section className="flex flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <Logo className="mb-10 lg:hidden" />
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Staff sign in</h1>
          <p className="mt-1.5 text-sm text-muted">Access the retailer dashboard for KORTEX Demo Store.</p>
          <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
            <Field label="Username" htmlFor="username" error={errors.username}>
              <Input
                id="username"
                autoComplete="username"
                value={form.username}
                aria-invalid={!!errors.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              />
            </Field>
            <Field label="Password" htmlFor="password" error={errors.password}>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={form.password}
                aria-invalid={!!errors.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                autoFocus
              />
            </Field>
            {login.isError && (
              <p role="alert" className="rounded-md border border-bad/30 bg-bad/10 px-3 py-2 text-[13px] text-bad">
                {errorMessage(login.error)}
              </p>
            )}
            {authStore.wasExpired() && !login.isError && (
              <p className="rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-[13px] text-warn">
                Your session expired. Please sign in again.
              </p>
            )}
            <Button type="submit" variant="primary" size="lg" className="w-full" loading={login.isPending}>
              Sign in
            </Button>
          </form>
          <div className="mt-6 rounded-lg border border-line bg-surface px-4 py-3 text-xs leading-relaxed text-muted">
            Demo accounts: <span className="font-mono text-fg">manager</span> or{" "}
            <span className="font-mono text-fg">attendant</span>. The password is the{" "}
            <span className="font-mono text-fg">KORTEX_SEED_STAFF_PASSWORD</span> value in your local{" "}
            <span className="font-mono">.env</span> (see README).
          </div>
          <Link
            to="/shop"
            className="mt-4 flex items-center justify-center gap-2 rounded-lg border border-line-strong px-4 py-2.5 text-sm text-muted hover:bg-surface-2 hover:text-fg"
          >
            <Smartphone className="size-4" /> I’m a shopper — open scan & go
          </Link>
        </div>
      </section>
    </div>
  );
}
