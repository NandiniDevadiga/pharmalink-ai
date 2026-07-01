import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";

export default function ProtectedRoute({ children, adminOnly = false }) {
  const { session, ready } = useAuth();
  const location = useLocation();

  if (!ready) return null; // avoid flash before session restore check completes

  if (!session) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  if (adminOnly && session.role !== "admin") {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
