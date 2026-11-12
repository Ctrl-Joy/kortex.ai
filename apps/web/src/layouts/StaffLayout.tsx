import {
  ChevronsUpDown,
  Ellipsis,
  LayoutDashboard,
  LogOut,
  Package,
  Radio,
  ScrollText,
  Settings,
  ShieldAlert,
  ShoppingCart,
  Smartphone,
} from "lucide-react";
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router";
import { LiveProvider, useLive } from "@/app/live-context";
import { Logo, LogoMark } from "@/components/brand/Logo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
} from "@/components/ui/misc";
import { DemoLauncher } from "@/features/demo/DemoLauncher";
import { useDiscrepancies } from "@/hooks/queries";
import { authStore, useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/overview", label: "Overview", short: "Overview", icon: LayoutDashboard },
  { to: "/live", label: "Live", short: "Live", icon: Radio },
  { to: "/sessions", label: "Sessions", short: "Sessions", icon: ShoppingCart },
  { to: "/discrepancies", label: "Discrepancies", short: "Alerts", icon: ShieldAlert },
  { to: "/products", label: "Catalogue", short: "Catalogue", icon: Package },
  { to: "/audit", label: "Audit trail", short: "Audit", icon: ScrollText },
  { to: "/settings", label: "Settings", short: "Settings", icon: Settings },
] as const;

// The first four live in the phone tab bar; the rest sit behind "More".
const TAB_COUNT = 4;

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

function useOpenCount() {
  const open = useDiscrepancies({ state: "OPEN", limit: 1, offset: 0 });
  return open.data?.total ?? 0;
}

function Shell() {
  const location = useLocation();
  const current = NAV.find((n) => location.pathname.startsWith(n.to)) ?? NAV[0];
  const openCount = useOpenCount();

  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-lg focus:bg-fg focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-canvas"
      >
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-dvh w-[220px] shrink-0 flex-col border-r border-line lg:flex">
        <Sidebar openCount={openCount} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-line bg-canvas pt-[env(safe-area-inset-top)]">
          <div className="flex h-14 items-center gap-2 px-4 sm:gap-3 sm:px-6">
            <LogoMark className="lg:hidden" />
            <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-fg">{current.label}</h1>
            <LiveDot />
            <Tooltip content="Open the customer app in a new tab">
              <Link
                to="/shop"
                target="_blank"
                aria-label="Open the customer app"
                className="hidden h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] text-muted hover:bg-surface-2 hover:text-fg sm:inline-flex"
              >
                <Smartphone className="size-4" />
                <span className="hidden md:inline">Customer app</span>
              </Link>
            </Tooltip>
            <DemoLauncher />
          </div>
        </header>
        <main
          id="main"
          className="mx-auto w-full max-w-[1200px] flex-1 px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-5 sm:px-6 sm:pt-7 lg:pb-10"
        >
          <Outlet />
        </main>
      </div>

      <TabBar openCount={openCount} />
    </div>
  );
}

function Sidebar({ openCount }: { openCount: number }) {
  return (
    <>
      <div className="flex h-14 items-center px-5">
        <Logo />
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2" aria-label="Primary">
        {NAV.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors",
                  isActive ? "bg-surface-2 text-fg" : "text-muted hover:bg-surface-2/60 hover:text-fg",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className={cn("size-4 shrink-0", isActive ? "text-fg" : "text-subtle")} />
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.to === "/discrepancies" && openCount > 0 && (
                    <span className="num rounded-full bg-warn/12 px-1.5 py-0.5 text-[11px] font-medium leading-none text-warn" aria-label={`${openCount} open`}>
                      {openCount}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          );
        })}
      </nav>
      <div className="border-t border-line p-3">
        <ProfileMenu />
      </div>
    </>
  );
}

/** Phone and tablet navigation: a fixed bottom bar reachable with one thumb. */
function TabBar({ openCount }: { openCount: number }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const rest = NAV.slice(TAB_COUNT);
  const moreActive = rest.some((n) => location.pathname.startsWith(n.to));
  const tab = "relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium";
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-canvas pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      {NAV.slice(0, TAB_COUNT).map((item) => {
        const Icon = item.icon;
        return (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => cn(tab, isActive ? "text-fg" : "text-subtle")}>
            <span className="relative">
              <Icon className="size-5" />
              {item.to === "/discrepancies" && openCount > 0 && (
                <span className="absolute -right-1.5 -top-1 size-2 rounded-full bg-warn" aria-label={`${openCount} open`} />
              )}
            </span>
            {item.short}
          </NavLink>
        );
      })}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className={cn(tab, moreActive ? "text-fg" : "text-subtle")} aria-label="More pages and account">
            <Ellipsis className="size-5" />
            More
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="w-[220px]">
          {auth && (
            <>
              <div className="px-2.5 py-2">
                <p className="truncate text-[13px] font-medium text-fg">{auth.staff.display_name}</p>
                <p className="text-xs text-subtle">{auth.staff.role === "MANAGER" ? "Store manager" : "Floor attendant"}</p>
              </div>
              <DropdownMenuSeparator />
            </>
          )}
          {rest.map((item) => {
            const Icon = item.icon;
            return (
              <DropdownMenuItem key={item.to} onSelect={() => navigate(item.to)}>
                <Icon /> {item.label}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuItem onSelect={() => window.open("/shop", "_blank", "noopener")}>
            <Smartphone /> Customer app
          </DropdownMenuItem>
          <DropdownMenuSeparator />
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
    </nav>
  );
}

function LiveDot() {
  const { status } = useLive();
  const live = status === "open";
  return (
    <Tooltip content={live ? "Live updates connected" : "Live updates paused. Reconnecting automatically."}>
      <span className={cn("inline-flex items-center gap-1.5 px-1 text-xs", live ? "text-muted" : "text-warn")} role="status">
        <span className={cn("size-1.5 rounded-full", live ? "bg-ok" : "bg-warn")} />
        <span>{live ? "Live" : status === "connecting" ? "Connecting" : "Offline"}</span>
      </span>
    </Tooltip>
  );
}

function ProfileMenu() {
  const auth = useAuth();
  const navigate = useNavigate();
  if (!auth) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2" aria-label="Account menu">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-3 text-[11px] font-semibold text-fg">
            {auth.staff.display_name
              .split(" ")
              .slice(0, 2)
              .map((p) => p[0])
              .join("")}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-fg">{auth.staff.display_name}</span>
            <span className="block truncate text-[11px] text-subtle">{auth.staff.role === "MANAGER" ? "Store manager" : "Floor attendant"}</span>
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-subtle" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-[196px]">
        <DropdownMenuItem onSelect={() => navigate("/settings")}>
          <Settings /> Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
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
