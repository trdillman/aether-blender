import { expect, test } from '@playwright/test';

const asJson = (payload, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(payload),
});

const asSse = (events) => ({
  status: 200,
  contentType: 'text/event-stream; charset=utf-8',
  body: events
    .map(({ event, data }) => `${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`)
    .join(''),
});

test('TST-009: happy path prompt -> execution -> result', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const path = url.pathname;

    if (path === '/api/runs' && method === 'GET') return route.fulfill(asJson({ runs: [] }));
    if (path === '/api/blender/active' && method === 'GET') return route.fulfill(asJson({ error: 'no session' }, 404));
    if (path === '/api/presets' && method === 'GET') return route.fulfill(asJson({ presets: [] }));

    if (path === '/api/runs' && method === 'POST') {
      return route.fulfill(
        asJson({
          run: {
            id: 'run-1',
            status: 'completed',
            prompt: 'Build a UV helper',
            model: 'GLM 4.7',
            createdAt: '2026-02-09T00:00:00.000Z',
            updatedAt: '2026-02-09T00:00:00.000Z',
          },
        }),
      );
    }

    if (path === '/api/runs/run-1/stream' && method === 'GET') {
      return route.fulfill(
        asSse([
          { data: { type: 'assistant_message', content: 'Drafted addon scaffold and validation steps.' } },
          { data: { type: 'run_completed', status: 'completed' } },
        ]),
      );
    }

    if (path === '/api/runs/run-1' && method === 'GET') {
      return route.fulfill(
        asJson({
          run: {
            id: 'run-1',
            status: 'completed',
            prompt: 'Build a UV helper',
            model: 'GLM 4.7',
            messages: [
              { role: 'user', content: 'Build a UV helper' },
              { role: 'assistant', content: 'Drafted addon scaffold and validation steps.' },
            ],
          },
        }),
      );
    }

    return route.fulfill(asJson({ error: `Unhandled route: ${method} ${path}` }, 500));
  });

  await page.goto('/');
  await page.getByLabel('Chat message input').fill('Build a UV helper');
  await page.getByRole('button', { name: 'Send message' }).click();

  await expect(page.getByText('Run completed. Check trace/logs for detailed step output.')).toBeVisible();
  await expect(page.locator('header').getByText('Completed', { exact: true })).toBeVisible();
});

test('TST-010: failure path surfaces error and allows retry success', async ({ page }) => {
  let attempt = 0;

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const path = url.pathname;

    if (path === '/api/runs' && method === 'GET') return route.fulfill(asJson({ runs: [] }));
    if (path === '/api/blender/active' && method === 'GET') return route.fulfill(asJson({ error: 'no session' }, 404));
    if (path === '/api/presets' && method === 'GET') return route.fulfill(asJson({ presets: [] }));

    if (path === '/api/runs' && method === 'POST') {
      attempt += 1;
      const id = `run-${attempt}`;
      return route.fulfill(
        asJson({
          run: {
            id,
            status: attempt === 1 ? 'failed' : 'completed',
            prompt: attempt === 1 ? 'First attempt' : 'Retry attempt',
            model: 'GLM 4.7',
          },
        }),
      );
    }

    if (path === '/api/runs/run-1/stream' && method === 'GET') {
      return route.fulfill(asSse([{ data: { type: 'run_failed', status: 'failed' } }]));
    }

    if (path === '/api/runs/run-2/stream' && method === 'GET') {
      return route.fulfill(
        asSse([
          { data: { type: 'assistant_message', content: 'Retry succeeded with deterministic plan.' } },
          { data: { type: 'run_completed', status: 'completed' } },
        ]),
      );
    }

    if (/^\/api\/runs\/run-[12]$/.test(path) && method === 'GET') {
      const failed = path.endsWith('run-1');
      return route.fulfill(
        asJson({
          run: {
            id: failed ? 'run-1' : 'run-2',
            status: failed ? 'failed' : 'completed',
            prompt: failed ? 'First attempt' : 'Retry attempt',
            model: 'GLM 4.7',
            messages: failed
              ? [{ role: 'assistant', content: 'Run finished with an error. Check trace/logs for details.' }]
              : [{ role: 'assistant', content: 'Retry succeeded with deterministic plan.' }],
          },
        }),
      );
    }

    return route.fulfill(asJson({ error: `Unhandled route: ${method} ${path}` }, 500));
  });

  await page.goto('/');

  await page.getByLabel('Chat message input').fill('First attempt');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('Run finished with an error. Check trace/logs for details.')).toBeVisible();
  await expect(page.getByText('Failed', { exact: true }).first()).toBeVisible();

  await page.getByLabel('Chat message input').fill('Retry attempt');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('Run completed. Check trace/logs for detailed step output.')).toBeVisible();
  await expect(page.locator('header').getByText('Completed', { exact: true })).toBeVisible();
});
