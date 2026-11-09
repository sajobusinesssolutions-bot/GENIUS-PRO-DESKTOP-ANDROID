import { withFailover, PRIMARY, BACKUP, usingBackup, resetServerChoice } from '../serverFailover';

describe('api.saljoe.tech first, api.saljoetech.tech as the backup', () => {
  beforeEach(() => resetServerChoice());

  it('uses the main address while it answers', async () => {
    const seen: string[] = [];
    const f = withFailover((async (u: any) => { seen.push(u); return { ok: true, status: 200 }; }) as any);
    await f(PRIMARY + '/health');
    expect(seen).toEqual([PRIMARY + '/health']);
    expect(usingBackup()).toBe(false);
  });

  it('repeats the request on the backup when the main address cannot be reached, and stays there', async () => {
    const seen: string[] = [];
    const f = withFailover((async (u: any, init: any) => {
      seen.push(u + ' ' + (init?.method || 'GET'));
      if (u.startsWith(PRIMARY)) throw new TypeError('Network request failed');
      return { ok: true, status: 200 };
    }) as any);
    await f(PRIMARY + '/v1/sync/push', { method: 'POST', body: '{}' });
    expect(seen).toEqual([PRIMARY + '/v1/sync/push POST', BACKUP + '/v1/sync/push POST']);
    expect(usingBackup()).toBe(true);
    await f(PRIMARY + '/v1/sync/pull?since=4');
    expect(seen[2]).toBe(BACKUP + '/v1/sync/pull?since=4 GET');
  });

  it('passes on any answer from the server, an error included, without trying again', async () => {
    let calls = 0;
    const f = withFailover((async () => { calls++; return { ok: false, status: 500 }; }) as any);
    const r: any = await f(PRIMARY + '/v1/sync/push', { method: 'POST' });
    expect(r.status).toBe(500);
    expect(calls).toBe(1);
  });

  it('does not send again after a timeout: the request may have arrived', async () => {
    let calls = 0;
    const f = withFailover((async () => { calls++; const e: any = new Error('aborted'); e.name = 'AbortError'; throw e; }) as any);
    await expect(f(PRIMARY + '/v1/sync/push', { method: 'POST' })).rejects.toThrow('aborted');
    expect(calls).toBe(1);
    expect(usingBackup()).toBe(false);
  });

  it('leaves other addresses alone', async () => {
    const seen: string[] = [];
    const f = withFailover((async (u: any) => { seen.push(u); throw new TypeError('Network request failed'); }) as any);
    await expect(f('https://example.com/x')).rejects.toThrow();
    expect(seen).toEqual(['https://example.com/x']);
  });
});
