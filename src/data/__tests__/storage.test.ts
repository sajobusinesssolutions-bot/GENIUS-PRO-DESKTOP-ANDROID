import AsyncStorage from '@react-native-async-storage/async-storage';
import { scheduleSave, flushSave, saveIsPending, validateBackup } from '../storage';

jest.mock('@react-native-async-storage/async-storage', () => {
  const store: Record<string, string> = {};
  const calls: string[] = [];
  return {
    __esModule: true,
    default: {
      setItem: jest.fn(async (k: string, v: string) => {
        calls.push(v);
        // a real write takes a moment; this is where two in flight would race
        await new Promise((r) => setTimeout(r, 5));
        store[k] = v;
      }),
      getItem: jest.fn(async (k: string) => store[k] ?? null),
      removeItem: jest.fn(async (k: string) => { delete store[k]; }),
      __calls: calls,
    },
  };
});

const AS = AsyncStorage as unknown as {
  setItem: jest.Mock; getItem: (k: string) => Promise<string | null>; __calls: string[];
};

function book(n: number): any {
  return { version: n, products: [], sales: [] };
}

beforeEach(() => {
  AS.setItem.mockClear();
  AS.__calls.length = 0;
});

describe('scheduleSave', () => {
  it('folds a burst of commits into a single write', async () => {
    for (let i = 1; i <= 20; i += 1) scheduleSave(book(i));
    await flushSave();
    expect(AS.setItem).toHaveBeenCalledTimes(1);
  });

  it('writes the latest book, not the first one asked for', async () => {
    scheduleSave(book(1));
    scheduleSave(book(2));
    scheduleSave(book(3));
    await flushSave();
    expect(JSON.parse(AS.__calls[AS.__calls.length - 1]).version).toBe(3);
  });

  it('never leaves the newest change unwritten when one is asked for mid-write', async () => {
    scheduleSave(book(1));
    const running = flushSave();
    // this arrives while the first write is still in flight
    scheduleSave(book(2));
    await running;
    await flushSave();
    expect(JSON.parse(AS.__calls[AS.__calls.length - 1]).version).toBe(2);
  });

  it('reports nothing outstanding once it has flushed', async () => {
    scheduleSave(book(9));
    expect(saveIsPending()).toBe(true);
    await flushSave();
    expect(saveIsPending()).toBe(false);
  });

  it('flushing with nothing queued writes nothing', async () => {
    await flushSave();
    expect(AS.setItem).not.toHaveBeenCalled();
  });
});

describe('validateBackup', () => {
  it('accepts a complete book and migrates added fields', () => {
    const result = validateBackup(JSON.stringify({ v: 1, firm: { id: 'f' }, products: [], sales: [], journal: [] }));
    expect(result.ok).toBe(true);
    expect(result.db?.archivedFinancialYears).toEqual([]);
  });

  it('rejects damaged or incomplete files', () => {
    expect(validateBackup('{bad json').ok).toBe(false);
    expect(validateBackup(JSON.stringify({ v: 1, products: [] })).reason).toMatch(/complete/);
  });
});
