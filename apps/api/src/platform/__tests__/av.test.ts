import { createServer, type Server } from 'node:net';
import { describe, it, expect, afterEach } from 'vitest';
import { __resetEnv } from '@crm2/config';
import { scanBuffer, parseClamdReply } from '../av.js';

// FILE_UPLOAD-01 (docs/audit/08-file-upload.md): a fake clamd speaking just enough of the real
// INSTREAM wire protocol to prove av.ts frames/parses it correctly, without needing a real ClamAV
// install. `reply` is what the fake daemon sends back once it sees the terminating zero-length chunk.
function fakeClamd(reply: string): Promise<{ server: Server; port: number; received: Buffer[] }> {
  const received: Buffer[] = [];
  return new Promise((resolve) => {
    const server = createServer((socket) => {
      socket.on('data', (chunk: Buffer) => {
        received.push(chunk);
        // the last 4 bytes of a terminating zero-length chunk are 0x00000000 — reply once we see it.
        if (chunk.length >= 4 && chunk.subarray(-4).equals(Buffer.alloc(4))) {
          socket.end(reply);
        }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, port, received });
    });
  });
}

describe('av.scanBuffer', () => {
  afterEach(() => {
    delete process.env['AV_SCAN_HOST'];
    delete process.env['AV_SCAN_PORT'];
    __resetEnv();
  });

  it('no-ops (clean, no network call) when AV_SCAN_HOST is unset', async () => {
    delete process.env['AV_SCAN_HOST'];
    __resetEnv();
    const result = await scanBuffer(Buffer.from('anything'));
    expect(result).toEqual({ clean: true });
  });

  it('reports clean on a real clamd "stream: OK" reply, and frames the INSTREAM protocol correctly', async () => {
    const { server, port, received } = await fakeClamd('stream: OK\0');
    process.env['AV_SCAN_HOST'] = '127.0.0.1';
    process.env['AV_SCAN_PORT'] = String(port);
    __resetEnv();
    try {
      const result = await scanBuffer(Buffer.from('hello world'));
      expect(result).toEqual({ clean: true });
      const sent = Buffer.concat(received);
      expect(sent.subarray(0, 10).toString()).toBe('zINSTREAM\0');
      // terminating zero-length chunk is the final 4 bytes.
      expect(sent.subarray(-4)).toEqual(Buffer.alloc(4));
    } finally {
      server.close();
    }
  });

  it('reports the signature on a "FOUND" reply (the EICAR-style detection path)', async () => {
    const { server, port } = await fakeClamd('stream: Eicar-Signature FOUND\0');
    process.env['AV_SCAN_HOST'] = '127.0.0.1';
    process.env['AV_SCAN_PORT'] = String(port);
    __resetEnv();
    try {
      const result = await scanBuffer(
        Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'),
      );
      expect(result).toEqual({ clean: false, signature: 'Eicar-Signature' });
    } finally {
      server.close();
    }
  });

  it('rejects when nothing is listening on AV_SCAN_HOST:AV_SCAN_PORT', async () => {
    process.env['AV_SCAN_HOST'] = '127.0.0.1';
    process.env['AV_SCAN_PORT'] = '1'; // reserved, guaranteed nothing listens
    __resetEnv();
    await expect(scanBuffer(Buffer.from('x'))).rejects.toThrow();
  });
});

describe('parseClamdReply', () => {
  it('parses OK', () => {
    expect(parseClamdReply('stream: OK\0')).toEqual({ clean: true });
  });
  it('parses FOUND with the signature name', () => {
    expect(parseClamdReply('stream: Win.Test.EICAR_HDB-1 FOUND\0')).toEqual({
      clean: false,
      signature: 'Win.Test.EICAR_HDB-1',
    });
  });
});
