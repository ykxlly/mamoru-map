const base = process.env.PREVIEW_URL;
if (!base) throw new Error('PREVIEW_URL is required');
for (const path of ['/api/health', '/api/reports']) {
  const response = await fetch(new URL(path, base));
  if (!response.ok) throw new Error(`${path} expected 2xx, got ${response.status}`);
}
const admin = await fetch(new URL('/api/admin', base));
if (admin.status !== 401) throw new Error(`/api/admin expected 401, got ${admin.status}`);
console.log('SMOKE_CHECK_OK health reports admin401');
