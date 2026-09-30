import 'dotenv/config';
import request from 'supertest';
import app from '../../src/app.js';
import pool from '../../src/config/database.js';

// Flujo completo contra PostgreSQL real. Se ejecuta solo con: npm run test:db
const describeDb = process.env.DB_TESTS === 'true' ? describe : describe.skip;

describeDb('Refresh token API (PostgreSQL)', () => {
    const email = `refresh-${Date.now()}@test.com`;
    const password = 'Secreta123';

    beforeAll(async () => {
        await request(app).post('/auth/register').send({ email, password, name: 'Test' });
    });

    afterAll(async () => {
        await pool.query('DELETE FROM users WHERE email = $1', [email]);
        await pool.end();
    });

    async function login() {
        const response = await request(app).post('/auth/login').send({ email, password });
        expect(response.statusCode).toBe(200);
        return response.body;
    }

    test('login regresa accessToken y refreshToken', async () => {
        const body = await login();

        expect(body.accessToken).toBeDefined();
        expect(body.refreshToken).toBeDefined();
    });

    test('el refresh token se guarda hasheado, no en claro', async () => {
        const { refreshToken } = await login();
        const result = await pool.query(
            'SELECT COUNT(*)::int AS n FROM refresh_tokens WHERE token_hash = $1',
            [refreshToken]
        );

        expect(result.rows[0].n).toBe(0);
    });

    test('refresh rota el token y el nuevo access token funciona', async () => {
        const first = await login();

        const refreshed = await request(app)
            .post('/auth/refresh')
            .send({ refreshToken: first.refreshToken });

        expect(refreshed.statusCode).toBe(200);
        expect(refreshed.body.refreshToken).not.toBe(first.refreshToken);

        const me = await request(app)
            .get('/auth/me')
            .set('Authorization', `Bearer ${refreshed.body.accessToken}`);

        expect(me.statusCode).toBe(200);
        expect(me.body.user.email).toBe(email);
    });

    test('reutilizar un refresh token rotado revoca toda la sesión', async () => {
        const first = await login();
        const second = await request(app)
            .post('/auth/refresh')
            .send({ refreshToken: first.refreshToken });

        const reuse = await request(app)
            .post('/auth/refresh')
            .send({ refreshToken: first.refreshToken });

        expect(reuse.statusCode).toBe(401);

        // El token "bueno" de la misma familia también quedó revocado.
        const afterReuse = await request(app)
            .post('/auth/refresh')
            .send({ refreshToken: second.body.refreshToken });

        expect(afterReuse.statusCode).toBe(401);
    });

    test('logout revoca el refresh token', async () => {
        const { refreshToken } = await login();

        const out = await request(app).post('/auth/logout').send({ refreshToken });
        expect(out.statusCode).toBe(200);

        const after = await request(app).post('/auth/refresh').send({ refreshToken });
        expect(after.statusCode).toBe(401);
    });

    test('un refresh token desconocido es rechazado', async () => {
        const response = await request(app)
            .post('/auth/refresh')
            .send({ refreshToken: 'no-existe' });

        expect(response.statusCode).toBe(401);
    });
});
