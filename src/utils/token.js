import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

const DEFAULT_REFRESH_DAYS = 7;

export function signAccessToken(user) {
    return jwt.sign(
        { sub: user.id, email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
    );
}

// Refresh token opaco: 64 bytes aleatorios en base64url (no es un JWT).
export function generateRefreshToken() {
    return crypto.randomBytes(64).toString('base64url');
}

// En la base de datos solo se guarda el hash SHA-256, nunca el token en claro.
export function hashRefreshToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

export function refreshTokenExpiresAt(now = new Date()) {
    const days = Number(process.env.REFRESH_TOKEN_EXPIRES_IN_DAYS || DEFAULT_REFRESH_DAYS);
    return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}
