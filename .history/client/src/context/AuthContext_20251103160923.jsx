// Authentication context removed; UI is now a single open workspace.
export const AuthProvider = ({ children }) => children;
export const useAuth = () => ({ user: null });
