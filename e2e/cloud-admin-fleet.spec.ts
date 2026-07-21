import { expect, test } from '@playwright/test';

// SuperAdmin fleet view — the admin-only Cloud console panels on world.hanzo.ai:
// Clusters & Nodes (DOKS nodes per cluster) and GPU Queue (gpu-jobs depth + what
// each worker serves). These prove the CLIENT gate mirrors the server one: the
// panels mount + render live data ONLY for an admin-org owner, and a non-admin
// (org-admin of their own tenant) is DENIED — the panels never mount.
//
// The server independently fail-closes 403 (handlers_cloud_admin_infra_test.go);
// here we drive the real app with the IAM userinfo + the /v1/world/cloud/* reads
// mocked to their real shapes, so the render + gating are exercised end-to-end.

const now = new Date().toISOString();

const CLUSTERS = {
  available: true,
  updatedAt: now,
  note: 'Live DOKS + BYO clusters from visor.',
  totals: { clusters: 2, nodes: 5, nodesReady: 4, gpus: 2 },
  clusters: [
    {
      id: 'c-hanzo', name: 'hanzo-k8s', region: 'sfo3', status: 'running', kind: 'managed',
      nodes: 3, nodesReady: 2, gpus: 2,
      pools: [{ name: 'pool-gpu', size: 'gpu-l40', count: 2, autoScale: true, minNodes: 1, maxNodes: 4 }],
      nodeList: [
        { id: 'n1', name: 'hanzo-k8s-1', status: 'active', type: 's-8vcpu-16gb', region: 'sfo3', gpu: '' },
        { id: 'n2', name: 'hanzo-k8s-2', status: 'active', type: 'gpu-l40', region: 'sfo3', gpu: 'L40S' },
        { id: 'n3', name: 'hanzo-k8s-3', status: 'provisioning', type: 'gpu-l40', region: 'sfo3', gpu: 'L40S' },
      ],
    },
    {
      id: 'c-adnexus', name: 'adnexus-k8s', region: 'sfo3', status: 'running', kind: 'managed',
      nodes: 2, nodesReady: 2, gpus: 0, pools: [],
      nodeList: [
        { id: 'a1', name: 'adnexus-k8s-1', status: 'active', type: 's-4vcpu-8gb', region: 'sfo3', gpu: '' },
        { id: 'a2', name: 'adnexus-k8s-2', status: 'active', type: 's-4vcpu-8gb', region: 'sfo3', gpu: '' },
      ],
    },
  ],
};

const QUEUE = {
  available: true,
  updatedAt: now,
  note: 'Live GPU job queue (gpu-jobs).',
  namespace: 'gpu-jobs',
  depth: { pending: 1, running: 2, done: 1, failed: 1, canceled: 0 },
  workers: { online: 2, total: 3 },
  services: [
    { service: 'studio', pending: 1, running: 1 },
    { service: 'engine', pending: 0, running: 1 },
  ],
  running: [
    { id: 'job-1', type: 'studio.render', service: 'studio', status: 'running', worker: 'evo', model: 'flux.1', attempt: 1, startedAt: now, closedAt: '' },
    { id: 'job-2', type: 'engine.serve', service: 'engine', status: 'running', worker: 'spark', model: 'qwen3-32b', attempt: 1, startedAt: now, closedAt: '' },
  ],
  pending: [
    { id: 'job-3', type: 'studio.render', service: 'studio', status: 'pending', worker: '', model: 'flux.1', attempt: 0, startedAt: '', closedAt: '' },
  ],
  recent: [
    { id: 'job-4', type: 'echo', service: 'echo', status: 'done', worker: '', model: '', attempt: 1, startedAt: '', closedAt: now },
    { id: 'job-5', type: 'studio.render', service: 'studio', status: 'failed', worker: '', model: '', attempt: 2, startedAt: '', closedAt: now },
  ],
};

// Seed a live (non-expired) IAM session so getToken()/isAuthenticated() resolve
// without a redirect, then let the userinfo route decide the owner (admin vs not).
async function seedSession(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('hanzo_iam_access_token', 'e2e-token');
    localStorage.setItem('hanzo_iam_expires_at', String(Date.now() + 3600_000));
  });
}

async function mockUserinfo(page: import('@playwright/test').Page, owner: string): Promise<void> {
  await page.route('**/v1/iam/oauth/userinfo', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sub: 'z', owner, email: 'z@hanzo.ai', name: 'Z' }) }),
  );
}

async function mockFleetReads(page: import('@playwright/test').Page): Promise<void> {
  await page.route('**/v1/world/cloud/clusters', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CLUSTERS) }));
  await page.route('**/v1/world/cloud/queue', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(QUEUE) }));
}

test.describe('SuperAdmin fleet view', () => {
  test('admin sees Clusters & Nodes + GPU Queue with live data', async ({ page }) => {
    await seedSession(page);
    await mockUserinfo(page, 'admin');
    await mockFleetReads(page);

    await page.goto('/?variant=cloud');

    // Clusters panel mounts only for an admin owner, and renders the real DOKS
    // clusters grouped by cluster with their node status.
    const clusters = page.locator('#panelsGrid [data-panel="cloud-clusters"]');
    await expect(clusters).toBeVisible({ timeout: 30000 });
    await expect(clusters).toContainText('hanzo-k8s');
    await expect(clusters).toContainText('adnexus-k8s');
    await expect(clusters).toContainText('hanzo-k8s-2'); // a node row
    await expect(clusters).toContainText('L40S');        // GPU node spec
    await expect(clusters.locator('.cloud-cluster-group')).toHaveCount(2);

    // Queue panel: depth + what's running, from which service, on which worker.
    const queue = page.locator('#panelsGrid [data-panel="cloud-queue"]');
    await expect(queue).toBeVisible();
    await expect(queue).toContainText('gpu-jobs');
    await expect(queue).toContainText('studio.render');
    await expect(queue).toContainText('engine.serve');
    await expect(queue).toContainText('spark');     // claiming worker
    await expect(queue).toContainText('qwen3-32b'); // the model that worker serves
    await expect(queue.locator('.cloud-queue-job').first()).toBeVisible();

    await clusters.scrollIntoViewIfNeeded();
    await clusters.screenshot({ path: 'e2e-shots/superadmin-clusters.png' });
    await queue.scrollIntoViewIfNeeded();
    await queue.screenshot({ path: 'e2e-shots/superadmin-queue.png' });
  });

  test('non-admin (org-admin only) is DENIED — panels never mount', async ({ page }) => {
    await seedSession(page);
    await mockUserinfo(page, 'acme'); // a real tenant, NOT the reserved admin org
    await mockFleetReads(page);       // even with data mocked, the gate must hold

    await page.goto('/?variant=cloud');

    // The always-mounted cloud overview confirms the grid built for this signed-in
    // non-admin, so the absence of the admin panels below is a real deny, not a race.
    await expect(page.locator('#panelsGrid [data-panel="cloud-overview"]')).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(1500); // let any async admin-mount attempt resolve

    await expect(page.locator('#panelsGrid [data-panel="cloud-clusters"]')).toHaveCount(0);
    await expect(page.locator('#panelsGrid [data-panel="cloud-queue"]')).toHaveCount(0);
  });
});
