import { query } from '../../platform/db.js';
import { composeScopePredicate, type Scope } from '../../platform/scope/index.js';

/** The render context for one task: the CPV + verification type, the device-submitted form blob, and
 *  the FIXED catalog values (keyed EXACTLY by the SOURCE_CATALOG keys — task/case/applicant). Built
 *  inside one `json_build_object` so the snake_case catalog keys survive the camelize layer. */
export interface TaskRenderContext {
  taskId: string;
  clientId: number;
  productId: number;
  /** the verification-type key = the field unit code (e.g. RESIDENCE). */
  verificationType: string;
  /** the device's submitted form blob (root for FORM_DATA_PATH json-paths); null until submitted. */
  formData: Record<string, unknown> | null;
  /** TASK_FIELD catalog values (keyed by catalog key). */
  task: Record<string, unknown>;
  /** CASE_FIELD catalog values. */
  case: Record<string, unknown>;
  /** APPLICANT_FIELD catalog values (the task's targeted applicant). */
  applicant: Record<string, unknown>;
}

/** Case-grain scope predicate (mirrors cases/repository.ts + caseDataEntries) — a case is visible if
 *  the actor created it or is assigned one of its tasks. `cs` is the cases alias. `''` = no filter. */
function caseScopePredicate(params: unknown[], scope: Scope | undefined): string {
  if (!scope) return '';
  return composeScopePredicate(
    params,
    scope,
    (ph) =>
      `cs.created_by = ANY(${ph}) OR EXISTS (SELECT 1 FROM case_tasks ct2 WHERE ct2.case_id = cs.id AND ct2.assigned_to = ANY(${ph}))`,
  );
}

export const fieldReportRepository = {
  /** Load a task's render context, scope-guarded on its case (out-of-scope/absent/wrong-case → null →
   *  the service maps to 404, IDOR-safe). Returns one jsonb object so the catalog keys are preserved
   *  verbatim (the camelize layer only transforms top-level columns, not nested json). */
  async loadContext(
    caseId: string,
    taskId: string,
    scope: Scope | undefined,
  ): Promise<TaskRenderContext | null> {
    const params: unknown[] = [taskId, caseId];
    const pred = caseScopePredicate(params, scope);
    const rows = await query<{ ctx: TaskRenderContext }>(
      `SELECT json_build_object(
                'taskId',           ct.id,
                'clientId',         cs.client_id,
                'productId',        cs.product_id,
                'verificationType', vu.code,
                'formData',         ct.form_data,
                'task', json_build_object(
                  'task_number',          ct.task_number,
                  'status',               ct.status,
                  'visit_type',           ct.visit_type,
                  'distance_band',        ct.distance_band,
                  'bill_count',           ct.bill_count,
                  'verification_outcome', ct.verification_outcome,
                  'remark',               ct.remark,
                  'task_origin',          ct.task_origin,
                  'priority',             ct.priority,
                  'address',              ct.address,
                  'trigger',              ct.trigger,
                  'started_at',           ct.started_at,
                  'completed_at',         ct.completed_at,
                  'created_at',           ct.created_at,
                  'assignee_name',        au.name,
                  'unit_name',            vu.name
                ),
                'case', json_build_object(
                  'case_number',            cs.case_number,
                  'client_name',            cl.name,
                  'product_name',           p.name,
                  'backend_contact_number', cs.backend_contact_number,
                  'case_outcome',           cs.verification_outcome,
                  'case_result_remark',     cs.result_remark,
                  'case_completed_at',      cs.completed_at,
                  'case_created_at',        cs.created_at
                ),
                'applicant', json_build_object(
                  'name',           ca.name,
                  'mobile',         ca.mobile,
                  'pan',            ca.pan,
                  'applicant_type', ca.applicant_type,
                  'calling_code',   ca.calling_code
                )
              ) AS ctx
       FROM case_tasks ct
         JOIN cases cs ON cs.id = ct.case_id
         JOIN clients cl ON cl.id = cs.client_id
         JOIN products p ON p.id = cs.product_id
         JOIN verification_units vu ON vu.id = ct.verification_unit_id
         LEFT JOIN users au ON au.id = ct.assigned_to
         LEFT JOIN case_applicants ca ON ca.id = ct.applicant_id
       WHERE ct.id = $1 AND ct.case_id = $2 ${pred ? `AND (${pred})` : ''}`,
      params,
    );
    return rows[0]?.ctx ?? null;
  },
};
