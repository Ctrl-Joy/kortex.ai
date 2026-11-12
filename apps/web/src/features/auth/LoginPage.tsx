import { useMutation } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import { z } from "zod";
import { Logo } from "@/components/brand/Logo";
import { ServerNotice, useServerState } from "@/components/status/ServerNotice";
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
  const server = useServerState();

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
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-5 py-6 sm:px-8 sm:py-8">
      <Logo />
      <main className="grid flex-1 items-center gap-10 py-10 lg:grid-cols-[1fr_380px] lg:gap-20">
        <section className="max-w-md">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight text-fg sm:text-4xl">
            Scan-and-go checkout that checks itself.
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-muted">
            KORTEX compares what a shopper scans with what the shelf sees, and lets the shopper fix an honest mistake in one tap.
          </p>
          <Link
            to="/shop"
            className="mt-6 inline-flex min-h-11 items-center gap-2 text-[15px] font-medium text-fg underline-offset-4 hover:underline"
          >
            Try the customer app <ArrowRight className="size-4" />
          </Link>
        </section>

        <section className="w-full">
          <h2 className="text-lg font-semibold text-fg">Staff sign in</h2>
          <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
            <Field label="Username" htmlFor="username" error={errors.username}>
              <Input
                id="username"
                autoComplete="username"
                autoCapitalize="none"
                className="h-11"
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
                className="h-11"
                value={form.password}
                aria-invalid={!!errors.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              />
            </Field>
            {login.isError && (
              <p role="alert" className="rounded-lg bg-bad/10 px-3 py-2 text-[13px] text-bad">
                {errorMessage(login.error)}
              </p>
            )}
            {authStore.wasExpired() && !login.isError && (
              <p className="rounded-lg bg-warn/10 px-3 py-2 text-[13px] text-warn">Your session expired. Please sign in again.</p>
            )}
            <ServerNotice state={server.state} onRetry={server.retry} />
            <Button type="submit" variant="primary" size="lg" className="w-full" loading={login.isPending}>
              Sign in
            </Button>
          </form>
          <p className="mt-4 text-xs leading-relaxed text-subtle">
            Demo accounts are <span className="font-mono text-muted">manager</span> and{" "}
            <span className="font-mono text-muted">attendant</span>. The password is in the project README.
          </p>
        </section>
      </main>
      <p className="text-xs text-subtle">Hackathon prototype. Payment and the exit gate are simulated.</p>
    </div>
  );
}
