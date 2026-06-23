import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { accountEnvelope, seriesDetail, seriesList } from './fixtures';

export const defaultHandlers = [
  http.get('/api/series', () => HttpResponse.json(seriesList)),
  http.get('/api/series/:id', () => HttpResponse.json(seriesDetail)),
  http.get('/api/series/:id/metrics', () => HttpResponse.json(accountEnvelope)),
];

export const server = setupServer(...defaultHandlers);
