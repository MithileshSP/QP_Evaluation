import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { login as apiLogin } from "../api/auth";

const AuthContext = createContext(null);

const readStoredAuth = () => {
  try {
    const token = localStorage.getItem("auth_token");
    const user = localStorage.getItem("auth_user");
    if (!token || !user) {
      return { token: null, user: null };
    }
    return { token, user: JSON.parse(user) };
  } catch (error) {
    console.warn("warning: unable to read auth state", error);
    return { token: null, user: null };
  }
};

export function AuthProvider({ children }) {
  const [{ token, user }, setAuthState] = useState(() => readStoredAuth());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (token && user) {
      localStorage.setItem("auth_token", token);
      localStorage.setItem("auth_user", JSON.stringify(user));
    } else {
      localStorage.removeItem("auth_token");
      localStorage.removeItem("auth_user");
    }
  }, [token, user]);

  const login = async (credentials) => {
    setIsLoading(true);
    setError(null);
    try {
      const { data } = await apiLogin(credentials);
      const nextUser = {
        id: data.userId,
        username: data.username,
        role: data.role,
      };
      setAuthState({ token: data.token, user: nextUser });
      return { success: true };
    } catch (err) {
      const message = err?.response?.data?.error || "Login failed";
      setError(message);
      setAuthState({ token: null, user: null });
      return { success: false, message };
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    setAuthState({ token: null, user: null });
  };

  const value = useMemo(
    () => ({ token, user, login, logout, error, isLoading }),
    [token, user, error, isLoading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
