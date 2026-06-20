import type { FormTemplateResponse } from '@crm2/sdk';

/**
 * Field form templates (mobile parity). v2 has no server-side field-form template engine — the device
 * renders from its bundled (compiled-in) templates and only consults this endpoint as a fallback,
 * handling a null body. So we return a bare `null` (ADR-0054; use the bundled template).
 */
export const formsService = {
  template(_formType: string): FormTemplateResponse {
    return null;
  },
};
