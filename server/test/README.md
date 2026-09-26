# Server E2E checks

The black-box checks in `e2e.test.mjs` run against a disposable or staging
server. They cover health, missing-session handling, sync failure reporting,
and business switching without importing server internals.

Run the unauthenticated checks locally:

```sh
npm test
```

Run the credentialed checks against staging:

```sh
E2E_BASE_URL=https://staging.example.test \
E2E_ACCESS_TOKEN="..." \
E2E_BUSINESS_A="..." \
E2E_BUSINESS_B="..." \
npm test
```

Use a disposable account and database for the credentialed run. The app-side
financial-year rollover remains covered by `src/data/__tests__/logic.test.ts`;
the next extension should drive that action through a device runner once one
is selected for the project.