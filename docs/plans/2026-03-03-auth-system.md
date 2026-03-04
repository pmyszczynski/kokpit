# Authentication System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement a complete username/password authentication system with bcrypt, JWT sessions, route protection, first-run setup wizard, and TOTP scaffolding.

**Architecture:** Users stored in SQLite (`data/users.db`) via `better-sqlite3`. Sessions are stateless JWTs (signed with `KOKPIT_SESSION_SECRET` env var) stored in an httpOnly cookie. Route protection implemented in a Next.js App Router `(protected)` layout (avoids Edge runtime limitations). No Edge middleware needed.

**Tech Stack:** `better-sqlite3` (user storage), `bcryptjs` (password hashing), `jose` (JWT sign/verify, Node.js-compatible)

---

## Pre-flight Notes

- Auth unit tests MUST include `// @vitest-environment node` at the top (better-sqlite3 is a native addon, incompatible with jsdom)
- SQLite tests use `:memory:` DB by setting `process.env.KOKPIT_DB_PATH = ':memory:'` at top of test file
- JWT tests set `process.env.KOKPIT_SESSION_SECRET = 'test-secret-32-chars-minimum-length-xx'`
- All new files go in `src/auth/` or `src/app/` per the project structure
- Save plan copy to: `docs/plans/2026-03-03-auth-system.md`

---

### Task 1: Install dependencies

**Files:**
- Modify: `package.json` (via npm install)

**Step 1: Install runtime dependencies**

```
npm install better-sqlite3 bcryptjs jose
```

**Step 2: Install dev dependencies**

```
npm install --save-dev @types/better-sqlite3 @types/bcryptjs
```

**Step 3: Verify type-check still passes**

```
npm run type-check
```
Expected: no errors

**Step 4: Commit**

```
git add package.json package-lock.json
git commit -m "chore: add better-sqlite3, bcryptjs, jose for auth system"
```

---

### Task 2: SQLite database module

**Files:**
- Create: `src/auth/db.ts`
- Create: `src/__tests__/auth/db.test.ts`

**Step 1: Write the failing test**

Create `src/__tests__/auth/db.test.ts`:

```typescript
// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

process.env.KOKPIT_DB_PATH = ":memory:";

describe("getDb()", () => {
  it("creates the users table on first call", async () => {
    vi.resetModules();
    const { getDb } = await import("../../auth/db");
    const db = getDb();
    const table = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
      )
      .get();
    expect(table).toBeTruthy();
  });

  it("returns the same instance on subsequent calls", async () => {
    vi.resetModules();
    const { getDb } = await import("../../auth/db");
    expect(getDb()).toBe(getDb());
  });
});
```

**Step 2: Run test to verify it fails**

```
npm test -- src/__tests__/auth/db.test.ts
```
Expected: FAIL (module not found)

**Step 3: Implement `src/auth/db.ts`**

```typescript
import Database from "better-sqlite3";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const path = process.env.KOKPIT_DB_PATH ?? "data/users.db";
  db = new Database(path);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      totp_secret TEXT,
      created_at INTEGER NOT NULL
    )
  `);

  return db;
}

export function closeDb(): void {
  db?.close();
  db = null;
}
```

**Step 4: Run test to verify it passes**

```
npm test -- src/__tests__/auth/db.test.ts
```
Expected: PASS (2 tests)

**Step 5: Commit**

```
git add src/auth/db.ts src/__tests__/auth/db.test.ts
git commit -m "feat: add SQLite database module with users table schema"
```

---

### Task 3: Password utilities

**Files:**
- Create: `src/auth/passwords.ts`
- Create: `src/__tests__/auth/passwords.test.ts`

**Step 1: Write the failing test**

Create `src/__tests__/auth/passwords.test.ts`:

```typescript
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../../auth/passwords";

describe("hashPassword()", () => {
  it("returns a bcrypt hash string", async () => {
    const hash = await hashPassword("mypassword");
    expect(hash).toMatch(/^\$2b\$10\$/);
  });

  it("produces different hashes for the same password", async () => {
    const h1 = await hashPassword("same");
    const h2 = await hashPassword("same");
    expect(h1).not.toBe(h2);
  });
});

