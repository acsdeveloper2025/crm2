import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { useAuth } from './lib/AuthContext.js';
import { syncServerClock } from './lib/serverClock.js';
import { LoginPage } from './features/auth/LoginPage.js';
import { MustChangePasswordPage } from './features/auth/MustChangePasswordPage.js';
import { MustAcceptPoliciesPage } from './features/auth/MustAcceptPoliciesPage.js';
import { Layout } from './components/Layout.js';
import { VerificationUnitsPage } from './features/verificationUnits/VerificationUnitsPage.js';
import { VerificationUnitRecordPage } from './features/verificationUnits/VerificationUnitRecordPage.js';
import { PoliciesPage } from './features/policies/PoliciesPage.js';
import { PolicyRecordPage } from './features/policies/PolicyRecordPage.js';
import { ClientsPage } from './features/clients/ClientsPage.js';
import { ProductsPage } from './features/products/ProductsPage.js';
import { CpvPage } from './features/cpv/CpvPage.js';
import { RateManagementPage } from './features/rateManagement/RateManagementPage.js';
import { RateRecordPage } from './features/rateManagement/RateRecordPage.js';
import { RateTypesPage } from './features/rateTypes/RateTypesPage.js';
import { RateTypeAssignmentsPage } from './features/rateTypeAssignments/RateTypeAssignmentsPage.js';
import { RateTypeAssignmentRecordPage } from './features/rateTypeAssignments/RateTypeAssignmentRecordPage.js';
import { LocationsPage } from './features/locations/LocationsPage.js';
import { UsersPage } from './features/users/UsersPage.js';
import { UserRecordPage } from './features/users/UserRecordPage.js';
import { DepartmentsPage } from './features/departments/DepartmentsPage.js';
import { DesignationsPage } from './features/designations/DesignationsPage.js';
import { RolesPage } from './features/access/RolesPage.js';
import { RoleRecordPage } from './features/access/RoleRecordPage.js';
import { SystemPage } from './features/system/SystemPage.js';
import { CasesPage } from './features/cases/CasesPage.js';
import { DashboardPage } from './features/dashboard/DashboardPage.js';
import { PipelinePage } from './features/pipeline/PipelinePage.js';
import { FieldMonitoringPage } from './features/fieldMonitoring/FieldMonitoringPage.js';
import { DedupePage } from './features/dedupe/DedupePage.js';
import { CaseCreatePage } from './features/cases/CaseCreatePage.js';
import { CaseDetailPage } from './features/cases/CaseDetailPage.js';
import { SecurityPage } from './features/security/SecurityPage.js';
import { ProfilePage } from './features/profile/ProfilePage.js';
import { BillingPage } from './features/billing/BillingPage.js';
import { CommissionRatesPage } from './features/commissionRates/CommissionRatesPage.js';
import { CommissionRateRecordPage } from './features/commissionRates/CommissionRateRecordPage.js';
import { ReportLayoutsPage } from './features/reportLayouts/ReportLayoutsPage.js';
import { ReportLayoutRecordPage } from './features/reportLayouts/ReportLayoutRecordPage.js';
import { MisPage } from './features/mis/MisPage.js';

export function App() {
  const { user, ready, mustChangePassword, mustAcceptPolicies } = useAuth();

  // ADR-0028: sync the server clock offset once at boot (unauthenticated `/api/v2/time`), so any
  // client-originated time decision uses server-corrected time.
  useEffect(() => {
    void syncServerClock();
  }, []);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-muted text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (!user) return <LoginPage />;
  // Per-role rotation or an admin-issued one-time password: block the app until it's changed.
  if (mustChangePassword) return <MustChangePasswordPage />;
  // ADR-0042: block the app until the user accepts every active policy returned by login.
  if (mustAcceptPolicies) return <MustAcceptPoliciesPage />;

  return (
    <Layout>
      <Toaster richColors position="top-right" />
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/admin/verification-units" element={<VerificationUnitsPage />} />
        <Route path="/admin/verification-units/new" element={<VerificationUnitRecordPage />} />
        <Route path="/admin/verification-units/:id" element={<VerificationUnitRecordPage />} />
        <Route path="/admin/clients" element={<ClientsPage />} />
        <Route path="/admin/products" element={<ProductsPage />} />
        <Route path="/admin/cpv" element={<CpvPage />} />
        <Route path="/admin/rates" element={<RateManagementPage />} />
        <Route path="/admin/rates/new" element={<RateRecordPage />} />
        <Route path="/admin/rates/:id" element={<RateRecordPage />} />
        <Route path="/admin/rate-types" element={<RateTypesPage />} />
        <Route path="/admin/rate-type-assignments" element={<RateTypeAssignmentsPage />} />
        <Route path="/admin/rate-type-assignments/new" element={<RateTypeAssignmentRecordPage />} />
        <Route path="/admin/rate-type-assignments/:id" element={<RateTypeAssignmentRecordPage />} />
        <Route path="/admin/commission-rates" element={<CommissionRatesPage />} />
        <Route path="/admin/commission-rates/new" element={<CommissionRateRecordPage />} />
        <Route path="/admin/commission-rates/:id" element={<CommissionRateRecordPage />} />
        <Route path="/admin/report-layouts" element={<ReportLayoutsPage />} />
        <Route path="/admin/report-layouts/new" element={<ReportLayoutRecordPage />} />
        <Route path="/admin/report-layouts/:id" element={<ReportLayoutRecordPage />} />
        <Route path="/admin/locations" element={<LocationsPage />} />
        <Route path="/admin/users" element={<UsersPage />} />
        <Route path="/admin/users/new" element={<UserRecordPage />} />
        <Route path="/admin/users/:id" element={<UserRecordPage />} />
        <Route path="/admin/departments" element={<DepartmentsPage />} />
        <Route path="/admin/designations" element={<DesignationsPage />} />
        <Route path="/admin/rbac" element={<RolesPage />} />
        <Route path="/admin/rbac/new" element={<RoleRecordPage />} />
        <Route path="/admin/rbac/:code" element={<RoleRecordPage />} />
        <Route path="/admin/system" element={<SystemPage />} />
        <Route path="/admin/policies" element={<PoliciesPage />} />
        <Route path="/admin/policies/new" element={<PolicyRecordPage />} />
        <Route path="/admin/policies/:id" element={<PolicyRecordPage />} />
        <Route path="/security" element={<SecurityPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/pipeline" element={<PipelinePage />} />
        <Route path="/field-monitoring" element={<FieldMonitoringPage />} />
        <Route path="/dedupe" element={<DedupePage />} />
        <Route path="/cases" element={<CasesPage />} />
        <Route path="/cases/new" element={<CaseCreatePage />} />
        <Route path="/cases/:id" element={<CaseDetailPage />} />
        <Route path="/mis" element={<MisPage />} />
        <Route path="/billing" element={<BillingPage />} />
        <Route path="*" element={<div className="text-muted-foreground">Not built yet.</div>} />
      </Routes>
    </Layout>
  );
}
