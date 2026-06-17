import type { Request } from 'express';

/**
 * Read a route param as a scalar string.
 *
 * Express 5's types (`@types/express` 5 / `ParamsDictionary`) widened param
 * values to `string | string[]` because path-to-regexp v8 can yield arrays for
 * repeated params (e.g. `:id+`). None of our routes use repeated params, so a
 * param is always a single string at runtime; collapse the array form
 * defensively to its first element and treat a missing param as the empty
 * string (callers shape-validate downstream).
 */
export function paramStr(req: Request, name: string): string {
  const v = req.params[name];
  return (Array.isArray(v) ? v[0] : v) ?? '';
}
