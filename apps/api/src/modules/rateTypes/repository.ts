import type { RateType } from '@crm2/sdk';
import { query } from '../../platform/db.js';

export const rateTypeRepository = {
  list(activeOnly: boolean): Promise<RateType[]> {
    // activeOnly is the operational dropdown read → only USABLE rows (ADR-0017).
    const clause = activeOnly ? 'WHERE is_active AND effective_from <= now()' : '';
    return query<RateType>(
      `SELECT id, code, sort_order, is_active, effective_from FROM rate_types ${clause} ORDER BY sort_order, code`,
      [],
    );
  },
};
