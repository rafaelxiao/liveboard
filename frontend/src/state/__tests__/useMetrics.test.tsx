import { describe, expect, it } from 'vitest';
import { paramsToSearch, searchToParams } from '../../lib/dashboardParams';

describe('useMetrics', () => {
  it('round-trips dashboard params through the URL', () => {
    const p = {
      series: 1, level: 'symbol' as const, strategy: 'momo-eth', symbol: 'ETH-USD',
      from: '2026-01-01', to: '2026-06-18',
    };
    expect(searchToParams(paramsToSearch(p))).toEqual(p);
  });
});
