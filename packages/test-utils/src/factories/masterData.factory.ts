/**
 * Master-data factories — valid create-inputs for clients + products, with overrides.
 * Codes are unique per call so tests can create many without collisions.
 */
let clientSeq = 0;
let productSeq = 0;

export interface ClientInput {
  code: string;
  name: string;
}
export interface ProductInput {
  code: string;
  name: string;
}

export function clientFactory(overrides: Partial<ClientInput> = {}): ClientInput {
  clientSeq += 1;
  return { code: `CLIENT_${clientSeq}`, name: `Client ${clientSeq}`, ...overrides };
}

export function productFactory(overrides: Partial<ProductInput> = {}): ProductInput {
  productSeq += 1;
  return { code: `PRODUCT_${productSeq}`, name: `Product ${productSeq}`, ...overrides };
}

let userSeq = 0;
type UserRole = 'SUPER_ADMIN' | 'MANAGER' | 'TEAM_LEADER' | 'BACKEND_USER' | 'FIELD_AGENT' | 'KYC_VERIFIER';
export interface UserInput {
  username: string;
  name: string;
  email?: string;
  phone?: string;
  departmentId?: number;
  designationId?: number;
  role: UserRole;
  reportsTo?: string;
  effectiveFrom?: string;
  /** optional initial password (strong policy) — set on create. */
  password?: string;
}

/** Valid create-input for a user (unique username per call), defaulting to FIELD_AGENT. */
export function userFactory(overrides: Partial<UserInput> = {}): UserInput {
  userSeq += 1;
  return { username: `user_${userSeq}`, name: `User ${userSeq}`, role: 'FIELD_AGENT', ...overrides };
}