describe("verifyPassword()", () => {
  it("returns true when password matches hash", async () => {
    const hash = await hashPassword("correct");
    expect(await verifyPassword("correct", hash)).toBe(true);
  });

  it("returns false when password does not match hash", async () => {
    const hash = await hashPassword("correct");
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

```
npm test -- src/__tests__/auth/passwords.test.ts
```
Expected: FAIL (module not found)

**Step 3: Implement `src/auth/passwords.ts`**

```typescript
import bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(
  plain: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
```

**Step 4: Run test to verify it passes**

```
npm test -- src/__tests__/auth/passwords.test.ts
```
Expected: PASS (4 tests)

**Step 5: Commit**

```
git add src/auth/passwords.ts src/__tests__/auth/passwords.test.ts
git commit -m "feat: add bcrypt password hashing utilities"
```

---

### Task 4: User management

**Files:**
- Create: `src/auth/users.ts`
- Create: `src/__tests__/auth/users.test.ts`

**Step 1: Write the failing test**

Create `src/__tests__/auth/users.test.ts`:

```typescript
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.KOKPIT_DB_PATH = ":memory:";

describe("user management", () => {
  beforeEach(() => vi.resetModules());

  it("createUser creates a user and returns it", async () => {
    const { createUser } = await import("../../auth/users");
    const user = await createUser("admin", "hash123");
    expect(user.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(user.username).toBe("admin");
    expect(user.passwordHash).toBe("hash123");
    expect(user.createdAt).toBeInstanceOf(Date);
  });

  it("getUserByUsername returns the user when found", async () => {
    const { createUser, getUserByUsername } = await import("../../auth/users");
    await createUser("bob", "hashbob");
    const found = getUserByUsername("bob");
    expect(found?.username).toBe("bob");
  });

  it("getUserByUsername returns null when not found", async () => {
    const { getUserByUsername } = await import("../../auth/users");
    expect(getUserByUsername("nobody")).toBeNull();
  });

  it("getUserById returns user when found", async () => {
    const { createUser, getUserById } = await import("../../auth/users");
    const created = await createUser("alice", "hashalice");
    const found = getUserById(created.id);
    expect(found?.username).toBe("alice");
  });

  it("countUsers returns 0 on empty DB", async () => {
    const { countUsers } = await import("../../auth/users");
    expect(countUsers()).toBe(0);
  });

  it("countUsers returns correct count after inserts", async () => {
    const { createUser, countUsers } = await import("../../auth/users");
    await createUser("u1", "h1");
    await createUser("u2", "h2");
    expect(countUsers()).toBe(2);
  });

  it("createUser throws on duplicate username", async () => {
    const { createUser } = await import("../../auth/users");
    await createUser("dup", "h");
    await expect(createUser("dup", "h2")).rejects.toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

```
npm test -- src/__tests__/auth/users.test.ts
```
Expected: FAIL (module not found)

**Step 3: Implement `src/auth/users.ts`**

```typescript
import { getDb } from "./db";

export type User = {
  id: string;
  username: string;
  passwordHash: string;
  totpSecret: string | null;
  createdAt: Date;
};

type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  totp_secret: string | null;
  created_at: number;
};

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    totpSecret: row.totp_secret,
    createdAt: new Date(row.created_at),
  };
}

export async function createUser(
  username: string,
  passwordHash: string
): Promise<User> {
  const db = getDb();
  const id = crypto.randomUUID();
  const createdAt = Date.now();
  db.prepare(
    "INSERT INTO users (id, username, password_hash, totp_secret, created_at) VALUES (?, ?, ?, NULL, ?)"
  ).run(id, username, passwordHash, createdAt);
  return {
    id,
    username,
    passwordHash,
    totpSecret: null,
    createdAt: new Date(createdAt),
  };
}

export function getUserByUsername(username: string): User | null {
  const row = getDb()
    .prepare("SELECT * FROM users WHERE username = ?")
    .get(username) as UserRow | undefined;
  return row ? rowToUser(row) : null;
}

export function getUserById(id: string): User | null {
  const row = getDb()
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(id) as UserRow | undefined;
  return row ? rowToUser(row) : null;
}

export function countUsers(): number {
  const result = getDb()
    .prepare("SELECT COUNT(*) as count FROM users")
    .get() as { count: number };
  return result.count;
}
```

**Step 4: Run test to verify it passes**

```
npm test -- src/__tests__/auth/users.test.ts
```
Expected: PASS (7 tests)

**Step 5: Commit**

```
git add src/auth/users.ts src/__tests__/auth/users.test.ts
git commit -m "feat: add user CRUD operations over SQLite"
```

---

### Task 5: JWT utilities

**Files:**
- Create: `src/auth/jwt.ts`
- Create: `src/__tests__/auth/jwt.test.ts`

**Step 1: Write the failing test**

Create `src/__tests__/auth/jwt.test.ts`:

```typescript
// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.KOKPIT_SESSION_SECRET =
    "test-secret-32-chars-minimum-length-xx";
});

