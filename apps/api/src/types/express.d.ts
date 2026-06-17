import type { Logger } from '@crm2/logger';

/** Express Request augmentation: per-request logger. (`auth` is augmented by @crm2/access.) */
declare global {
  namespace Express {
    interface Request {
      log?: Logger;
    }
  }
}

export {};
