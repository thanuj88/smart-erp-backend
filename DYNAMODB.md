# DynamoDB Local (persistent)

## Why data disappeared

DynamoDB Local only keeps data if you use **`-dbPath`** pointing at a folder on disk. In-memory or container-only setups lose everything when you stop the process.

The API re-seeds **superadmin** (and demo store users when `admin` is missing) on startup, which is why you could still log in as superadmin after a reset.

---

## Option A — No Docker (recommended on your machine)

You need **Java** (JDK 8+). Check: `java -version`

From the `backend` folder, in **one terminal**:

```powershell
npm run dynamo:up
```

Leave that window open. Data is stored in `backend/dynamodb-data/`.

In **another terminal**:

```powershell
npm run start
# or: npm run dev
```

Stop DynamoDB with **Ctrl+C** in the first terminal.

First run downloads the DynamoDB Local JAR automatically (one-time).

---

## Option B — Docker (if installed)

`docker` must work in PowerShell. If you see *"docker is not recognized"*, install [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/), restart the PC, then:

```powershell
npm run dynamo:up:docker
```

Data folder: `backend/dynamodb-data/` (same as Option A if you use the compose volume).

---

## Environment (`.env`)

```
DYNAMODB_ENDPOINT=http://localhost:8000
DYNAMODB_TABLE=PosBright
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=local
AWS_SECRET_ACCESS_KEY=local
```

## Seed / re-seed demo accounts

```powershell
npm run seed-dynamo
```

Also runs automatically when the API starts (missing items only).

### Default logins (after fresh seed)

| Role | Email | Password | Notes |
|------|-------|----------|--------|
| Super Admin | `superadmin@platform.local` | `superadmin123` | Platform |
| Tenant Admin | `admin@brightmart.local` | `admin123` | Bright Mart store |
| Teller | `teller@brightmart.local` | `teller123` | PIN: `1234` |
| Manager | `manager@brightmart.local` | `manager123` | |
| Accountant | `accountant@brightmart.local` | `accountant123` | |

Sign in with **email**. Staff usernames are generated internally from the email and store slug.

## Wipe and start over

1. Stop DynamoDB (`Ctrl+C` or `npm run dynamo:down:docker`).
2. Delete data:

```powershell
Remove-Item -Recurse -Force .\dynamodb-data
```

3. Start DynamoDB again (`npm run dynamo:up`).
4. `npm run seed-dynamo`
