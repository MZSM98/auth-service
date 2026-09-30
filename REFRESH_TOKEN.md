# Refresh Token en auth-service

Este documento explica el servicio de autenticación, cómo ejecutarlo en Windows y la implementación de **Refresh Token** (rama `feature/refresh-token`).

## 1. ¿Qué hace el servicio?

`auth-service` es un microservicio de autenticación hecho con:

| Pieza | Tecnología |
|---|---|
| Lenguaje / runtime | Node.js (ES Modules, `"type": "module"`) |
| Framework HTTP | Express 5 |
| Base de datos | PostgreSQL (driver `pg`, tabla `users`) |
| Contraseñas | `bcrypt` (10 salt rounds) |
| Tokens | JWT con `jsonwebtoken` (HS256, secreto `JWT_SECRET`) |
| Pruebas | Jest + Supertest |

Estructura:

```
src/
  server.js                    arranca Express (carga .env con dotenv)
  app.js                       rutas /health y /auth
  config/database.js           Pool de PostgreSQL (variables DB_*)
  routes/auth.routes.js        definición de endpoints
  controllers/auth.controller.js  validación de entrada y códigos HTTP
  services/auth.service.js     lógica: registro, login, refresh, logout
  middleware/auth.middleware.js   verifica el JWT del header Authorization
  utils/password.js            hash/compare con bcrypt
  utils/token.js               (nuevo) access token y refresh token
sql/init.sql                   tablas users y refresh_tokens
tests/                         pruebas unitarias y de integración
```

### Cómo funcionaba originalmente

- `POST /auth/register`: guarda el usuario con la contraseña hasheada con bcrypt (409 si el email ya existe).
- `POST /auth/login`: valida email/contraseña y devuelve **solo** un `accessToken` JWT con `{ sub, email }`, firmado con `JWT_SECRET` y con duración `JWT_EXPIRES_IN` (1h por defecto).
- `GET /auth/me`: protegido por el middleware; devuelve el payload del JWT.
- El JWT no se guarda en ningún lado (es *stateless*). **Problema:** si el token dura mucho y lo roban, sirve hasta que expire y no se puede revocar; si dura poco, el usuario tiene que volver a poner su contraseña a cada rato. Tampoco había logout real.

## 2. ¿Qué es un Refresh Token y por qué usarlo?

Se usan **dos tokens**:

| | Access token | Refresh token |
|---|---|---|
| Formato | JWT firmado | Cadena aleatoria opaca (64 bytes, base64url) |
| Duración | Corta (15 min por defecto) | Larga (7 días por defecto) |
| Se envía a | Cada endpoint protegido (`Authorization: Bearer`) | Solo a `/auth/refresh` y `/auth/logout` |
| Se guarda en el servidor | No | Sí, **solo su hash SHA-256** |
| Se puede revocar | No (expira solo) | Sí |

Cuando el access token expira, el cliente manda el refresh token a `/auth/refresh` y recibe un access token nuevo **sin volver a pedir la contraseña**. Así el access token puede durar poco (si lo roban, sirve pocos minutos) y la sesión se puede cerrar o revocar desde el servidor.

Buenas prácticas aplicadas (RFC 9700 *OAuth 2.0 Security Best Current Practice*, sección 4.14, y OWASP):

1. **Access token de vida corta** y refresh token de vida larga pero limitada.
2. **Refresh token guardado hasheado** en la BD: si se filtra la base de datos no se pueden usar los tokens.
3. **Rotación**: cada vez que se usa un refresh token se emite uno nuevo y el anterior queda revocado.
4. **Detección de reutilización**: si alguien presenta un refresh token que ya fue rotado, es señal de robo (dos partes tienen el mismo token) y se revoca **toda la sesión** (la "familia" de tokens).
5. **Logout** que revoca la sesión en el servidor.
6. **Transacción + `SELECT ... FOR UPDATE`** al rotar, para que dos peticiones simultáneas con el mismo token no generen dos tokens válidos.

## 3. Diseño implementado

Tabla nueva en `sql/init.sql`:

```sql
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash CHAR(64) UNIQUE NOT NULL,      -- SHA-256 del token, nunca el token
    family_id UUID NOT NULL,                  -- una familia = una sesión (un login)
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,                   -- NULL = vigente
    replaced_by INTEGER REFERENCES refresh_tokens(id) ON DELETE SET NULL, -- token que lo reemplazó al rotar
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
```

Flujo:

- **Login**: crea un `family_id` nuevo, genera el refresh token con `crypto.randomBytes(64)`, guarda su hash y devuelve `{ accessToken, refreshToken }`.
- **Refresh** (en una transacción):
  1. Busca el hash del token recibido (`FOR UPDATE`). Si no existe → 401.
  2. Si ya fue rotado (`revoked_at` y `replaced_by` con valor) → **reutilización**: revoca toda la familia → 401.
  3. Si está revocado (logout) o expirado → 401.
  4. Si es válido: crea un refresh token nuevo en la misma familia, marca el viejo como revocado con `replaced_by = nuevo`, y devuelve `{ accessToken, refreshToken }` nuevos.
