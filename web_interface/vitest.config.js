import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setupTests.js'],
    css: true,
    restoreMocks: true,
    include: ['src/**/*.test.{js,jsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: 'test-results/vitest-coverage',
      all: true,
      include: ['src/**/*.{js,jsx}'],
      exclude: ['src/test/**', 'src/__tests__/**', '**/*.test.{js,jsx}', 'node_modules/**'],
    },
  },
});
