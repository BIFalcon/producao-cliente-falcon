import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { FiltersProvider } from "@/contexts/FiltersContext";
import Dashboard from "./pages/Dashboard";
import AuthPage from "./pages/AuthPage";
import UploadPage from "./pages/UploadPage";
import UsersPage from "./pages/UsersPage";
import TenantsPage from "./pages/TenantsPage";
import ProfilePage from "./pages/ProfilePage";
import CrmDashboardPage from "./pages/CrmDashboardPage";
import CrmAccountsPage from "./pages/CrmAccountsPage";
import CrmAccountDetailPage from "./pages/CrmAccountDetailPage";
import CrmInteractionsPage from "./pages/CrmInteractionsPage";
import CrmTasksPage from "./pages/CrmTasksPage";
import NotFound from "./pages/NotFound";
import { Loader2 } from "lucide-react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
  if (!user) return <Navigate to="/auth" replace />;
  return <>{children}</>;
};

const CrmRoute = ({ children }: { children: React.ReactNode }) => {
  const { role, roleLoading } = useAuth();
  if (roleLoading) return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
  if (role === 'gerente_geral') return <Navigate to="/" replace />;
  return <>{children}</>;
};

const AppRoutes = () => (
  <Routes>
    <Route path="/auth" element={<AuthPage />} />
    <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
    <Route path="/upload" element={<ProtectedRoute><UploadPage /></ProtectedRoute>} />
    <Route path="/users" element={<ProtectedRoute><UsersPage /></ProtectedRoute>} />
    <Route path="/tenants" element={<ProtectedRoute><TenantsPage /></ProtectedRoute>} />
    <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
    <Route path="/comercial" element={<ProtectedRoute><CrmRoute><CrmDashboardPage /></CrmRoute></ProtectedRoute>} />
    <Route path="/comercial/contas" element={<ProtectedRoute><CrmRoute><CrmAccountsPage /></CrmRoute></ProtectedRoute>} />
    <Route path="/comercial/interacoes" element={<ProtectedRoute><CrmRoute><CrmInteractionsPage /></CrmRoute></ProtectedRoute>} />
    <Route path="/comercial/tarefas" element={<ProtectedRoute><CrmRoute><CrmTasksPage /></CrmRoute></ProtectedRoute>} />
    <Route path="/comercial/contas/:id" element={<ProtectedRoute><CrmRoute><CrmAccountDetailPage /></CrmRoute></ProtectedRoute>} />
    <Route path="*" element={<NotFound />} />
  </Routes>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <BrowserRouter>
        <AuthProvider>
          <FiltersProvider>
            <Sonner />
            <AppRoutes />
          </FiltersProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
