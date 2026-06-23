import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CompareTray from '../CompareTray';
import { useCompareTray } from '../../state/compareTrayStore';

const usd1 = { id: 1, name: 'Alpha-Real', tag: 'real', base_currency: 'USD', created_at: 'x' };
const usd2 = { id: 2, name: 'Alpha-Sim', tag: 'sim', base_currency: 'USD', created_at: 'x' };
const eur3 = { id: 3, name: 'Euro-Book', tag: 'real', base_currency: 'EUR', created_at: 'x' };

describe('CompareTray', () => {
  it('shows staged series and a Compare link deep-linking to /compare', () => {
    useCompareTray.setState({ ids: [1, 2] });
    render(<MemoryRouter><CompareTray series={[usd1, usd2] as any} /></MemoryRouter>);
    expect(screen.getByText('Alpha-Real')).toBeInTheDocument();
    expect(screen.getByText('Alpha-Sim')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /compare/i }))
      .toHaveAttribute('href', expect.stringContaining('/compare?series=1,2'));
    useCompareTray.setState({ ids: [] });
  });

  it('flags a base_currency mismatch and does not offer a diff for the odd series', () => {
    useCompareTray.setState({ ids: [1, 3] });
    render(<MemoryRouter><CompareTray series={[usd1, eur3] as any} /></MemoryRouter>);
    expect(screen.getByText(/currency mismatch/i)).toBeInTheDocument();
    useCompareTray.setState({ ids: [] });
  });
});
