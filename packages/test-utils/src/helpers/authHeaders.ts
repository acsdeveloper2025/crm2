/**
 * Test auth seam. Integration tests send `x-test-auth: <role>:<userId>`; the API's
 * test/dev auth middleware reads it into req.auth. (Real JWT auth lands in a later step;
 * this keeps RBAC tests runnable now without minting tokens.)
 */
export type Role =
  | 'SUPER_ADMIN'
  | 'MANAGER'
  | 'TEAM_LEADER'
  | 'BACKEND_USER'
  | 'FIELD_AGENT'
  | 'KYC_VERIFIER';

export function authHeaderForRole(role: Role, userId = '00000000-0000-0000-0000-000000000001') {
  return { 'x-test-auth': `${role}:${userId}` };
}