describe("signJWT()", () => {
  it("returns a JWT string (3 dot-separated parts)", async () => {
    const { signJWT } = await import("../../auth/jwt");
    const token = await signJWT("user-123", 24);
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3);
  });
});

describe("verifyJWT()", () => {
  it("returns userId for a valid token", async () => {
    const { signJWT, verifyJWT } = await import("../../auth/jwt");
    const token = await signJWT("user-abc", 24);
    const payload = await verifyJWT(token);
    expect(payload?.userId).toBe("user-abc");
  });

  it("returns null for a tampered token", async () => {
    const { signJWT, verifyJWT } = await import("../../auth/jwt");
    const token = await signJWT("user-xyz", 24);
    const tampered = token.slice(0, -5) + "XXXXX";
    expect(await verifyJWT(tampered)).toBeNull();
  });

  it("returns null for a random string", async () => {
    const { verifyJWT } = await import("../../auth/jwt");
    expect(await verifyJWT("not.a.token")).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

```
npm test -- src/__tests__/auth/jwt.test.ts
```
Expected: FAIL (module not found)

**Step 3: Implement `src/auth/jwt.ts`**

```typescript
import { SignJWT, jwtVerify } from "jose";

function getSecret(): Uint8Array {
  const secret = process.env.KOKPIT_SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "KOKPIT_SESSION_SECRET env var is required. Set it in docker-compose.yml or .env.local."
    );
  }
  return new TextEncoder().encode(secret);
}

export async function signJWT(
  userId: string,
  ttlHours: number
): Promise<string> {
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(expiresAt)
    .setIssuedAt()
    .sign(getSecret());
}

export async function verifyJWT(
  token: string
): Promise<{ userId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (typeof payload.userId !== "string") return null;
    return { userId: payload.userId };
  } catch {
    return null;
  }
}
```

**Step 4: Run test to verify it passes**

```
npm test -- src/__tests__/auth/jwt.test.ts
```
Expected: PASS (4 tests)

**Step 5: Commit**

```
git add src/auth/jwt.ts src/__tests__/auth/jwt.test.ts
git commit -m "feat: add JWT sign/verify utilities using jose"
```

---

### Task 6: Session helper

**Files:**
- Create: `src/auth/session.ts`
- Create: `src/__tests__/auth/session.test.ts`

**Step 1: Write the failing test**

Create `src/__tests__/auth/session.test.ts`:

```typescript
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.KOKPIT_DB_PATH = ":memory:";
process.env.KOKPIT_SESSION_SECRET = "test-secret-32-chars-minimum-length-xx";

describe("getAuthUser()", () => {
  beforeEach(() => vi.resetModules());

  it("returns null when token is undefined", async () => {
    const { getAuthUser } = await import("../../auth/session");
    expect(await getAuthUser(undefined)).toBeNull();
  });

  it("returns null for an invalid token", async () => {
    const { getAuthUser } = await import("../../auth/session");
    expect(await getAuthUser("not-a-valid-jwt")).toBeNull();
  });

  it("returns the user when token is valid", async () => {
    const { signJWT } = await import("../../auth/jwt");
    const { createUser } = await import("../../auth/users");
    const { getAuthUser } = await import("../../auth/session");

    const user = await createUser("testuser", "hash");
    const token = await signJWT(user.id, 24);
    const result = await getAuthUser(token);
    expect(result?.username).toBe("testuser");
  });

  it("returns null when token points to non-existent user", async () => {
    const { signJWT } = await import("../../auth/jwt");
    const { getAuthUser } = await import("../../auth/session");

    const token = await signJWT("non-existent-user-id", 24);
    expect(await getAuthUser(token)).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

```
npm test -- src/__tests__/auth/session.test.ts
```
Expected: FAIL (module not found)

**Step 3: Implement `src/auth/session.ts`**

```typescript
import { verifyJWT } from "./jwt";
import { getUserById, type User } from "./users";

export const SESSION_COOKIE_NAME = "session";

export async function getAuthUser(
  token: string | undefined
): Promise<User | null> {
  if (!token) return null;
  const payload = await verifyJWT(token);
  if (!payload) return null;
  return getUserById(payload.userId);
}
```

**Step 4: Run test to verify it passes**

```
npm test -- src/__tests__/auth/session.test.ts
```
Expected: PASS (4 tests)

**Step 5: Commit**

```
git add src/auth/session.ts src/__tests__/auth/session.test.ts
git commit -m "feat: add session helper that maps JWT cookie to user"
```

---

### Task 7: Auth module public API

**Files:**
- Modify: `src/auth/index.ts` (replace placeholder stub)

**Step 1: Replace the stub with real exports**

Overwrite `src/auth/index.ts` with:

```typescript
export type { User } from "./users";
export {
  createUser,
  getUserByUsername,
  getUserById,
  countUsers,
} from "./users";
export { hashPassword, verifyPassword } from "./passwords";
export { signJWT, verifyJWT } from "./jwt";
export { getAuthUser, SESSION_COOKIE_NAME } from "./session";
export { getDb, closeDb } from "./db";
```

**Step 2: Run all auth tests**

```
npm test -- src/__tests__/auth/
```
Expected: All previously written auth tests still pass

**Step 3: Run type-check**

```
npm run type-check
```
Expected: no errors

**Step 4: Commit**

```
git add src/auth/index.ts
git commit -m "feat: expose auth module public API (replaces Phase 1 stub)"
```

---

### Task 8: Setup API route

**Files:**
- Create: `src/app/api/setup/route.ts`
- Create: `src/__tests__/auth/setup-route.test.ts`

**Step 1: Write the failing test**

Create `src/__tests__/auth/setup-route.test.ts`:

```typescript
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.KOKPIT_DB_PATH = ":memory:";
process.env.KOKPIT_SESSION_SECRET = "test-secret-32-chars-minimum-length-xx";

describe("GET /api/setup", () => {
  beforeEach(() => vi.resetModules());

  it("returns setupRequired: true when no users exist", async () => {
    const { GET } = await import("../../app/api/setup/route");
    const res = await GET(new Request("http://localhost/api/setup"));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.setupRequired).toBe(true);
  });
});

describe("POST /api/setup", () => {
  beforeEach(() => vi.resetModules());

  it("creates first user and returns 201", async () => {
    const { POST } = await import("../../app/api/setup/route");
    const res = await POST(
      new Request("http://localhost/api/setup", {
        method: "POST",
        body: JSON.stringify({ username: "admin", password: "password123" }),
      })
    );
    expect(res.status).toBe(201);
  });

  it("returns 409 if users already exist", async () => {
    const { POST } = await import("../../app/api/setup/route");
    await POST(
      new Request("http://localhost/api/setup", {
        method: "POST",
        body: JSON.stringify({ username: "admin", password: "password123" }),
      })
    );
    const res = await POST(
      new Request("http://localhost/api/setup", {
        method: "POST",
        body: JSON.stringify({ username: "admin2", password: "password456" }),
      })
    );
    expect(res.status).toBe(409);
  });

  it("returns 400 for missing password", async () => {
    const { POST } = await import("../../app/api/setup/route");
    const res = await POST(
      new Request("http://localhost/api/setup", {
        method: "POST",
        body: JSON.stringify({ username: "admin" }),
      })
    );
    expect(res.status).toBe(400);
  });
});
```

**Step 2: Run test to verify it fails**

```
npm test -- src/__tests__/auth/setup-route.test.ts
```
Expected: FAIL (route not found)

**Step 3: Implement `src/app/api/setup/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { countUsers, createUser, hashPassword } from "@/auth";

export async function GET() {
  return NextResponse.json({ setupRequired: countUsers() === 0 });
}

export async function POST(req: Request) {
  if (countUsers() > 0) {
    return NextResponse.json(
      { error: "Setup already complete" },
      { status: 409 }
    );
  }

  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { username, password } = body;
  if (!username || !password) {
    return NextResponse.json(
      { error: "username and password are required" },
      { status: 400 }
    );
  }

  const passwordHash = await hashPassword(password);
  const user = await createUser(username, passwordHash);

  return NextResponse.json(
    { id: user.id, username: user.username },
    { status: 201 }
  );
}
```

**Step 4: Run test to verify it passes**

```
npm test -- src/__tests__/auth/setup-route.test.ts
```
Expected: PASS (4 tests)

**Step 5: Commit**

```
git add src/app/api/setup/route.ts src/__tests__/auth/setup-route.test.ts
git commit -m "feat: add /api/setup route for first-run user creation"
```

---

### Task 9: Login and logout API routes

**Files:**
- Create: `src/app/api/auth/login/route.ts`
- Create: `src/app/api/auth/logout/route.ts`
- Create: `src/__tests__/auth/login-route.test.ts`

**Step 1: Write the failing test**

Create `src/__tests__/auth/login-route.test.ts`:

```typescript
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.KOKPIT_DB_PATH = ":memory:";
process.env.KOKPIT_SESSION_SECRET = "test-secret-32-chars-minimum-length-xx";

// Mock getConfig so no real settings.yaml is needed
vi.mock("../../config", () => ({
  getConfig: vi.fn().mockResolvedValue({
    auth: { enabled: true, session_ttl_hours: 24 },
  }),
}));

// Mock next/headers (not available outside Next.js runtime)
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    set: vi.fn(),
    delete: vi.fn(),
    get: vi.fn(),
  }),
}));

