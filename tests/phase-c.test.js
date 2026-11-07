import { describe, expect, it } from 'vitest';
import { safeCell } from '../server/routes/exports.js';

describe('spreadsheet export safety', () => {
  it.each(['=1+1','+254700000000','-1+2','@SUM(A1)','\tvalue','\rvalue'])('neutralizes formula-like values: %j', (value) => {
    expect(safeCell(value)).toBe(`'${value}`);
  });
  it('leaves ordinary cells unchanged', () => {
    expect(safeCell('Synthetic supporter')).toBe('Synthetic supporter');
    expect(safeCell(null)).toBe('');
  });
});
