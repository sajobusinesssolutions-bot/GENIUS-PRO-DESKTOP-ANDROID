import { markServerOk, changeNeedsServer, resetServerContact } from '../serverContact';

describe('an edit or delete on synced books needs the server', () => {
  beforeEach(() => resetServerContact());
  const synced = { sync: { on: true, businessId: 'b1' } };

  it('is refused when the server has not answered lately, with a reason to try again', () => {
    const r = changeNeedsServer(synced, 'a sale');
    expect(r?.title).toMatch(/Not saved/);
    expect(r?.why).toMatch(/try again/);
  });

  it('goes ahead when the server answered in the last 25 seconds', () => {
    markServerOk(1000);
    expect(changeNeedsServer(synced, 'a sale', 1000 + 20 * 1000)).toBeNull();
    expect(changeNeedsServer(synced, 'a sale', 1000 + 30 * 1000)).not.toBeNull();
  });

  it('never stands in the way of a phone that does not sync', () => {
    expect(changeNeedsServer({ sync: { on: false } }, 'a sale')).toBeNull();
    expect(changeNeedsServer({ sync: { on: true, businessId: null } }, 'a sale')).toBeNull();
  });
});
