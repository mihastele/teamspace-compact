const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeAppUrl,
  resolveAppBaseUrl,
  buildInviteUrl,
} = require("../.test-build/app-url.js");

test("normalizeAppUrl handles empty, whitespace and malformed values", () => {
  assert.equal(normalizeAppUrl(null), "");
  assert.equal(normalizeAppUrl(undefined), "");
  assert.equal(normalizeAppUrl(""), "");
  assert.equal(normalizeAppUrl("   "), "");
});

test("normalizeAppUrl normalizes schemes and strips trailing slashes", () => {
  assert.equal(
    normalizeAppUrl("https://teamspace.example.com"),
    "https://teamspace.example.com",
  );
  assert.equal(
    normalizeAppUrl("https://teamspace.example.com/"),
    "https://teamspace.example.com",
  );
  assert.equal(
    normalizeAppUrl("https://teamspace.example.com///"),
    "https://teamspace.example.com",
  );
  assert.equal(
    normalizeAppUrl("https://teamspace.example.com:8443/"),
    "https://teamspace.example.com:8443",
  );
  assert.equal(
    normalizeAppUrl("https://teamspace.example.com/sub/path/"),
    "https://teamspace.example.com/sub/path",
  );
  assert.equal(
    normalizeAppUrl("http://custom.domain.test"),
    "http://custom.domain.test",
  );
});

test("normalizeAppUrl adds https for bare domain names and http for loopback hosts", () => {
  assert.equal(
    normalizeAppUrl("teamspace.example.com"),
    "https://teamspace.example.com",
  );
  assert.equal(
    normalizeAppUrl("teamspace.example.com:8080"),
    "https://teamspace.example.com:8080",
  );
  assert.equal(normalizeAppUrl("localhost"), "http://localhost");
  assert.equal(normalizeAppUrl("localhost:3000"), "http://localhost:3000");
  assert.equal(normalizeAppUrl("127.0.0.1:8088"), "http://127.0.0.1:8088");
});

test("resolveAppBaseUrl prioritizes APP_URL then SITE_URL then NEXT_PUBLIC variables", () => {
  const originalEnv = { ...process.env };
  try {
    delete process.env.APP_URL;
    delete process.env.SITE_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.NEXT_PUBLIC_SITE_URL;

    process.env.NEXT_PUBLIC_SITE_URL = "https://public-site.test";
    assert.equal(resolveAppBaseUrl(), "https://public-site.test");

    process.env.NEXT_PUBLIC_APP_URL = "https://public-app.test";
    assert.equal(resolveAppBaseUrl(), "https://public-app.test");

    process.env.SITE_URL = "https://site-url.test";
    assert.equal(resolveAppBaseUrl(), "https://site-url.test");

    process.env.APP_URL = "https://app-url.test";
    assert.equal(resolveAppBaseUrl(), "https://app-url.test");
  } finally {
    process.env = originalEnv;
  }
});

test("resolveAppBaseUrl falls back to Request headers when environment variables are unset", () => {
  const originalEnv = { ...process.env };
  try {
    delete process.env.APP_URL;
    delete process.env.SITE_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.NEXT_PUBLIC_SITE_URL;

    // x-forwarded-host and x-forwarded-proto
    const reqForwarded = new Request("http://127.0.0.1:3000/api/test", {
      headers: {
        "x-forwarded-host": "notion.company.com",
        "x-forwarded-proto": "https, http",
      },
    });
    assert.equal(resolveAppBaseUrl(reqForwarded), "https://notion.company.com");

    // host header fallback
    const reqHost = new Request("http://127.0.0.1:3000/api/test", {
      headers: {
        host: "internal.company.com:8080",
      },
    });
    assert.equal(resolveAppBaseUrl(reqHost), "http://internal.company.com:8080");

    // request url origin fallback
    const reqPlain = new Request("https://direct.company.com/api/test");
    assert.equal(resolveAppBaseUrl(reqPlain), "https://direct.company.com");
  } finally {
    process.env = originalEnv;
  }
});

test("buildInviteUrl generates valid invite links with encoded tokens", () => {
  assert.equal(
    buildInviteUrl("token_abc123", "https://teamspace.example.com"),
    "https://teamspace.example.com/?invite=token_abc123",
  );
  assert.equal(
    buildInviteUrl("token+with special/chars==", "https://teamspace.example.com"),
    "https://teamspace.example.com/?invite=token%2Bwith%20special%2Fchars%3D%3D",
  );
  assert.equal(
    buildInviteUrl("token_abc123", ""),
    "/?invite=token_abc123",
  );
});
