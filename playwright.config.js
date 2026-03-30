const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    headless: true,
    launchOptions: {
      args: ['--allow-file-access-from-files'],
    },
  },
});
