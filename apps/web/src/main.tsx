import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { Toaster } from "sonner";
import { router } from "@/app/router";
import { TooltipProvider } from "@/components/ui/misc";
import { ApiError } from "@/lib/api";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
        <Toaster
          theme="dark"
          position="bottom-right"
          // On phones, sit above the tab bar / checkout bar instead of covering the header.
          mobileOffset={{ bottom: "calc(5.75rem + env(safe-area-inset-bottom))", left: 12, right: 12 }}
          richColors
          closeButton
          toastOptions={{ style: { background: "#17181b", border: "1px solid #33363d", color: "#ececee" } }}
        />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);