describe("POST /api/auth/login", () => {
  beforeEach(() => vi.resetModules());

  it("returns 200 on valid credentials", async () => {
    const { createUser, hashPassword } = await import("../../auth");
    const hash = await hashPassword("correctpassword");
    await createUser("admin", hash);

    const { POST } = await import("../../app/api/auth/login/route");
    const res = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: "admin", password: "correctpassword" }),
      })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.username).toBe("admin");
  });

  it("returns 401 on invalid password", async () => {
    const { createUser, hashPassword } = await import("../../auth");
    const hash = await hashPassword("correctpassword");
    await createUser("admin2", hash);

    const { POST } = await import("../../app/api/auth/login/route");
    const res = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: "admin2", password: "wrongpassword" }),
      })
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 on unknown username", async () => {
    const { POST } = await import("../../app/api/auth/login/route");
    const res = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: "nobody", password: "pass" }),
      })
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 on missing fields", async () => {
    const { POST } = await import("../../app/api/auth/login/route");
    const res = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: "admin" }),
      })
    );
    expect(res.status).toBe(400);
  });
});
```

**Step 2: Run test to verify it fails**

```
npm test -- src/__tests__/auth/login-route.test.ts
```
Expected: FAIL (route not found)

**Step 3: Implement `src/app/api/auth/login/route.ts`**

```typescript
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  getUserByUsername,
  verifyPassword,
  signJWT,
  SESSION_COOKIE_NAME,
} from "@/auth";
import { getConfig } from "@/config";

