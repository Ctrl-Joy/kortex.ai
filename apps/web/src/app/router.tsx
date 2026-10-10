import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Navigate } from "react-router";
import { Skeleton } from "@/components/ui/misc";
import { LoginPage } from "@/features/auth/LoginPage";
import { StaffLayout } from "@/layouts/StaffLayout";

const OverviewPage = lazy(() => import("@/features/dashboard/OverviewPage"));
const LiveMonitoringPage = lazy(() => import("@/features/monitoring/LiveMonitoringPage"));
const SessionsPage = lazy(() => import("@/features/sessions/SessionsPage"));
const SessionDetailPage = lazy(() => import("@/features/sessions/SessionDetailPage"));
const DiscrepanciesPage = lazy(() => import("@/features/discrepancies/DiscrepanciesPage"));
const ProductsPage = lazy(() => import("@/features/products/ProductsPage"));
const AuditPage = lazy(() => import("@/features/audit/AuditPage"));
const SettingsPage = lazy(() => import("@/features/settings/SettingsPage"));
const ShopPage = lazy(() => import("@/features/customer/ShopPage"));

function PageFallback() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <Skeleton className="h-80" />
    </div>
  );
}

const page = (node: ReactNode) => <Suspense fallback={<PageFallback />}>{node}</Suspense>;

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    path: "/shop",
    element: (
      <Suspense fallback={<div className="min-h-screen bg-canvas" />}>
        <ShopPage />
      </Suspense>
    ),
  },
  {
    path: "/",
    element: <StaffLayout />,
    children: [
      { index: true, element: <Navigate to="/overview" replace /> },
      { path: "overview", element: page(<OverviewPage />) },
      { path: "live", element: page(<LiveMonitoringPage />) },
      { path: "sessions", element: page(<SessionsPage />) },
      { path: "sessions/:id", element: page(<SessionDetailPage />) },
      { path: "discrepancies", element: page(<DiscrepanciesPage />) },
      { path: "products", element: page(<ProductsPage />) },
      { path: "audit", element: page(<AuditPage />) },
      { path: "settings", element: page(<SettingsPage />) },
      { path: "*", element: <Navigate to="/overview" replace /> },
    ],
  },
]);
