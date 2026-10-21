import { test, expect } from "@playwright/test";
import { chunkedRequest } from "../helpers/chunked-request";

test("browser receives controlled body-limit errors without changing settings", async ({ page, request }) => {
  const initial = await request.get("/api/settings");
  expect(initial.status()).toBe(200);
  const revision = initial.headers()["x-config-revision"];
  await page.goto("/");
  const observed = await page.evaluate(async () => {
    const post = async (url: string, body: string, method = "POST") => {
      const response = await fetch(url, {
        method, headers: { "content-type": "application/json", "x-kokpit-request": "1" }, body,
      });
      return { status: response.status, body: await response.json() };
    };
    return {
      invalid: await post("/api/auth/login", "null"),
      oversized: await post("/api/auth/login", JSON.stringify({ username: "nobody", password: "x".repeat(16 * 1024) })),
      settings: await post("/api/settings", JSON.stringify({ appearance: { theme: "dark", custom_css: " ".repeat(2 * 1024 * 1024) } }), "PATCH"),
    };
  });
  expect(observed.invalid.status).toBe(400);
  expect(observed.oversized.status).toBe(413);
  expect(observed.settings.status).toBe(413);
  expect((await request.get("/api/settings")).headers()["x-config-revision"]).toBe(revision);
});

test("chunked JSON and multipart overflow return 413 before parsing", async ({ baseURL }) => {
  const json = await chunkedRequest(`${baseURL}/api/auth/login`, "POST", Buffer.alloc(16 * 1024 + 1, " "), {
    "content-type": "application/json", "x-kokpit-request": "1",
  });
  expect(json.status).toBe(413);
  expect(JSON.parse(json.body)).toMatchObject({ error: expect.any(String) });
  const upload = await chunkedRequest(`${baseURL}/api/icons/upload`, "POST", Buffer.alloc(2 * 1024 * 1024 + 64 * 1024 + 1), {
    "content-type": "multipart/form-data; boundary=limit-test",
  });
  expect(upload.status).toBe(413);
  expect(JSON.parse(upload.body)).toMatchObject({ error: expect.any(String) });
});