export async function POST(req: Request) {
  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { username, password } = body;
  if (!username || !password) {
    return NextResponse.json(
      { error: "username and password are required" },
      { status: 400 }
    );
  }

  const user = getUserByUsername(username);
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const config = await getConfig();
  const ttl = config.auth.session_ttl_hours;
  const token = await signJWT(user.id, ttl);

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ttl * 60 * 60,
  });

  return NextResponse.json({ id: user.id, username: user.username });
}
```

**Step 4: Implement `src/app/api/auth/logout/route.ts`**

```typescript
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/auth";

export async function POST() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
  return NextResponse.json({ ok: true });
}
```

**Step 5: Run test to verify it passes**

```
npm test -- src/__tests__/auth/login-route.test.ts
```
Expected: PASS (4 tests)

**Step 6: Commit**

```
git add src/app/api/auth/login/route.ts src/app/api/auth/logout/route.ts src/__tests__/auth/login-route.test.ts
git commit -m "feat: add /api/auth/login and /api/auth/logout routes"
```

---

### Task 10: Me endpoint

**Files:**
- Create: `src/app/api/auth/me/route.ts`

**Step 1: Implement `src/app/api/auth/me/route.ts`**

```typescript
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAuthUser, SESSION_COOKIE_NAME } from "@/auth";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const user = await getAuthUser(token);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({ id: user.id, username: user.username });
}
```

**Step 2: Run type-check**

```
npm run type-check
```
Expected: no errors

**Step 3: Commit**

```
git add src/app/api/auth/me/route.ts
git commit -m "feat: add /api/auth/me endpoint to get current session user"
```

---

### Task 11: TOTP scaffold

**Files:**
- Create: `src/app/api/auth/totp/setup/route.ts`
- Create: `src/app/api/auth/totp/verify/route.ts`

**Step 1: Create stubs**

`src/app/api/auth/totp/setup/route.ts`:

```typescript
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    { error: "TOTP not yet implemented" },
    { status: 501 }
  );
}
```

`src/app/api/auth/totp/verify/route.ts`:

```typescript
import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "TOTP not yet implemented" },
    { status: 501 }
  );
}
```

**Step 2: Commit**

```
git add src/app/api/auth/totp/
git commit -m "feat: scaffold TOTP API routes (501 stubs, to be implemented later)"
```

---

### Task 12: Protected route group layout

**Files:**
- Create: `src/app/(protected)/layout.tsx`
- Move: `src/app/page.tsx` → `src/app/(protected)/page.tsx`

**Step 1: Create `src/app/(protected)/layout.tsx`**

```typescript
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getAuthUser, countUsers, SESSION_COOKIE_NAME } from "@/auth";
import { getConfig } from "@/config";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const config = await getConfig();

  if (config.auth.enabled) {
    if (countUsers() === 0) {
      redirect("/setup");
    }

    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    const user = await getAuthUser(token);

    if (!user) {
      redirect("/login");
    }
  }

  return <>{children}</>;
}
```

**Step 2: Move the home page**

```
mv src/app/page.tsx src/app/(protected)/page.tsx
```

**Step 3: Run type-check and lint**

```
npm run type-check && npm run lint
```
Expected: no errors

**Step 4: Commit**

```
git add src/app/(protected)/
git commit -m "feat: add (protected) route group with auth guard layout"
```

---

### Task 13: Login page

**Files:**
- Create: `src/app/login/LoginForm.tsx`
- Create: `src/app/login/page.tsx`

**Step 1: Create `src/app/login/LoginForm.tsx`**

```typescript
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const data = new FormData(e.currentTarget);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: data.get("username"),
        password: data.get("password"),
      }),
    });

    setLoading(false);

    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      const json = await res.json();
      setError(json.error ?? "Login failed");
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: "320px" }}
    >
      <h1>Sign in to Kokpit</h1>
      {error && <p style={{ color: "red" }}>{error}</p>}
      <input
        name="username"
        type="text"
        placeholder="Username"
        required
        autoComplete="username"
      />
      <input
        name="password"
        type="password"
        placeholder="Password"
        required
        autoComplete="current-password"
      />
      <button type="submit" disabled={loading}>
        {loading ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
```

**Step 2: Create `src/app/login/page.tsx`**

```typescript
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getAuthUser, countUsers, SESSION_COOKIE_NAME } from "@/auth";
import LoginForm from "./LoginForm";

