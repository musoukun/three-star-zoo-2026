import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,       // 3分（ゲーム完走に余裕をもたせる）
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    screenshot: 'only-on-failure',
  },
  // サーバー・クライアントは手動起動前提
  // （npm run dev を先に起動しておく）
});
