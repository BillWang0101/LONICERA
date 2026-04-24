const fs = require('fs');
const os = require('os');
const path = require('path');

jest.setTimeout(15000);

describe('UI smoke', () => {
  const originalEnv = { ...process.env };
  let serverModule;
  let baseUrl;
  let tempDir;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lonicera-ui-'));
    process.env.PREFLOP_TABLE = 'off';
    process.env.SAVE_DIR = tempDir;
    process.env.HOST = '127.0.0.1';
    jest.resetModules();
    serverModule = require('../server');
    await serverModule.startServer({
      port: 0,
      host: '127.0.0.1',
      buildPreflop: false,
      unrefServer: true,
    });
    baseUrl = `http://127.0.0.1:${serverModule.server.address().port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => serverModule.io.close(resolve));
    if (serverModule.server.listening) {
      await new Promise((resolve) => serverModule.server.close(resolve));
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
    process.env = originalEnv;
  });

  test('served lobby html contains current mode feedback shell and rendered asset version', async () => {
    const response = await fetch(`${baseUrl}/`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('id="modeFeedbackBar"');
    expect(html).toContain('id="modeFeedbackTitle"');
    expect(html).toContain('id="modeFeedbackText"');
    expect(html).toContain('Cash Game');
    expect(html).toContain('Tournament');
    expect(html).toContain('Practice');
    expect(html).not.toContain('__ASSET_VERSION__');
    expect(html).toMatch(/\/css\/style\.css\?v=[a-f0-9]{10}/);
    expect(html).toMatch(/\/js\/app-state\.js\?v=[a-f0-9]{10}/);
  });

  test('api status stays reachable alongside the rendered lobby shell', async () => {
    const response = await fetch(`${baseUrl}/api/status`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      preflopTableReady: false,
      preflopTableEnabled: false,
      activeRooms: 0,
    });
  });
});