export default async function LoginPage() {
  if (countUsers() === 0) {
    redirect("/setup");
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const user = await getAuthUser(token);
  if (user) {
    redirect("/");
  }

  return (
    <main
      style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}
    >
      <LoginForm />
    </main>
  );
}
```

**Step 3: Run type-check**

```
npm run type-check
```
Expected: no errors

**Step 4: Commit**

```
git add src/app/login/
git commit -m "feat: add login page"
```

---

### Task 14: Setup wizard page

**Files:**
- Create: `src/app/setup/SetupForm.tsx`
- Create: `src/app/setup/page.tsx`

**Step 1: Create `src/app/setup/SetupForm.tsx`**

```typescript
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SetupForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const data = new FormData(e.currentTarget);
    const password = data.get("password") as string;
    const confirm = data.get("confirm") as string;

    if (password !== confirm) {
      setError("Passwords do not match");
      setLoading(false);
      return;
    }

    const res = await fetch("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: data.get("username"), password }),
    });

    setLoading(false);

    if (res.ok) {
      router.push("/login");
    } else {
      const json = await res.json();
      setError(json.error ?? "Setup failed");
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: "320px" }}
    >
      <h1>Welcome to Kokpit</h1>
      <p>Create your admin account to get started.</p>
      {error && <p style={{ color: "red" }}>{error}</p>}
      <input name="username" type="text" placeholder="Username" required autoComplete="username" />
      <input
        name="password"
        type="password"
        placeholder="Password (min 8 chars)"
        required
        autoComplete="new-password"
        minLength={8}
      />
      <input
        name="confirm"
        type="password"
        placeholder="Confirm password"
        required
        autoComplete="new-password"
      />
      <button type="submit" disabled={loading}>
        {loading ? "Creating account…" : "Create admin account"}
      </button>
    </form>
  );
}
```

**Step 2: Create `src/app/setup/page.tsx`**

```typescript
import { redirect } from "next/navigation";
import { countUsers } from "@/auth";
import SetupForm from "./SetupForm";

