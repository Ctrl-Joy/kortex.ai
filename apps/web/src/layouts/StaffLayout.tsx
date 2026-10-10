import {
  ChevronDown,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  PanelLeft,
  Radio,
  ScrollText,
  Settings,
  ShieldAlert,
  ShoppingCart,
  Smartphone,
  Store,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router";
import { LiveProvider, useLive } from "@/app/live-context";
import { Logo, LogoMark } from "@/components/brand/Logo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
} from "@/components/ui/misc";
import { DemoLauncher } from "@/features/demo/DemoLauncher";
import { useDiscrepancies, useVisionStatus } from "@/hooks/queries";
import { authStore, useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/overview", label: "Overview", icon: LayoutDashboard, description: "Store-wide verification health at a glance." },
  { to: "/live", label: "Live Monitoring", icon: Radio, description: "Camera feed, scans and candidate events as they happen." },
  { to: "/sessions", label: "Shopping Sessions", icon: ShoppingCart, description: "Every scan-and-go session with its evidence trail." },
  { to: "/discrepancies", label: "Discrepancies", icon: ShieldAlert, description: "Exceptions that need a decision — never accusations." },
  { to: "/products", label: "Product Catalogue", icon: Package, description: "Authoritative prices and barcodes used for every bill." },
  { to: "/audit", label: "Audit Trail", icon: ScrollText, description: "Append-only record of every decision and correction." },
  { to: "/settings", label: "Settings", icon: Settings, description: "System health and prototype reconciliation thresholds." },
] as const;

export function StaffLayout() {
  const auth = useAuth();
  const location = useLocation();
  if (!auth) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return (
    <LiveProvider query={`token=${encodeURIComponent(auth.token)}`}>
      <Shell />
    </LiveProvider>
  );
}

function Shell() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("kortex.sidebar") === "collapsed");
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const current = NAV.find((n) => location.pathname.startsWith(n.to)) ?? NAV[0];

  useEffect(() => setMobileOpen(false), [location.pathname]);
  useEffect(() => localStorage.setItem("kortex.sidebar", collapsed ? "collapsed" : "expanded"), [collapsed]);

  return (
    <div className="flex min-h-screen">
      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-line bg-surface/80 backdrop-blur lg:flex",
          collapsed ? "w-[68px]" : "w-[248px]",
        )}
      >
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[272px] flex-col border-r border-line bg-surface animate-slide-up">
            <button
              className="absolute right-3 top-4 rounded-md p-1.5 text-muted hover:bg-surface-2"
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation"
            >
              <X className="size-4" />
            </button>
            <Sidebar collapsed={false} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur-md">
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
            <button
              className="-ml-1 rounded-md p-2 text-muted hover:bg-surface-2 hover:text-fg lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
              <Menu className="size-5" />
            </button>
            <LogoMark className="size-7 lg:hidden" />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[15px] font-semibold text-fg">{current.label}</h1>
              <p className="hidden truncate text-xs text-muted sm:block">{current.description}</p>
            </div>
            <div className="flex items-center gap-2">
              <ConnectionPill />
              <Tooltip content="Open the customer scan-and-go app">
                <Link
                  to="/shop"
                  target="_blank"
                  className="hidden h-8 items-center gap-1.5 rounded-md border border-line-strong px-2.5 text-[13px] text-muted hover:bg-surface-2 hover:text-fg sm:inline-flex"
                >
                  <Smartphone className="size-4" /> Customer app
                </Link>
              </Tooltip>
              <span className="hidden sm:inline">
                <DemoLauncher />
              </span>
              <span className="sm:hidden">
                <DemoLauncher compact />
              </span>
              <ProfileMenu />
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-5 sm:px-6 sm:py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle?: () => void }) {
  const open = useDiscrepancies({ state: "OPEN", limit: 1, offset: 0 });
  const openCount = open.data?.total ?? 0;
  return (
    <>
      <div className={cn("flex h-14 items-center border-b border-line", collapsed ? "justify-center px-2" : "px-4")}>
        {collapsed ? <LogoMark /> : <Logo />}
      </div>
      {!collapsed && (
        <div className="px-3 pt-3">
          <StoreSelector />
        </div>
      )}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3" aria-label="Primary">
        {!collapsed && <p className="label-eyebrow px-2.5 pb-1.5">Operations</p>}
        {NAV.map((item) => {
          const Icon = item.icon;
          const link = (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "group relative flex items-center gap-3 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors",
                  collapsed && "justify-center px-0",
                  isActive ? "bg-surface-3 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent" aria-hidden />}
                  <Icon className={cn("size-[18px] shrink-0", isActive ? "text-accent" : "text-subtle group-hover:text-muted")} />
                  {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                  {!collapsed && item.to === "/discrepancies" && openCount > 0 && (
                    <span className="num rounded-sm bg-bad/15 px-1.5 py-0.5 text-[11px] font-semibold text-bad">{openCount}</span>
                  )}
                  {collapsed && item.to === "/discrepancies" && openCount > 0 && (
                    <span className="absolute right-2 top-1.5 size-2 rounded-full bg-bad" aria-label={`${openCount} open`} />
                  )}
                </>
              )}
            </NavLink>
          );
          return collapsed ? (
            <Tooltip key={item.to} content={item.label}>
              {link}
            </Tooltip>
          ) : (
            link
          );
        })}
      </nav>
      <div className="border-t border-line p-3">
        {!collapsed && <ServiceStatus />}
        {onToggle && (
          <button
            onClick={onToggle}
            className={cn(
              "mt-2 flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-subtle hover:bg-surface-2 hover:text-fg",
              collapsed && "justify-center",
            )}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <PanelLeft className="size-4" />
            {!collapsed && "Collapse"}
          </button>
        )}
      </div>
    </>
  );
}

