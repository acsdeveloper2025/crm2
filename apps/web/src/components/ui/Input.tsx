import { forwardRef } from 'react';
import type { ChangeEvent, InputHTMLAttributes } from 'react';

import { shouldUppercaseInput } from '../../lib/uppercase.js';

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  /** Opt out (false) or force in (true) the global uppercase-on-type policy.
   *  Unset = auto-detect via shouldUppercaseInput(type, name, _, id). ADR-0058. */
  uppercase?: boolean;
};

/**
 * The platform text input. Drop-in for a bare `<input className="input">`: it
 * preserves the caller's className and only (a) uppercases the typed value for
 * non-case-sensitive fields and (b) tags case-sensitive fields with
 * `.case-sensitive` so the body-uppercase CSS leaves them verbatim (WYSIWYG).
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, type, uppercase, onChange, ...props },
  ref,
) {
  const autoUpper = shouldUppercaseInput(type, props.name, uppercase, props.id);
  const handleChange = autoUpper
    ? (e: ChangeEvent<HTMLInputElement>) => {
        const upper = e.target.value.toUpperCase();
        if (upper !== e.target.value) {
          e.target.value = upper;
        }
        onChange?.(e);
      }
    : onChange;
  // Keep the display in lockstep with the stored value: opt case-sensitive
  // fields out of the global body-uppercase so the user sees what they typed.
  const cls = [className, autoUpper ? null : 'case-sensitive'].filter(Boolean).join(' ') || undefined;
  return <input type={type} ref={ref} className={cls} onChange={handleChange} {...props} />;
});
