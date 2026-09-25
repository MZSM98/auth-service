import jwt from 'jsonwebtoken';
import pool from '../config/database.js';
import { hashPassword, comparePassword } from '../utils/password.js';

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

    const accessToken = jwt.sign(
        { sub: user.id, email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '1h' }
    );

    return { accessToken };
}
