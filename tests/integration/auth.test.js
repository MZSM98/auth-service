import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../src/app.js';

describe('Auth API', () => {
    beforeAll(() => {
        process.env.JWT_SECRET = 'test-secret';
    });

    test('GET /auth/me regresa 401 sin token', async () => {
        const response = await request(app).get('/auth/me');

        expect(response.statusCode).toBe(401);
        expect(response.body).toEqual({ message: 'Token requerido' });
    });

    test('GET /auth/me acepta un JWT válido', async () => {
        const token = jwt.sign(
            { sub: 1, email: 'test@test.com' },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        const response = await request(app)
            .get('/auth/me')
            .set('Authorization', `Bearer ${token}`);

        expect(response.statusCode).toBe(200);
        expect(response.body.user.sub).toBe(1);
        expect(response.body.user.email).toBe('test@test.com');
    });
});
