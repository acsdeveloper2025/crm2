import { useEffect, type ReactNode } from 'react';
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
import { RateCreatePage } from './features/rateManagement/RateCreatePage.js';
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
import { MisPage } from './features/mis/MisPage.js';
import { KycQueuePage } from './features/kyc/KycQueuePage.js';
import { FieldMonitoringPage } from './features/fieldMonitoring/FieldMonitoringPage.js';
import { DedupePage } from './features/dedupe/DedupePage.js';
import { CaseCreatePage } from './features/cases/CaseCreatePage.js';
import { CaseDetailPage } from './features/cases/CaseDetailPage.js';
import { SecurityPage } from './features/security/SecurityPage.js';
import { ProfilePage } from './features/profile/ProfilePage.js';
import { BillingPage } from './features/billing/BillingPage.js';
import { CommissionRatesPage } from './features/commissionRates/CommissionRatesPage.js';
import { CommissionRateRecordPage } from './features/commissionRates/CommissionRateRecordPage.js';
import { CommissionRateCreatePage } from './features/commissionRates/CommissionRateCreatePage.js';
import { CommissionSummaryPage } from './features/commissionSummary/CommissionSummaryPage.js';
import { ClientSetupPage } from './features/clientSetup/ClientSetupPage.js';

/**
 * Page-permission gate for the Administration routes. An unauthorised role that types an `/admin/*`
 * URL directly (the nav only shows what it may open) gets the same clean "no access" state the
 * operational pages render inline — instead of the full page chrome plus a burst of forbidden data
 * calls. Blocking the render here also means the page never mounts, so its data queries never fire.
 * The perm passed to each route mirrors the nav gate in `Layout.tsx` (which mirrors the API).
 */
