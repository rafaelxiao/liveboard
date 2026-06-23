import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useAuthStore } from "./authStore";
import { useTokenStore } from "./tokenStore";

export default function RequireAuth() {
  const location = useLocation();
  const accessToken = useTokenStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);

  if (!accessToken) {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  }
  if (user?.status === "pending") {
    return <Navigate to="/awaiting-approval" replace />;
  }
  return <Outlet />;
}
