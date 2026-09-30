import request from 'supertest';
import app from '../../src/app.js';

// Validaciones de entrada: no llegan a la base de datos.
describe('Refresh token API (validación)', () => {
    test('POST /auth/refresh regresa 400 sin refreshToken', async () => {
        const response = await request(app).post('/auth/refresh').send({});

        expect(response.statusCode).toBe(400);
        expect(response.body).toEqual({ message: 'refreshToken es obligatorio' });
    });

    test('POST /auth/logout regresa 400 sin refreshToken', async () => {
        const response = await request(app).post('/auth/logout');

        expect(response.statusCode).toBe(400);
        expect(response.body).toEqual({ message: 'refreshToken es obligatorio' });
    });
});
