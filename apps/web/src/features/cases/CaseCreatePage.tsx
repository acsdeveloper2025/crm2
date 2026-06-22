import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import type { Case, CaseDetail, DuplicateMatch } from '@crm2/sdk';
import { PAN_REGEX, PHONE_REGEX } from '@crm2/sdk';
import { api } from '../../lib/sdk.js';
import { useAuth } from '../../lib/AuthContext.js';
import { Input } from '../../components/ui/Input.js';
import { TextArea } from '../../components/ui/TextArea.js';
import { AddTasksForm } from './AddTasksForm.js';
import { summarizeDedupe, type DedupeGroup } from './dedupeBatch.js';

interface Option {
  id: number;
  code: string;
  name: string;
}
interface ApplicantRow {
  name: string;
  mobile: string;
  pan: string;
  companyName: string;
}
// Field rules shared with the contract (@crm2/sdk). Optional fields are valid when blank.
const phoneOk = (v: string): boolean => v.trim() === '' || PHONE_REGEX.test(v.trim());
const panOk = (v: string): boolean => v.trim() === '' || PAN_REGEX.test(v.trim());
const onlyDigits = (v: string): string => v.replace(/\D/g, '');
const emptyApplicant = (): ApplicantRow => ({ name: '', mobile: '', pan: '', companyName: '' });
const trimmed = (a: ApplicantRow) => ({
  name: a.name.trim(),
  ...(a.mobile.trim() ? { mobile: a.mobile.trim() } : {}),
  ...(a.pan.trim() ? { pan: a.pan.trim() } : {}),
  ...(a.companyName.trim() ? { companyName: a.companyName.trim() } : {}),
});

/**
 * Zion NewDataEntry single-page flow: applicant + co-applicants, search-first dedupe gate
 * (matches across all applicants) → Create Case → add per-task specs (CPV unit + the applicant
 * it verifies + dispatch address/trigger/priority; ADR-0023).
 */
