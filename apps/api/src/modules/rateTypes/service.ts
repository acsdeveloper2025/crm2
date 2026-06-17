import { rateTypeRepository as repo } from './repository.js';

/** Rate-type lookup service — read-only managed list for the rate dropdown. */
export const rateTypeService = {
  list: (activeOnly: boolean) => repo.list(activeOnly),
};