function StoreSelector() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg border border-line bg-surface-2 px-2.5 py-2 text-left hover:border-line-strong">
          <div className="grid size-7 place-items-center rounded-md bg-teal/15 text-teal">
            <Store className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-fg">KORTEX Demo Store</p>
            <p className="truncate text-[11px] text-subtle">Bengaluru · Koramangala</p>
          </div>
          <ChevronDown className="size-4 text-subtle" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[224px]">
        <DropdownMenuLabel>Stores</DropdownMenuLabel>
        <DropdownMenuItem>
          <Store /> KORTEX Demo Store <span className="ml-auto text-[11px] text-accent">Current</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>The prototype runs a single seeded demo store.</DropdownMenuLabel>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ServiceStatus() {
  const vision = useVisionStatus();
  const { status } = useLive();
  const camOnline = vision.data?.online && vision.data.status?.camera_status === "ONLINE";
  return (
    <div className="space-y-1.5 rounded-lg border border-line bg-surface-2/60 px-3 py-2.5 text-xs">
      <Row label="Live updates" ok={status === "open"} text={status === "open" ? "Connected" : status === "connecting" ? "Connecting" : "Offline"} />
      <Row
        label="Vision service"
        ok={!!vision.data?.online}
        text={vision.data?.online ? (camOnline ? "Camera live" : "No camera") : "Not running"}
        warn={vision.data?.online && !camOnline}
      />
    </div>
  );
}

function Row({ label, ok, text, warn }: { label: string; ok: boolean; text: string; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-subtle">{label}</span>
      <span className={cn("flex items-center gap-1.5 font-medium", warn ? "text-warn" : ok ? "text-ok" : "text-muted")}>
        <span className={cn("size-1.5 rounded-full", warn ? "bg-warn" : ok ? "bg-ok" : "bg-subtle")} />
        {text}
      </span>
    </div>
  );
}

function ConnectionPill() {
  const { status } = useLive();
  const label = status === "open" ? "Live" : status === "connecting" ? "Connecting…" : "Reconnecting";
  return (
    <Tooltip content={status === "open" ? "Receiving real-time updates over WebSocket" : "Live updates paused — retrying automatically"}>
      <span
        className={cn(
          "inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs font-medium",
          status === "open" ? "border-ok/30 bg-ok/10 text-ok" : "border-warn/30 bg-warn/10 text-warn",
        )}
        role="status"
      >
        <span className={cn("relative size-2 rounded-full", status === "open" ? "bg-ok" : "bg-warn")}>
          {status === "open" && <span className="absolute inset-0 animate-ping rounded-full bg-ok/60" />}
        </span>
        <span className="hidden md:inline">{label}</span>
      </span>
    </Tooltip>
  );
}

function ProfileMenu() {
  const auth = useAuth();
  const navigate = useNavigate();
  if (!auth) return null;
  const initials = auth.staff.display_name
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0])
    .join("");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex cursor-pointer items-center gap-2 rounded-md p-1 hover:bg-surface-2"
          aria-label="Account menu"
        >
          <span className="grid size-7 place-items-center rounded-full bg-gradient-to-br from-teal to-accent text-[11px] font-bold text-[#04121a]">
            {initials}
          </span>
          <ChevronDown className="hidden size-3.5 text-subtle sm:block" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <div className="px-2.5 py-2">
          <p className="text-[13px] font-semibold text-fg">{auth.staff.display_name}</p>
          <p className="text-xs text-subtle">
            @{auth.staff.username} · {auth.staff.role === "MANAGER" ? "Store manager" : "Floor attendant"}
          </p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate("/settings")}>
          <Settings /> Settings & health
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            authStore.clear();
            navigate("/login");
          }}
        >
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
