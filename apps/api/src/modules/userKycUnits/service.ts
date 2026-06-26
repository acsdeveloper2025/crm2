import { SetKycUnitsSchema, type UserKycUnits } from '@crm2/sdk';
import { userKycUnitsRepository as repo } from './repository.js';
import { AppError } from '../../platform/errors.js';

/**
 * KYC-verifier unit-grant management (ADR-0073). Grants gate OFFICE assignment eligibility; they are NOT
 * data scope. The grantee must be a KYC verifier (the OFFICE pool role); any active verification unit is
 * grantable (field or office — a KYC verifier can be OFFICE-assigned a task at any unit).
 */
export const userKycUnitsService = {
  async get(userId: string): Promise<UserKycUnits> {
    if ((await repo.roleOf(userId)) === null) throw AppError.notFound('USER_NOT_FOUND');
    return repo.forUser(userId);
  },

  async set(userId: string, input: unknown, actorId: string): Promise<UserKycUnits> {
    const { unitIds } = SetKycUnitsSchema.parse(input); // 400 VALIDATION on a bad shape
    const role = await repo.roleOf(userId);
    if (role === null) throw AppError.notFound('USER_NOT_FOUND');
    // Only an OFFICE-pool-role user (data-driven, ADR-0022 — no role-name literal) can be granted units.
    if (role !== (await repo.officePoolRole())) throw AppError.badRequest('NOT_KYC_VERIFIER');
    // Every id must be an existing active verification unit (unknown/inactive id → 400).
    const { availableUnits } = await repo.forUser(userId);
    const valid = new Set(availableUnits.map((u) => u.id));
    if (unitIds.some((id) => !valid.has(id))) throw AppError.badRequest('INVALID_REFERENCE');
    await repo.setForUser(userId, [...new Set(unitIds)], actorId);
    return repo.forUser(userId);
  },
};
