# Auth Service

Microservicio didáctico de autenticación construido con:

- Node.js + Express
- ES Modules (`import` / `export`)
- PostgreSQL usando `pg`
- bcrypt
- JWT
- Jest + Supertest

## 1. Instalar

```bash
npm install
```

Copiar `.env.example` a `.env` y ejecutar `sql/init.sql` en PostgreSQL.

## 2. Ejecutar

```bash
npm run dev
```

Probar:

`GET http://localhost:3000/health`

## 3. Endpoints

### Registro
`POST /auth/register`

```json
{
  "name": "usuario",
  "email": "usuario@dominio.com",
  "password": "********"
}
```

### Login
`POST /auth/login`

```json
{
  "email": "usuario@dominio.com",
  "password": "********"
}
```

### Perfil autenticado
`GET /auth/me`

Header:

`Authorization: Bearer <token>`

### Refresh token
`POST /auth/refresh`

```json
{
  "refreshToken": "<refreshToken>"
}
```

Devuelve un `accessToken` y un `refreshToken` nuevos (el anterior queda revocado).

### Logout
`POST /auth/logout`

```json
{
  "refreshToken": "<refreshToken>"
}
```

Detalles del diseño y cómo probarlo en Windows: [REFRESH_TOKEN.md](REFRESH_TOKEN.md).

## 4. Pruebas

```bash
npm test
npm run test:db   # pruebas del refresh token contra PostgreSQL
```

`npm test` no requiere PostgreSQL: hay pruebas unitarias para bcrypt y pruebas de integración de Express/JWT con Supertest.
