import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import InstrumentReviewPanel from '../InstrumentReviewPanel';

const instruments = [
  { symbol: 'ES', asset_class: 'future', multiplier: '50', currency: 'USD', inferred: false },
  { symbol: 'NEW-X', asset_class: 'equity', multiplier: '1', currency: 'USD', inferred: true },
];

describe('InstrumentReviewPanel', () => {
  it('renders multiplier and asset class from the response (not computed)', () => {
    render(<InstrumentReviewPanel instruments={instruments as any} />);
    const es = screen.getByText('ES').closest('tr')!;
    expect(es).toHaveTextContent('future');
    expect(es).toHaveTextContent('50');
  });

  it('highlights inferred instruments for review and not confirmed ones', () => {
    render(<InstrumentReviewPanel instruments={instruments as any} />);
    const newx = screen.getByText('NEW-X').closest('tr')!;
    expect(within(newx).getByText(/inferred/i)).toBeInTheDocument();
    const es = screen.getByText('ES').closest('tr')!;
    expect(within(es).queryByText(/inferred/i)).not.toBeInTheDocument();
  });
});
