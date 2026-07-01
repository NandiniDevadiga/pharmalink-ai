import { createContext, useContext, useState, useEffect } from "react";

const AuthContext = createContext(null);

const STORAGE_KEY = "pharmalink_session"; // kept in memory + sessionStorage-like state object

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null); // { token, role, pharmacy_id, pharmacy_name }
  const [ready, setReady] = useState(false);

  // Restore session from memory on mount (no browser storage per artifact constraints -
  // in your real deployment outside Claude artifacts, you can safely use localStorage here)
  useEffect(() => {
    setReady(true);
  }, []);

  async function login(username, password) {
    const res = await fetch("http://127.0.0.1:8000/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Login failed. Check your username and password.");
    }
    const data = await res.json();
    const newSession = {
      token: data.access_token,
      role: data.role,
      pharmacy_id: data.pharmacy_id,
      pharmacy_name: data.pharmacy_name,
    };
    setSession(newSession);
    return newSession;
  }

  function logout() {
    setSession(null);
  }

  return (
    <AuthContext.Provider value={{ session, login, logout, ready }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
