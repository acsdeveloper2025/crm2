/**
 * Malware scanning for uploads (FILE_UPLOAD-01, docs/audit/08-file-upload.md): magic-byte validation
 * (platform/file.ts, platform/image.ts) confirms a file's TYPE, never its content — a well-formed PDF
 * or JPEG can still carry a payload. This talks to a clamd daemon's INSTREAM protocol directly over
 * `node:net` (a handful of framed writes — no client library needed), and is INERT unless
 * `AV_SCAN_HOST` is configured, matching every other optional external integration in this codebase
 * (GOOGLE_GEOCODING_API_KEY, SMTP_HOST, FIREBASE_SERVICE_ACCOUNT_PATH): with no host set, every upload
 * still passes through unscanned exactly as before this change — this closes the gap the moment a
 * clamd sidecar is stood up (docker-compose.yml has the same commented-until-enabled block valkey uses).
 */
import { connect } from 'node:net';
import { loadEnv } from '@crm2/config';

export interface ScanResult {
  clean: boolean;
  /** the matched signature name when clean=false; absent when clean=true. */
  signature?: string;
}

const CHUNK_BYTES = 65_536;
const SCAN_TIMEOUT_MS = 15_000;

/** Frame one INSTREAM chunk: a 4-byte big-endian length prefix followed by the chunk itself. */
function frame(chunk: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(chunk.length, 0);
  return Buffer.concat([header, chunk]);
}

/**
 * Parse clamd's INSTREAM reply. FAIL-CLOSED (re-audit 2026-07-01, docs/audit/reaudit-2026-07-01):
 * only the two well-formed verdicts are trusted — `stream: OK` (clean) and `stream: <sig> FOUND`
 * (infected). ANYTHING else — clamd's `... ERROR` (e.g. `INSTREAM size limit exceeded. ERROR` when a
 * file exceeds clamd's StreamMaxLength), an empty/truncated reply, or an unrecognized line — returns
 * `null`, which `scanBuffer` turns into a rejection so the upload is refused rather than silently
 * passed as clean. Returns null on a scan we cannot positively confirm clean.
 */
export function parseClamdReply(reply: string): ScanResult | null {
  const found = /stream:\s*(.+?)\s+FOUND\b/.exec(reply);
  if (found?.[1] !== undefined) return { clean: false, signature: found[1] };
  if (/stream:\s*OK\b/.test(reply)) return { clean: true };
  return null; // ERROR / empty / unrecognized → fail closed
}

/** Scan a buffer via clamd. Resolves `{clean: true}` immediately (no network call) if AV_SCAN_HOST is unset. */
export function scanBuffer(bytes: Buffer): Promise<ScanResult> {
  const env = loadEnv();
  if (!env.AV_SCAN_HOST) return Promise.resolve({ clean: true });
  const host = env.AV_SCAN_HOST;
  const port = env.AV_SCAN_PORT;

  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    let reply = '';
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      fn();
    };

    socket.setTimeout(SCAN_TIMEOUT_MS, () => finish(() => reject(new Error('AV scan timed out'))));
    socket.on('error', (err) => finish(() => reject(err)));
    socket.on('data', (d: Buffer) => {
      reply += d.toString('utf8');
    });
    socket.on('close', () =>
      finish(() => {
        const result = parseClamdReply(reply);
        // fail-closed: an ERROR / empty / unrecognized reply is a scan we can't confirm clean → reject,
        // so the caller refuses the upload instead of persisting an unscanned file.
        if (result) resolve(result);
        else reject(new Error(`AV scan: unrecognized clamd reply: ${reply.trim() || '(empty)'}`));
      }),
    );

    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
        socket.write(frame(bytes.subarray(offset, offset + CHUNK_BYTES)));
      }
      socket.write(frame(Buffer.alloc(0))); // zero-length chunk terminates the stream
    });
  });
}