export function CaseCreatePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [clientId, setClientId] = useState('');
  const [productId, setProductId] = useState('');
  // Office contact the field agent calls — prefilled from the creator's phone (ADR-0023), editable.
  const [backendContactNumber, setBackendContactNumber] = useState(user?.phone ?? '');
  const [applicants, setApplicants] = useState<ApplicantRow[]>([emptyApplicant()]);
  const [created, setCreated] = useState<Case | null>(null);
  // Mandatory dedupe gate: Create is blocked until a search runs; editing identity re-arms it.
  const [hasSearched, setHasSearched] = useState(false);
  // ADR-0053: per-applicant dedupe result groups (the Search checks EVERY applicant, not just primary).
  const [groups, setGroups] = useState<DedupeGroup[]>([]);
  const [rationale, setRationale] = useState('');

  const { data: clients } = useQuery({
    queryKey: ['clients', 'active'],
    queryFn: () => api<Option[]>('GET', '/api/v2/clients/options'),
  });
  const { data: products } = useQuery({
    queryKey: ['products', 'active'],
    queryFn: () => api<Option[]>('GET', '/api/v2/products/options'),
  });

  // Auto-select when the actor's portfolio (scoped options) leaves exactly one choice (E).
  useEffect(() => {
    if (clients && clients.length === 1 && !clientId) setClientId(String(clients[0]!.id));
  }, [clients, clientId]);
  useEffect(() => {
    if (products && products.length === 1 && !productId) setProductId(String(products[0]!.id));
  }, [products, productId]);

  const primary = applicants[0] ?? emptyApplicant();
  const armSearch = () => setHasSearched(false); // identity changed → must re-search
  const setApplicant = (i: number, patch: Partial<ApplicantRow>) => {
    armSearch();
    setApplicants((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  // ADR-0053: search EVERY applicant that has ≥1 identifier (reuses the existing per-applicant dedupe
  // endpoint, one call each), keep each applicant's matches in its own group, then derive the single
  // case-level decision from the union. Co-applicants are no longer a dedupe blind spot.
  const dedupe = useMutation({
    mutationFn: async (): Promise<DedupeGroup[]> => {
      const labelOf = (i: number) => (i === 0 ? 'Applicant' : `Co-applicant ${i}`);
      const searchable = applicants
        .map((a, index) => ({ a, index }))
        .filter(({ a }) => a.name.trim() || a.mobile.trim() || a.pan.trim());
      return Promise.all(
        searchable.map(async ({ a, index }) => ({
          index,
          label: labelOf(index),
          name: a.name.trim(),
          matches: await api<DuplicateMatch[]>('POST', '/api/v2/cases/dedupe', {
            ...(a.name.trim() ? { name: a.name.trim() } : {}),
            ...(a.mobile.trim() ? { mobile: a.mobile.trim() } : {}),
            ...(a.pan.trim() ? { pan: a.pan.trim() } : {}),
          }),
        })),
      );
    },
    onSuccess: (g) => {
      setGroups(g);
      setHasSearched(true);
    },
  });

  const summary = summarizeDedupe(groups);
  const hasMatches = hasSearched && summary.matchedCaseNumbers.length > 0;
  const decision = summary.decision;

  const create = useMutation({
    mutationFn: () =>
      api<Case>('POST', '/api/v2/cases', {
        clientId: Number(clientId),
        productId: Number(productId),
        backendContactNumber: backendContactNumber.trim(),
        applicants: applicants.filter((a) => a.name.trim()).map(trimmed),
        dedupeDecision: decision,
        ...(hasMatches
          ? { dedupeRationale: rationale.trim(), dedupeMatches: summary.matchedCaseNumbers }
          : {}),
      }),
    onSuccess: (c) => setCreated(c),
  });

  const canSearch = Boolean(primary.name.trim() || primary.mobile.trim() || primary.pan.trim());
  const rationaleOk = !hasMatches || rationale.trim().length >= 5;
  const contactOk = PHONE_REGEX.test(backendContactNumber.trim());
  const applicantsValid = applicants.every((a) => phoneOk(a.mobile) && panOk(a.pan));
  const canCreate =
    Boolean(clientId && productId && primary.name.trim()) &&
    contactOk &&
    applicantsValid &&
    hasSearched &&
    rationaleOk &&
    !created;
  // Tell the operator exactly what's blocking Create (the button stays disabled until all pass).
  const disabledReason = !clientId
    ? 'Select a client.'
    : !productId
      ? 'Select a product.'
      : !primary.name.trim()
        ? 'Enter the applicant name.'
        : !contactOk
          ? 'Enter a valid backend contact number (10–15 digits).'
          : !applicantsValid
            ? 'Fix the highlighted mobile / PAN fields.'
            : !hasSearched
              ? 'Search for duplicates first.'
              : !rationaleOk
                ? 'Add a rationale (min 5 characters) for creating despite duplicates.'
                : '';

  // Single continuous flow (Zion-style): the case form stays on the page; once created it locks and
  // the Add Tasks section appears INLINE below it — the applicant details remain visible throughout.
  const locked = !!created;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">New Case</h1>
        <p className="text-sm text-muted-foreground">
          Check for duplicates, then create the case and add documents to verify.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <fieldset disabled={locked} className="m-0 min-w-0 border-0 p-0">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
            <Field label="Client">
              <select className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">Select client…</option>
                {clients?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Product">
              <select className="input" value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">Select product…</option>
                {products?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Backend Contact No">
              <Input
                uppercase={false}
                className="input"
                inputMode="numeric"
                maxLength={15}
                value={backendContactNumber}
                onChange={(e) => setBackendContactNumber(onlyDigits(e.target.value))}
                placeholder="Office number the field agent calls"
              />
              {/* Always reserve the message line so validation toggles in place (no layout shift). */}
              <span className="mt-1 block min-h-[1rem] text-xs text-destructive">
                {backendContactNumber.trim() !== '' && !contactOk ? 'Enter 10–15 digits.' : ''}
              </span>
            </Field>
            <Field label="Date">
              <input className="input" value={new Date().toLocaleString()} disabled readOnly />
            </Field>
          </div>

          <div className="mt-4 space-y-2">
            {applicants.map((a, i) => (
              <div
                key={i}
                className="grid grid-cols-1 items-start gap-2 md:grid-cols-[1.5fr_1fr_1fr_1.5fr_auto]"
              >
                <Field label={i === 0 ? 'Applicant Name' : `Co-applicant ${i} Name`}>
                  <Input
                    className="input"
                    value={a.name}
                    onChange={(e) => setApplicant(i, { name: e.target.value })}
                    placeholder="Enter name"
                  />
                </Field>
                <Field label="Mobile No">
                  <Input
                    uppercase={false}
                    className="input"
                    inputMode="numeric"
                    maxLength={15}
                    value={a.mobile}
                    onChange={(e) => setApplicant(i, { mobile: onlyDigits(e.target.value) })}
                    placeholder="10–15 digits"
                  />
                  <span className="mt-1 block min-h-[1rem] text-xs text-destructive">
                    {!phoneOk(a.mobile) ? 'Enter 10–15 digits.' : ''}
                  </span>
                </Field>
                <Field label="PAN No">
                  <Input
                    uppercase={false}
                    className="input"
                    maxLength={10}
                    value={a.pan}
                    onChange={(e) => setApplicant(i, { pan: e.target.value.toUpperCase() })}
                    placeholder="ABCDE1234F"
                  />
                  <span className="mt-1 block min-h-[1rem] text-xs text-destructive">
                    {!panOk(a.pan) ? 'Format: ABCDE1234F.' : ''}
                  </span>
                </Field>
                <Field label="Company Name">
                  <Input
                    className="input"
                    maxLength={200}
                    value={a.companyName}
                    onChange={(e) => setApplicant(i, { companyName: e.target.value })}
                    placeholder="Company / employer"
                  />
                </Field>
                {/* Mirror a field's [label][input] stack so Primary/Remove line up with the inputs now
                    that the row is top-aligned: an invisible label-height spacer + an input-height row. */}
                <div className="flex flex-col">
                  <span className="mb-1 block text-xs font-medium invisible select-none" aria-hidden>
                    .
                  </span>
                  <div className="flex h-9 items-center">
                    {i === 0 ? (
                      <span className="text-xs text-muted-foreground">Primary</span>
                    ) : (
                      <button
                        className="text-sm text-destructive hover:underline"
                        onClick={() => {
                          armSearch(); // changing the applicant set re-arms the dedupe gate (ADR-0053)
                          setApplicants((rows) => rows.filter((_, idx) => idx !== i));
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
            <button
              className="text-sm font-medium text-primary hover:underline"
              onClick={() => {
                armSearch(); // a new applicant must be deduped before Create (ADR-0053)
                setApplicants((rows) => [...rows, emptyApplicant()]);
              }}
            >
              + Add co-applicant
            </button>
          </div>
        </fieldset>

        {created ? (
          <div className="mt-4 flex items-center gap-2 border-t border-border pt-4">
            <span className="text-sm font-medium text-st-completed">
              ✓ Case {created.caseNumber} created — add documents/tasks below.
            </span>
            <button className="btn-ghost ml-auto" onClick={() => navigate('/cases')}>
              Done
            </button>
          </div>
        ) : (
          <div className="mt-4 flex items-center gap-2">
            <button
              className="btn-ghost"
              disabled={!canSearch || dedupe.isPending}
              onClick={() => dedupe.mutate()}
            >
              {dedupe.isPending ? 'Searching…' : 'Search (dedupe)'}
            </button>
            <button className="btn" disabled={!canCreate || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? 'Creating…' : 'Create Case'}
            </button>
            {!canCreate && disabledReason && (
              <span className="text-sm text-muted-foreground">{disabledReason}</span>
            )}
            {create.isError && <span className="text-sm text-destructive">Create failed.</span>}
          </div>
        )}
      </div>

      {hasSearched && (
        <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
          <div className="bg-surface-muted px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Dedupe Search Result — {summary.matchedCaseNumbers.length} match
            {summary.matchedCaseNumbers.length === 1 ? '' : 'es'} across {groups.length} applicant
            {groups.length === 1 ? '' : 's'}
          </div>
          {!hasMatches ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              No duplicates found — safe to create (decision: NO DUPLICATES FOUND).
            </div>
          ) : (
            <>
              {groups.map((g) => (
                <div key={g.index} className="border-t border-border">
                  <div className="px-3 py-2 text-xs font-medium text-foreground">
                    {g.label}
                    {g.name ? ` (${g.name})` : ''} — {g.matches.length} match
                    {g.matches.length === 1 ? '' : 'es'}
                  </div>
                  {g.matches.length > 0 && (
                    <table className="rtable w-full text-sm">
                      <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-semibold">Case</th>
                          <th className="px-3 py-2 font-semibold">Applicant</th>
                          <th className="px-3 py-2 font-semibold">Mobile</th>
                          <th className="px-3 py-2 font-semibold">PAN</th>
                          <th className="px-3 py-2 font-semibold">Client</th>
                          <th className="px-3 py-2 font-semibold">Status</th>
                          <th className="px-3 py-2 font-semibold">Matched</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.matches.map((d, i) => (
                          <tr key={`${d.caseId}-${i}`} className="border-t border-border">
                            <td data-label="Case" className="px-3 py-2 font-mono text-xs">
                              {d.caseNumber}
                            </td>
                            <td data-label="Applicant" className="px-3 py-2">
                              {d.applicantName}
                            </td>
                            <td data-label="Mobile" className="px-3 py-2">
                              {d.mobile ?? '—'}
                            </td>
                            <td data-label="PAN" className="px-3 py-2 font-mono text-xs">
                              {d.pan ?? '—'}
                            </td>
                            <td data-label="Client" className="px-3 py-2">
                              {d.clientName}
                            </td>
                            <td data-label="Status" className="px-3 py-2">
                              {d.status.replace(/_/g, ' ')}
                            </td>
                            <td data-label="Matched" className="px-3 py-2">
                              {d.matchType.map((m) => (
                                <span
                                  key={m}
                                  className="mr-1 rounded bg-st-revisit-bg px-1.5 py-0.5 text-xs text-st-revisit"
                                >
                                  {m}
                                </span>
                              ))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ))}
              <div className="border-t border-border p-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-foreground">
                    Duplicates exist — decision: CREATE NEW. Rationale (required)
                  </span>
                  <TextArea
                    className="input min-h-[4rem]"
                    value={rationale}
                    onChange={(e) => setRationale(e.target.value)}
                    placeholder="Why is a new case justified despite the duplicate(s)?"
                  />
                </label>
              </div>
            </>
          )}
        </div>
      )}

      {/* Inline continuation: once the case exists, add its documents/tasks right here. */}
      {created && (
        <AddTasksStage
          caseRow={created}
          clientId={Number(clientId)}
          productId={Number(productId)}
          onDone={() => navigate('/cases')}
        />
      )}
    </div>
  );
}

/** Inline continuation below the (now locked) case form: add the case's documents/tasks. */
function AddTasksStage({
  caseRow,
  clientId,
  productId,
  onDone,
}: {
  caseRow: Case;
  clientId: number;
  productId: number;
  onDone: () => void;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canAssign = !!user && (user.grantsAll === true || (user.permissions ?? []).includes('case.assign'));
  const { data: detail } = useQuery({
    queryKey: ['case', caseRow.id],
    queryFn: () => api<CaseDetail>('GET', `/api/v2/cases/${caseRow.id}`),
  });
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Add Documents / Tasks
        </h2>
      </div>
      <AddTasksForm
        caseId={caseRow.id}
        clientId={clientId}
        productId={productId}
        applicants={detail?.applicants ?? []}
        canAssign={canAssign}
        submitLabel="Add"
        // After adding, go to the case detail page so the full applicants + tasks are visible (the SS layout).
        onAdded={() => navigate(`/cases/${caseRow.id}`)}
        onCancel={onDone}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-foreground">{label}</span>
      {children}
    </label>
  );
}
