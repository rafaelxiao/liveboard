import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import FxRatesPanel from '../FxRatesPanel';

const rates = [{ ccy_from: 'EUR', ccy_to: 'USD', latest_rate: '1.08', points: 12 }];
const ingestion = { last_batch_at: '2026-06-18T14:02:00Z', rejected: 0, fills_missing_fx: 2 };

describe('FxRatesPanel', () => {
  it('lists rates with point counts', () => {
    render(<FxRatesPanel rates={rates as any} missingCount={0} ingestion={{ ...ingestion, fills_missing_fx: 0 }} />);
    expect(screen.getByText(/EUR/)).toBeInTheDocument();
    expect(screen.getByText(/1\.08/)).toBeInTheDocument();
    expect(screen.getByText(/12 points/)).toBeInTheDocument();
    expect(screen.queryByText(/missing fx/i)).not.toBeInTheDocument();
  });

  it('surfaces an fx_missing gap when missingCount > 0', () => {
    render(<FxRatesPanel rates={rates as any} missingCount={2} ingestion={ingestion as any} />);
    expect(screen.getByText(/2 fills missing fx/i)).toBeInTheDocument();
  });
});
