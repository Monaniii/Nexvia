import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';

describe('GET /api/v1/health', () => {
  it('returns the API health response without a database connection', async () => {
    const response = await request(createApp()).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'ok',
      service: 'skillora-api',
    });
    expect(response.body.uptime).toEqual(expect.any(Number));
  });
});
