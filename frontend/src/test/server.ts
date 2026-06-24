import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { accountEnvelope, seriesDetail, seriesList } from './fixtures';

export const defaultHandlers = [
  http.get('/liveboard/api/v1/series', () => HttpResponse.json(seriesList)),
  http.get('/liveboard/api/v1/series/:id', () => HttpResponse.json(seriesDetail)),
  http.get('/liveboard/api/v1/series/:id/metrics', () => HttpResponse.json(accountEnvelope)),
];

export const server = setupServer(...defaultHandlers);