- **Logout**: revoca toda la familia del refresh token recibido. Es idempotente (siempre responde 200 si se envía un token).

Configuración (`.env`):

| Variable | Descripción | Por defecto |
|---|---|---|
| `JWT_SECRET` | Secreto para firmar el access token | (obligatorio) |
| `JWT_EXPIRES_IN` | Vida del access token (`15m`, `1h`, `20s`...) | `15m` |
| `REFRESH_TOKEN_EXPIRES_IN_DAYS` | Vida del refresh token en días | `7` |

Archivos modificados/nuevos: `src/utils/token.js` (nuevo), `src/services/auth.service.js`, `src/controllers/auth.controller.js`, `src/routes/auth.routes.js`, `sql/init.sql`, `.env.example`, `package.json` (script `test:db`), pruebas en `tests/unit/token.test.js`, `tests/integration/refresh.test.js` y `tests/integration/refresh.db.test.js`.

## 4. Endpoints

| Método | Ruta | Body | Respuesta |
|---|---|---|---|
| GET | `/health` | – | 200 `{"status":"UP","service":"auth-service"}` |
| POST | `/auth/register` | `{name, email, password}` | 201 usuario / 409 ya existe / 400 |
| POST | `/auth/login` | `{email, password}` | 200 `{accessToken, refreshToken}` / 401 |
| GET | `/auth/me` | Header `Authorization: Bearer <accessToken>` | 200 `{user}` / 401 |
| POST | `/auth/refresh` | `{refreshToken}` | 200 `{accessToken, refreshToken}` / 401 / 400 |
| POST | `/auth/logout` | `{refreshToken}` | 200 `{"message":"Sesión cerrada correctamente"}` / 400 |

Ejemplos reales (obtenidos al probar el servicio, tokens recortados con `...`):

```http
POST /auth/login
{"email":"luis@test.com","password":"Secreta123"}

200 OK
{"accessToken":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...","refreshToken":"ZYshBPXzpXY9DXRYCUMhoNw4qd5C8H0J..."}
```

```http
POST /auth/refresh
{"refreshToken":"ZYshBPXzpXY9DXRYCUMhoNw4qd5C8H0J..."}

200 OK
{"accessToken":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...","refreshToken":"I0u7ZmZs6_U2uh6TIE_30prUSxki36-y..."}
```

Errores:

```json
{"message":"Refresh token reutilizado: la sesión fue revocada, inicia sesión de nuevo"}   // 401, token ya rotado
{"message":"Refresh token inválido, expirado o revocado"}                                 // 401
{"message":"refreshToken es obligatorio"}                                                 // 400
{"message":"Token inválido o expirado"}                                                   // 401 en /auth/me
```

## 5. Ejecutar en Windows

### Requisitos

- Git, Node.js 20 LTS o superior y PostgreSQL (nativo o en Docker).

En PowerShell (con `winget`):

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id PostgreSQL.PostgreSQL.17 -e   # pide contraseña para el usuario postgres
```

Cierra y vuelve a abrir PowerShell para que se actualice el PATH.

### Clonar e instalar

```powershell
git clone -b feature/refresh-token https://github.com/MZSM98/auth-service.git
cd auth-service
npm install
Copy-Item .env.example .env
notepad .env
```

Ejemplo de `.env`:

```
PORT=3000
DB_HOST=localhost
DB_PORT=5432
DB_USER=auth_user
DB_PASSWORD=auth_pass
DB_NAME=auth_db
JWT_SECRET=cambia-este-secreto-por-uno-largo
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_IN_DAYS=7
```

### Crear la base de datos

Opción A, PostgreSQL instalado en Windows (ajusta el `17` a tu versión):

```powershell
$psql = "C:\Program Files\PostgreSQL\17\bin\psql.exe"
& $psql -U postgres -c "CREATE USER auth_user WITH PASSWORD 'auth_pass';"
& $psql -U postgres -c "CREATE DATABASE auth_db OWNER auth_user;"
$env:PGPASSWORD = "auth_pass"
& $psql -h localhost -U auth_user -d auth_db -f sql\init.sql
```

Opción B, con Docker Desktop:

```powershell
docker run --name auth-pg -e POSTGRES_USER=auth_user -e POSTGRES_PASSWORD=auth_pass -e POSTGRES_DB=auth_db -p 5432:5432 -d postgres:17
Get-Content sql\init.sql | docker exec -i auth-pg psql -U auth_user -d auth_db
```

> Si ya tenías la tabla `users` de la versión original, vuelve a ejecutar `sql\init.sql`: usa `CREATE TABLE IF NOT EXISTS`, así que solo agrega `refresh_tokens`.

### Arrancar

```powershell
npm run dev        # o: npm start
```

Para probar la expiración rápido, arranca con un access token de 20 segundos:

```powershell
$env:JWT_EXPIRES_IN = "20s"; npm start
```

(Para quitarlo: `Remove-Item Env:JWT_EXPIRES_IN`.)

## 6. Cómo probarlo

### Con PowerShell (`Invoke-RestMethod`)

En otra ventana de PowerShell:

```powershell
$base = "http://localhost:3000"
Invoke-RestMethod "$base/health"

