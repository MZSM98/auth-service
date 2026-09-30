import jwt from 'jsonwebtoken';
import {
    signAccessToken,
    generateRefreshToken,
    hashRefreshToken,
    refreshTokenExpiresAt
} from '../../src/utils/token.js';

describe('Token Utils', () => {
    beforeAll(() => {
        process.env.JWT_SECRET = 'test-secret';
    });

    test('signAccessToken genera un JWT con sub y email', () => {
        const token = signAccessToken({ id: 7, email: 'a@test.com' });
        const payload = jwt.verify(token, process.env.JWT_SECRET);

        expect(payload.sub).toBe(7);
        expect(payload.email).toBe('a@test.com');
        expect(payload.exp).toBeGreaterThan(payload.iat);
    });

    test('generateRefreshToken genera tokens aleatorios y distintos', () => {
        const a = generateRefreshToken();
        const b = generateRefreshToken();

        expect(a).not.toBe(b);
        expect(a.length).toBeGreaterThanOrEqual(80);
    });

    test('hashRefreshToken es SHA-256 determinista y no revela el token', () => {
        const token = generateRefreshToken();
        const hash = hashRefreshToken(token);

        expect(hash).toMatch(/^[a-f0-9]{64}$/);
        expect(hashRefreshToken(token)).toBe(hash);
        expect(hash).not.toContain(token);
    });

    test('refreshTokenExpiresAt usa REFRESH_TOKEN_EXPIRES_IN_DAYS', () => {
        process.env.REFRESH_TOKEN_EXPIRES_IN_DAYS = '2';
        const now = new Date('2026-01-01T00:00:00Z');

        expect(refreshTokenExpiresAt(now).toISOString()).toBe('2026-01-03T00:00:00.000Z');
        delete process.env.REFRESH_TOKEN_EXPIRES_IN_DAYS;
    });
});
