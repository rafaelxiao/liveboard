import { Navigate, Route, Routes } from "react-router-dom";

import RequireAdmin from "./auth/RequireAdmin";
import RequireAuth from "./auth/RequireAuth";
import AppShell from "./components/AppShell";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import AwaitingApprovalPage from "./pages/AwaitingApprovalPage";
import SettingsPage from "./pages/SettingsPage";
import AdminUsersPage from "./pages/AdminUsersPage";
import DashboardPage from "./pages/DashboardPage";
import ComparisonPage from "./pages/ComparisonPage";
import TradeComparePage from "./pages/TradeComparePage";
import DocsPage from "./pages/DocsPage";
import SharePage from "./pages/SharePage";

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/docs" element={<DocsPage />} />
      <Route path="/share/:token" element={<SharePage />} />
      <Route path="/awaiting-approval" element={<AwaitingApprovalPage />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/compare" element={<ComparisonPage />} />
          <Route path="/trade-compare" element={<TradeComparePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route element={<RequireAdmin />}>
            <Route path="/admin/users" element={<AdminUsersPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
