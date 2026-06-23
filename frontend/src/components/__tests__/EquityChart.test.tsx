import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EquityChart from '../EquityChart';

const points = [
  { ts: '2026-01-02T20:00:00Z', realized_pnl: '320.00', indexed_return: '0.0032' },
  { ts: '2026-01-03T20:00:00Z', realized_pnl: '540.00', indexed_return: '0.0054' },
];

describe('EquityChart', () => {
  it('renders in absolute mode', () => {
    render(<EquityChart points={points} baseCurrency="USD" mode="absolute" onModeChange={() => {}} />);
    expect(screen.getByText(/Cumulative PnL \(USD\)/i)).toBeInTheDocument();
  });

  it('renders in indexed mode', () => {
    render(<EquityChart points={points} baseCurrency="USD" mode="indexed" onModeChange={() => {}} />);
    expect(screen.getByText(/Cumulative Return/i)).toBeInTheDocument();
  });

  it('calls onModeChange when Indexed toggle pressed', async () => {
    const onModeChange = vi.fn();
    render(<EquityChart points={points} baseCurrency="USD" mode="absolute" onModeChange={onModeChange} />);
    await userEvent.click(screen.getByRole('button', { name: /indexed/i }));
    expect(onModeChange).toHaveBeenCalledWith('indexed');
  });
});
