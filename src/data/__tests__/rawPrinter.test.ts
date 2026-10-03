import { notAPrinter, testPage, toBase64 } from '../rawPrinter';

describe('telling a printer from other Bluetooth devices', () => {
  const d = (majorClass?: number, deviceClass?: number) => ({ name: 'X', address: 'A', paired: true, majorClass, deviceClass });

  it('lets a printer through, and a device that says nothing about itself', () => {
    expect(notAPrinter(d(0x0600, 0x0680))).toBeNull();
    expect(notAPrinter(d(0x1f00, 0x1f00))).toBeNull();
    expect(notAPrinter(d())).toBeNull();
  });

  it('refuses phones, headphones, computers and cameras', () => {
    expect(notAPrinter(d(0x0200, 0x020c))).toMatch(/phone/);
    expect(notAPrinter(d(0x0400, 0x0418))).toMatch(/audio/);
    expect(notAPrinter(d(0x0100, 0x010c))).toMatch(/computer/);
    expect(notAPrinter(d(0x0600, 0x0620))).toMatch(/camera/);
  });
});

describe('the test page', () => {
  it('starts with a printer reset and ends with a cut', () => {
    const p = testPage('Corner Shop', 'MTP-II', '58mm');
    expect([...p.slice(0, 2)]).toEqual([0x1b, 0x40]);
    expect([...p.slice(-4)]).toEqual([0x1d, 0x56, 0x42, 0x00]);
    expect(String.fromCharCode(...p)).toContain('TEST PRINT');
  });

  it('is sent as base64 that decodes back to the same bytes', () => {
    for (const n of [0, 1, 2, 3, 7]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 97) & 255);
      expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    }
  });
});
