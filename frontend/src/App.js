import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { Toaster } from "@/components/ui/sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { roleHome } from "@/lib/constants";

import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import Notifications from "@/pages/Notifications";
import Support from "@/pages/Support";

import BusinessDashboard from "@/pages/business/BusinessDashboard";
import BusinessRequests from "@/pages/business/BusinessRequests";
import RequestNew from "@/pages/business/RequestNew";
import RequestDetail from "@/pages/business/RequestDetail";
import BusinessWallet from "@/pages/business/BusinessWallet";
import BusinessProfile from "@/pages/business/BusinessProfile";

import WorkerDashboard from "@/pages/worker/WorkerDashboard";
import WorkerOpportunities from "@/pages/worker/WorkerOpportunities";
import WorkerJobs from "@/pages/worker/WorkerJobs";
import WorkerWallet from "@/pages/worker/WorkerWallet";
import WorkerProfile from "@/pages/worker/WorkerProfile";

import AdminDashboard from "@/pages/admin/AdminDashboard";
import AdminUsers from "@/pages/admin/AdminUsers";
import AdminRequests from "@/pages/admin/AdminRequests";
import AdminWithdrawals from "@/pages/admin/AdminWithdrawals";

function RoleIndex() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={roleHome(user.role)} replace />;
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/app" element={<DashboardLayout />}>
            <Route index element={<RoleIndex />} />
            <Route path="business" element={<BusinessDashboard />} />
            <Route path="business/requests" element={<BusinessRequests />} />
            <Route path="business/requests/new" element={<RequestNew />} />
            <Route path="business/requests/:id" element={<RequestDetail />} />
            <Route path="business/wallet" element={<BusinessWallet />} />
            <Route path="business/profile" element={<BusinessProfile />} />
            <Route path="worker" element={<WorkerDashboard />} />
            <Route path="worker/opportunities" element={<WorkerOpportunities />} />
            <Route path="worker/jobs" element={<WorkerJobs />} />
            <Route path="worker/wallet" element={<WorkerWallet />} />
            <Route path="worker/profile" element={<WorkerProfile />} />
            <Route path="admin" element={<AdminDashboard />} />
            <Route path="admin/users" element={<AdminUsers />} />
            <Route path="admin/requests" element={<AdminRequests />} />
            <Route path="admin/withdrawals" element={<AdminWithdrawals />} />
            <Route path="admin/support" element={<Support />} />
            <Route path="support" element={<Support />} />
            <Route path="notifications" element={<Notifications />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-center" richColors dir="rtl" />
    </AuthProvider>
  );
}

export default App;
