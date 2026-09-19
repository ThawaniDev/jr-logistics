import "@/App.css";
import AdminLogin from "@/pages/AdminLogin";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { I18nProvider } from "@/i18n";
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
import WorkerDocuments from "@/pages/worker/WorkerDocuments";

import AdminDashboard from "@/pages/admin/AdminDashboard";
import AdminUsers from "@/pages/admin/AdminUsers";
import AdminRequests from "@/pages/admin/AdminRequests";
import AdminWithdrawals from "@/pages/admin/AdminWithdrawals";
import AdminSettings from "@/pages/admin/AdminSettings";
import AdminStaff from "@/pages/admin/AdminStaff";
import AdminDocuments from "@/pages/admin/AdminDocuments";
import AdminCases from "@/pages/admin/AdminCases";
import AdminAudit from "@/pages/admin/AdminAudit";
import AdminCancellations from "@/pages/admin/AdminCancellations";
import AdminPricing from "@/pages/admin/AdminPricing";
import AdminFinance from "@/pages/admin/AdminFinance";
import AdminReports from "@/pages/admin/AdminReports";
import AdminLiveMap from "@/pages/admin/AdminLiveMap";
import AdminOperations from "@/pages/admin/AdminOperations";
import AdminOffices from "@/pages/admin/AdminOffices";
import AdminVerification from "@/pages/admin/AdminVerification";
import OfficeDashboard from "@/pages/office/OfficeDashboard";
import OfficeDrivers from "@/pages/office/OfficeDrivers";
import OfficeJobs from "@/pages/office/OfficeJobs";
import OfficeSettlements from "@/pages/office/OfficeSettlements";
import OfficeDocuments from "@/pages/office/OfficeDocuments";
import OfficeAgreement from "@/pages/office/OfficeAgreement";

function RoleIndex() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={roleHome(user.role)} replace />;
}

function App() {
  return (
    <AuthProvider>
      <I18nProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/admin/login" element={<AdminLogin />} />
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
              <Route path="worker/documents" element={<WorkerDocuments />} />
              <Route path="worker/profile" element={<WorkerProfile />} />
              <Route path="admin" element={<AdminDashboard />} />
              <Route path="admin/users" element={<AdminUsers />} />
              <Route path="admin/requests" element={<AdminRequests />} />
              <Route path="admin/withdrawals" element={<AdminWithdrawals />} />
              <Route path="admin/settings" element={<AdminSettings />} />
              <Route path="admin/staff" element={<AdminStaff />} />
              <Route path="admin/documents" element={<AdminDocuments />} />
              <Route path="admin/cases" element={<AdminCases />} />
              <Route path="admin/audit" element={<AdminAudit />} />
              <Route path="admin/cancellations" element={<AdminCancellations />} />
              <Route path="admin/pricing" element={<AdminPricing />} />
              <Route path="admin/finance" element={<AdminFinance />} />
              <Route path="admin/reports" element={<AdminReports />} />
              <Route path="admin/live-map" element={<AdminLiveMap />} />
              <Route path="admin/operations" element={<AdminOperations />} />
              <Route path="admin/offices" element={<AdminOffices />} />
              <Route path="admin/offices/:id" element={<AdminOffices />} />
              <Route path="admin/verification" element={<AdminVerification />} />
              <Route path="office" element={<OfficeDashboard />} />
              <Route path="office/drivers" element={<OfficeDrivers />} />
              <Route path="office/jobs" element={<OfficeJobs />} />
              <Route path="office/settlements" element={<OfficeSettlements />} />
              <Route path="office/documents" element={<OfficeDocuments />} />
              <Route path="office/agreement" element={<OfficeAgreement />} />
              <Route path="admin/support" element={<Support />} />
              <Route path="support" element={<Support />} />
              <Route path="notifications" element={<Notifications />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster position="top-center" richColors dir="rtl" />
      </I18nProvider>
    </AuthProvider>
  );
}

export default App;
