// Test-only preload (node --import): sends SCAPI requests (https://<short-code>.api.commercecloud.salesforce.com/…)
// to the fake instance at https://$REALM_DOCTOR_TEST_SCAPI_HOST/scapi/…. Production code is unchanged.
const host = process.env.REALM_DOCTOR_TEST_SCAPI_HOST;
if (host) {
  const real = globalThis.fetch;
  const rewrite = (url) => url.replace(/^https:\/\/[^/]+\.api\.commercecloud\.salesforce\.com\//, `https://${host}/scapi/`);
  globalThis.fetch = (input, init) => {
    if (typeof input === 'string' || input instanceof URL) return real(rewrite(String(input)), init);
    if (input instanceof Request) {
      const url = rewrite(input.url);
      return url === input.url ? real(input, init) : real(new Request(url, input), init);
    }
    return real(input, init);
  };
}
