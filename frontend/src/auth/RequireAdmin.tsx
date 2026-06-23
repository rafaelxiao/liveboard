import { Navigate, Outlet } from "react-router-dom";

import { useAuthStore } from "./authStore";

export default function RequireAdmin() {
  const user = useAuthStore((s) => s.user);
  if (user?.role !== "admin") {
    return <Navigate to="/dashboard" replace />;
  }
  return <Outlet />;
}
