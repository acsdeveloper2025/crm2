import { useEffect, useState } from 'react';
import { serverNow } from '../lib/serverClock.js';

/**
 * Live header clock (matches v1 + Zion's always-visible clock). Reads ADR-0028 `serverNow()` so the
 * displayed instant is server-authoritative (not the drifting browser clock), and renders it in IST —
 * the operations timezone the shift-gate and MIS run on — regardless of the viewer's machine timezone.
 */
const TICK_MS = 1000;
const TZ = 'Asia/Kolkata';
const dateFmt = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: TZ,
});
const timeFmt = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZone: TZ,
});

export function HeaderClock() {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), TICK_MS);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="hidden flex-col items-end leading-tight sm:flex" aria-label="Server time (IST)">
      <span className="text-xs text-muted-foreground">{dateFmt.format(now)}</span>
      <span className="text-sm font-medium tabular-nums text-foreground">{timeFmt.format(now)} IST</span>
    </div>
  );
}
