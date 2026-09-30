import crypto from 'node:crypto';
import pool from '../config/database.js';
import { hashPassword, comparePassword } from '../utils/password.js';
import {
    signAccessToken,
    generateRefreshToken,
    hashRefreshToken,
    refreshTokenExpiresAt
} from '../utils/token.js';

export async function register({ email, password, name }) {
    const existing = await pool.query(
        'SELECT id FROM users WHERE email = $1',
        [email]
    );

    if (existing.rowCount > 0) {
        throw new Error('USER_ALREADY_EXISTS');
    }

    const passwordHash = await hashPassword(password);

    const result = await pool.query(
        `INSERT INTO users (email, password_hash, name)
         VALUES ($1, $2, $3)
         RETURNING id, email, name, created_at`,
        [email, passwordHash, name ?? null]
    );

    return result.rows[0];
}

export async function login({ email, password }) {
    const result = await pool.query(
        `SELECT id, email, password_hash
         FROM users
         WHERE email = $1`,
        [email]
    );

    if (result.rowCount === 0) {
        throw new Error('INVALID_CREDENTIALS');
    }

    const user = result.rows[0];
    const valid = await comparePassword(password, user.password_hash);

    if (!valid) {
        throw new Error('INVALID_CREDENTIALS');
    }

    const accessToken = signAccessToken(user);

    // Cada login inicia una nueva "familia" (sesión) de refresh tokens.
    const { token: refreshToken } = await insertRefreshToken(pool, {
        userId: user.id,
        familyId: crypto.randomUUID()
    });

    return { accessToken, refreshToken };
}

export async function refresh({ refreshToken }) {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // FOR UPDATE bloquea la fila: dos refresh simultáneos con el mismo token no pueden rotarlo dos veces.
        const result = await client.query(
            `SELECT rt.id, rt.user_id, rt.family_id, rt.expires_at, rt.revoked_at, rt.replaced_by, u.email
             FROM refresh_tokens rt
             JOIN users u ON u.id = rt.user_id
             WHERE rt.token_hash = $1
             FOR UPDATE OF rt`,
            [hashRefreshToken(refreshToken)]
        );

        if (result.rowCount === 0) {
            throw new Error('INVALID_REFRESH_TOKEN');
        }

        const stored = result.rows[0];

        if (stored.revoked_at && stored.replaced_by) {
            // Detección de reutilización: un token que ya fue rotado volvió a usarse.
            // Se revoca toda la familia (la sesión completa) por posible robo.
            await revokeFamily(client, stored.family_id);
            await client.query('COMMIT');
            throw new Error('REFRESH_TOKEN_REUSED');
        }

        if (stored.revoked_at || new Date(stored.expires_at) <= new Date()) {
            throw new Error('INVALID_REFRESH_TOKEN');
        }

        // Rotación: se emite un refresh token nuevo en la misma familia y se revoca el usado.
        const { id: newId, token: newRefreshToken } = await insertRefreshToken(client, {
            userId: stored.user_id,
            familyId: stored.family_id
        });

        await client.query(
            `UPDATE refresh_tokens
             SET revoked_at = NOW(), replaced_by = $2
             WHERE id = $1`,
            [stored.id, newId]
        );

        await client.query('COMMIT');

        const accessToken = signAccessToken({ id: stored.user_id, email: stored.email });

        return { accessToken, refreshToken: newRefreshToken };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

export async function logout({ refreshToken }) {
    // Cierra la sesión: revoca toda la familia del refresh token recibido.
    // Es idempotente: si el token no existe o ya estaba revocado no pasa nada.
    const result = await pool.query(
        'SELECT family_id FROM refresh_tokens WHERE token_hash = $1',
        [hashRefreshToken(refreshToken)]
    );

    if (result.rowCount > 0) {
        await revokeFamily(pool, result.rows[0].family_id);
    }
}

async function insertRefreshToken(db, { userId, familyId }) {
    const token = generateRefreshToken();

    const result = await db.query(
        `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [userId, hashRefreshToken(token), familyId, refreshTokenExpiresAt()]
    );

    return { id: result.rows[0].id, token };
}

async function revokeFamily(db, familyId) {
    await db.query(
        `UPDATE refresh_tokens
         SET revoked_at = NOW()
         WHERE family_id = $1 AND revoked_at IS NULL`,
        [familyId]
    );
}
