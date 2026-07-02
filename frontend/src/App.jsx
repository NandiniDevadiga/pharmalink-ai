import { HashRouter as BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import ProtectedRoute from "./auth/ProtectedRoute";
import NavBar from "./components/NavBar";
import MedLocator from "./pages/MedLocator";
import AiDoc from "./pages/AiDoc";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import AdminPanel from "./pages/AdminPanel";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <NavBar />
        <Routes>
          <Route path="/" element={<MedLocator />} />
          <Route path="/aidoc" element={<AiDoc />} />
          <Route path="/login" element={<Login />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute adminOnly>
                <AdminPanel />
              </ProtectedRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}


