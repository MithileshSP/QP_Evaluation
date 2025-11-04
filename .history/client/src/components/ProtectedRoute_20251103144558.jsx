import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute({ children, roles }) {
  const { user } = useAuth();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (roles && roles.length > 0 && !roles.includes(user.role)) {
    const redirectTarget = user.role === "admin" ? "/admin" : "/";
    return <Navigate to={redirectTarget} replace />;
  }

  return children;
}
