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

Copiar `.env` a `.env`.

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

## 4. Pruebas

```bash
npm test
```

Las pruebas incluidas no requieren PostgreSQL: hay pruebas unitarias para bcrypt y pruebas de integración de Express/JWT con Supertest.