# Registro (solo la primera vez)
Invoke-RestMethod -Method Post "$base/auth/register" -ContentType "application/json" -Body '{"name":"Luis","email":"luis@test.com","password":"Secreta123"}'

# Login -> accessToken + refreshToken
$login = Invoke-RestMethod -Method Post "$base/auth/login" -ContentType "application/json" -Body '{"email":"luis@test.com","password":"Secreta123"}'
$login

# Endpoint protegido
Invoke-RestMethod "$base/auth/me" -Headers @{ Authorization = "Bearer $($login.accessToken)" }

# Esperar a que expire el access token (si arrancaste con JWT_EXPIRES_IN=20s)
Start-Sleep -Seconds 21
try { Invoke-RestMethod "$base/auth/me" -Headers @{ Authorization = "Bearer $($login.accessToken)" } } catch { $_.ErrorDetails.Message }

# Refresh -> nuevos tokens (rotación)
$nuevo = Invoke-RestMethod -Method Post "$base/auth/refresh" -ContentType "application/json" -Body (@{ refreshToken = $login.refreshToken } | ConvertTo-Json)
$nuevo
Invoke-RestMethod "$base/auth/me" -Headers @{ Authorization = "Bearer $($nuevo.accessToken)" }

# Reusar el refresh token viejo -> 401 y se revoca la sesión
try { Invoke-RestMethod -Method Post "$base/auth/refresh" -ContentType "application/json" -Body (@{ refreshToken = $login.refreshToken } | ConvertTo-Json) } catch { $_.ErrorDetails.Message }

# Logout con una sesión nueva
$login2 = Invoke-RestMethod -Method Post "$base/auth/login" -ContentType "application/json" -Body '{"email":"luis@test.com","password":"Secreta123"}'
Invoke-RestMethod -Method Post "$base/auth/logout" -ContentType "application/json" -Body (@{ refreshToken = $login2.refreshToken } | ConvertTo-Json)
try { Invoke-RestMethod -Method Post "$base/auth/refresh" -ContentType "application/json" -Body (@{ refreshToken = $login2.refreshToken } | ConvertTo-Json) } catch { $_.ErrorDetails.Message }
```

> En PowerShell usa `curl.exe` (no `curl`, que es un alias de `Invoke-WebRequest`) si prefieres curl.

### Pruebas automáticas

```powershell
npm test          # no necesita PostgreSQL (las pruebas de BD se omiten)
npm run test:db   # flujo completo contra PostgreSQL (usa el .env)
```

Resultado obtenido: `npm test` → 12 pruebas pasan y 6 se omiten; `npm run test:db` → 18 de 18 pasan.

## 7. Evidencias

Capturas de la salida real de terminal en [`docs/evidencias/`](docs/evidencias/):

| # | Archivo | Contenido |
|---|---|---|
| 01 | `01-servicio-original.png` | Servicio original arrancando y `/health` |
| 02 | `02-login-original.png` | Registro, login (solo access token) y `/auth/me` en la versión original |
| 03 | `03-tests-original.png` | `npm test` de la versión original (6/6) |
| 04 | `04-servicio-refresh-token.png` | Servicio con refresh token arrancando (access token de 20 s) |
| 05 | `05-login-access-y-refresh-token.png` | Login devuelve access + refresh token; en la BD solo está el hash |
| 06 | `06-endpoint-protegido-y-expiracion.png` | `/auth/me` con el access token y 401 cuando expira |
| 07 | `07-refresh.png` | `/auth/refresh` devuelve tokens nuevos y el nuevo access token funciona |
| 08 | `08-rotacion.png` | Rotación: el token anterior queda revocado con `replaced_by` |
| 09 | `09-refresh-viejo-rechazado.png` | Reutilización del token viejo → 401 y revocación de la sesión |
| 10 | `10-logout.png` | Logout y rechazo posterior del refresh token |
| 11 | `11-tests.png` | `npm test` |
| 12 | `12-tests-postgresql.png` | `npm run test:db` (18/18) |

## 8. Referencias

- RFC 9700, *Best Current Practice for OAuth 2.0 Security*, secciones 2.2.2 y 4.14 (Refresh Token Protection): https://www.rfc-editor.org/rfc/rfc9700.html
- RFC 6749, *The OAuth 2.0 Authorization Framework*, sección 1.5 (Refresh Token): https://www.rfc-editor.org/rfc/rfc6749#section-1.5
- OWASP JSON Web Token Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html
