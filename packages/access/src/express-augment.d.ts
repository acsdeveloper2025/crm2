import type { AuthContext } from './authorize.js';

/** Express Request augmentation — auth context set by the auth middleware. */
declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export {};
