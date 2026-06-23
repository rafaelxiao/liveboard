import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import MetricCard from '../MetricCard';
// Need to mock the PnL store
vi.mock('../../state/pnlStore', () => ({
  usePnlStore: (selector: (s: any) => any) => selector({ scheme: 'red-up' }),
}));

describe('MetricCard', () => {
  it('formats a PnL value in base currency with gain glyph', () => {
    render(<MetricCard label="Net PnL" value="48210.00" unit="USD" baseCurrency="USD" isPnl />);
    expect(screen.getByText(/\$48,210\.00/)).toBeInTheDocument();
    expect(screen.getByText('▲')).toBeInTheDocument();
  });

  it('uses loss glyph for negative PnL', () => {
    render(<MetricCard label="Max DD" value="-9100.00" unit="USD" baseCurrency="USD" isPnl />);
    expect(screen.getByText('▼')).toBeInTheDocument();
  });

  it('shows em dash when suppressed', () => {
    render(<MetricCard label="Sharpe" value={null} unit="ratio" baseCurrency="USD" suppressed />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows low-sample footnote', () => {
    render(<MetricCard label="Sharpe" value="1.10" unit="ratio" baseCurrency="USD" lowSample />);
    expect(screen.getByText(/low sample/i)).toBeInTheDocument();
  });

  it('formats seconds as h/m', () => {
    render(<MetricCard label="Avg hold" value="11520" unit="seconds" baseCurrency="USD" />);
    expect(screen.getByText('3h 12m')).toBeInTheDocument();
  });
});