export default async function SetupPage() {
  if (countUsers() > 0) {
    redirect("/login");
  }

  return (
    <main
      style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}
    >
      <SetupForm />
    </main>
  );
}
```

**Step 3: Run type-check**

```
npm run type-check
```
Expected: no errors

**Step 4: Commit**

```
git add src/app/setup/
git commit -m "feat: add first-run setup wizard page"
```

---

### Task 15: Docker environment and final cleanup

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.gitignore`

**Step 1: Add env vars and DB volume to `docker-compose.yml`**

In the service definition, add environment variables and a volume for the SQLite DB:

```yaml
environment:
  - KOKPIT_SESSION_SECRET=change-this-to-a-random-32-char-secret-before-use
  - KOKPIT_DB_PATH=/data/users.db
  - NODE_ENV=development
volumes:
  - ./data:/data    # Persists SQLite DB across container restarts
```

**Step 2: Add `data/` to `.gitignore`**

Add this line to `.gitignore` if not present:

```
data/
```

**Step 3: Run all tests**

```
npm test
```
Expected: All tests pass

**Step 4: Run type-check and lint**

```
npm run type-check && npm run lint
```
Expected: no errors

**Step 5: Commit**

```
git add docker-compose.yml .gitignore
git commit -m "chore: add auth env vars and data volume to Docker config"
```

---

### Task 16: Save plan + final verification

**Step 1: Save plan to docs**

```
mkdir -p docs/plans
cp ~/.claude/plans/swift-moseying-treehouse.md docs/plans/2026-03-03-auth-system.md
git add docs/plans/
git commit -m "docs: save auth system implementation plan"
```

**Step 2: Run full test suite**

```
npm test
```
Expected: All tests pass (12 existing + ~23 new auth tests)

**Step 3: Run type-check**

```
npm run type-check
```
Expected: no errors

**Step 4: Run lint**

```
npm run lint
```
Expected: no errors

---

## Verification (Manual E2E)

Start dev server: `npm run dev`

1. Visit `http://localhost:3000` — redirects to `/setup` (no users exist)
2. Fill out setup form → creates admin account → redirects to `/login`
3. Log in with the credentials → arrives at dashboard
4. Visit `/login` while logged in → redirects to `/`
5. POST to `/api/auth/logout` → clears cookie
6. Visit `/` → redirects to `/login`
7. Set `auth.enabled: false` in `settings.yaml` → dashboard accessible without login

**Curl smoke tests:**

```bash
# Setup status
curl http://localhost:3000/api/setup
# Expected: {"setupRequired":true}

# Create admin
curl -X POST http://localhost:3000/api/setup \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"mypassword123"}'
# Expected: 201 {"id":"...","username":"admin"}

# Login (saves cookie)
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"mypassword123"}' \
  -c cookies.txt -v
# Expected: 200, set-cookie: session=...; HttpOnly

# Get current user
curl http://localhost:3000/api/auth/me -b cookies.txt
# Expected: 200 {"id":"...","username":"admin"}

# Logout
curl -X POST http://localhost:3000/api/auth/logout -b cookies.txt
# Expected: 200 {"ok":true}

# Verify logged out
curl http://localhost:3000/api/auth/me -b cookies.txt
# Expected: 401 {"error":"Unauthorized"}
```