function RequirePerm({ perm, children }: { perm: string; children: ReactNode }) {
  const { has } = useAuth();
  if (!has(perm)) return <div className="text-destructive">You don&apos;t have access to this page.</div>;
  return <>{children}</>;
}

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
        {/* Administration routes are page-permission-gated (RequirePerm) so an unauthorised role that
            types the URL sees a clean "no access" state, not the page chrome + forbidden data calls. */}
        <Route
          path="/admin/verification-units"
          element={
            <RequirePerm perm="page.masterdata">
              <VerificationUnitsPage />
            </RequirePerm>
          }
        />
        <Route
          path="/admin/verification-units/new"
          element={
            <RequirePerm perm="page.masterdata">
              <VerificationUnitRecordPage />
            </RequirePerm>
          }
        />
        <Route
          path="/admin/verification-units/:id"
          element={
            <RequirePerm perm="page.masterdata">
              <VerificationUnitRecordPage />
            </RequirePerm>
          }
        />
        <Route
          path="/admin/client-setup"
          element={
            <RequirePerm perm="page.masterdata">
              <ClientSetupPage />
            </RequirePerm>
          }
        />
        <Route
          path="/admin/clients"
          element={
            <RequirePerm perm="page.masterdata">
              <ClientsPage />
            </RequirePerm>
          }
        />
        <Route
          path="/admin/products"
          element={
            <RequirePerm perm="page.masterdata">
              <ProductsPage />
            </RequirePerm>
          }
        />
        <Route
          path="/admin/cpv"
          element={
            <RequirePerm perm="page.masterdata">
              <CpvPage />
            </RequirePerm>
          }
        />
        <Route
          path="/admin/rates"
          element={
            <RequirePerm perm="page.masterdata">
              <RateManagementPage />
            </RequirePerm>
          }
        />
        <Route
          path="/admin/rates/new"
          element={
            <RequirePerm perm="page.masterdata">
              <RateCreatePage />
            </RequirePerm>
          }
        />
        <Route
          path="/admin/rates/:id"
          element={
            <RequirePerm perm="page.masterdata">
              <RateRecordPage />
            </RequirePerm>
          }
        />
        <Route
          path="/admin/rate-types"
          element={
            <RequirePerm perm="page.masterdata">
              <RateTypesPage />
            </RequirePerm>
          }
        />
        <Route
          path="/admin/rate-type-assignments"
          element={
            <RequirePerm perm="page.masterdata">
              <RateTypeAssignmentsPage />
            </RequirePerm>
          }
        />
        <Route
          path="/admin/rate-type-assignments/new"
          element={
            <RequirePerm perm="page.masterdata">
              <RateTypeAssignmentRecordPage />
            </RequirePerm>
          }
        />
        <Route
          path="/admin/rate-type-assignments/:id"
          element={
            <RequirePerm perm="page.masterdata">
              <RateTypeAssignmentRecordPage />
            </RequirePerm>
          }
        />
        <Route
          path="/admin/commission-rates"
          element={
            <RequirePerm perm="masterdata.manage">
              <CommissionRatesPage />
            </RequirePerm>
          }
        />
        <Route
          path="/admin/commission-rates/new"
          element={
            <RequirePerm perm="masterdata.manage">
              <CommissionRateCreatePage />
            </RequirePerm>
          }
        />
        <Route
          path="/admin/commission-rates/:id"
          element={
            <RequirePerm perm="masterdata.manage">
              <CommissionRateRecordPage />
            </RequirePerm>
          }
        />
        <Route
          path="/admin/locations"
          element={
            <RequirePerm perm="page.masterdata">
              <LocationsPage />
            </RequirePerm>
          }
        />
        <Route
          path="/admin/users"
          element={
            <RequirePerm perm="page.users">
              <UsersPage />
            </RequirePerm>
          }
        />
        <Route
          path="/admin/users/new"
          element={
            <RequirePerm perm="page.users">
              <UserRecordPage />
            </RequirePerm>
          }
        />
        <Route
          path="/admin/users/:id"
          element={
            <RequirePerm perm="page.users">
              <UserRecordPage />
            </RequirePerm>
          }
        />
        <Route
          path="/admin/departments"
          element={
            <RequirePerm perm="page.users">
              <DepartmentsPage />
            </RequirePerm>
          }
        />
        <Route
          path="/admin/designations"
          element={
            <RequirePerm perm="page.users">
              <DesignationsPage />
            </RequirePerm>
          }
        />
        <Route
          path="/admin/rbac"
          element={
            <RequirePerm perm="page.access">
              <RolesPage />
            </RequirePerm>
          }
        />
        <Route
          path="/admin/rbac/new"
          element={
            <RequirePerm perm="page.access">
              <RoleRecordPage />
            </RequirePerm>
          }
        />
        <Route
          path="/admin/rbac/:code"
          element={
            <RequirePerm perm="page.access">
              <RoleRecordPage />
            </RequirePerm>
          }
        />
        <Route
          path="/admin/system"
          element={
            <RequirePerm perm="page.system">
              <SystemPage />
            </RequirePerm>
          }
        />
        <Route
          path="/admin/policies"
          element={
            <RequirePerm perm="page.policies">
              <PoliciesPage />
            </RequirePerm>
          }
        />
        <Route
          path="/admin/policies/new"
          element={
            <RequirePerm perm="page.policies">
              <PolicyRecordPage />
            </RequirePerm>
          }
        />
        <Route
          path="/admin/policies/:id"
          element={
            <RequirePerm perm="page.policies">
              <PolicyRecordPage />
            </RequirePerm>
          }
        />
        <Route path="/security" element={<SecurityPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/pipeline" element={<PipelinePage />} />
        <Route path="/kyc-queue" element={<KycQueuePage />} />
        <Route path="/mis" element={<MisPage />} />
        <Route path="/field-monitoring" element={<FieldMonitoringPage />} />
        <Route path="/dedupe" element={<DedupePage />} />
        <Route path="/cases" element={<CasesPage />} />
        <Route path="/cases/new" element={<CaseCreatePage />} />
        <Route path="/cases/:id" element={<CaseDetailPage />} />
        <Route path="/billing" element={<BillingPage />} />
        <Route path="/commission-summary" element={<CommissionSummaryPage />} />
        <Route path="*" element={<div className="text-muted-foreground">Not built yet.</div>} />
      </Routes>
    </Layout>
  );
}
