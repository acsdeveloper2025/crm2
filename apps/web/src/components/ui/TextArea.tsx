import { forwardRef } from 'react';
import type { ChangeEvent, TextareaHTMLAttributes } from 'react';

import { shouldUppercaseInput } from '../../lib/uppercase.js';

export type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  /** Opt out (false) or force in (true) the uppercase-on-type policy. ADR-0058. */
  uppercase?: boolean;
};

/** The platform multi-line text input. See Input.tsx — same policy, `<textarea>`. */
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { className, uppercase, onChange, ...props },
  ref,
) {
  const autoUpper = shouldUppercaseInput(undefined, props.name, uppercase, props.id);
  const handleChange = autoUpper
    ? (e: ChangeEvent<HTMLTextAreaElement>) => {
        const upper = e.target.value.toUpperCase();
        if (upper !== e.target.value) {
          e.target.value = upper;
        }
        onChange?.(e);
      }
    : onChange;
  const cls = [className, autoUpper ? null : 'case-sensitive'].filter(Boolean).join(' ') || undefined;
  return <textarea ref={ref} className={cls} onChange={handleChange} {...props} />;
});
