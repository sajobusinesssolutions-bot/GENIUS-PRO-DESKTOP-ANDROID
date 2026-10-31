import { fmtSigned, fmtParen, drCr, runningBalances, pctOf } from '../statementDetail';

describe('detailed statement helpers', () => {
  it('signs: a minus on the balance sheet, parentheses on profit and loss', () => {
    expect(fmtSigned(26500)).toBe('26,500');
    expect(fmtSigned(-17000)).toBe('-17,000');
    expect(fmtSigned(0)).toBe('0');
    expect(fmtParen(-2000)).toBe('(2,000)');
    expect(fmtParen(51640048000)).toBe('51,640,048,000');
  });

  it('a balance carries its side', () => {
    expect(drCr(26500)).toBe('26,500 Dr');
    expect(drCr(-1200)).toBe('1,200 Cr');
    expect(drCr(0.001)).toBe('0');
  });

  it('the running balance starts from the opening and follows each entry', () => {
    expect(runningBalances(1000, [{ debit: 500, credit: 0 }, { debit: 0, credit: 2000 }, { debit: 100, credit: 0 }])).toEqual([1500, -500, -400]);
    expect(runningBalances(0, [])).toEqual([]);
  });

  it('a share of the total, to one decimal', () => {
    expect(pctOf(1, 3)).toBe(33.3);
    expect(pctOf(50, 200)).toBe(25);
    expect(pctOf(5, 0)).toBe(0);
  });
});
