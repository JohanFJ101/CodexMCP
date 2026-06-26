import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env') });
import express from 'express';
import { router as authRouter } from './auth.js';
import { router as mcpRouter } from './mcp.js';

// ── Startup validation ─────────────────────────────────────────────────────────

const REQUIRED_ENV = ['TUNNEL_URL', 'OPENAI_API_KEY', 'JWT_SECRET'];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`ERROR: Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const tunnelUrl = process.env.TUNNEL_URL;
if (tunnelUrl.startsWith('http://localhost') || tunnelUrl.startsWith('http://127.0.0.1') ||
    tunnelUrl.startsWith('localhost') || tunnelUrl.startsWith('127.0.0.1')) {
  console.warn('WARNING: TUNNEL_URL is set to localhost. For Tailscale, run: tailscale funnel 3000');
}

// ── App ────────────────────────────────────────────────────────────────────────

const app = express();

// ── CORS + request logging (must run before everything else) ────────────────────
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, mcp-session-id');
  res.header('Access-Control-Expose-Headers', 'mcp-session-id, WWW-Authenticate');
  console.log(`[req] ${req.method} ${req.originalUrl}`, JSON.stringify(req.headers));
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', server: 'codexmcp', version: '0.0.1' });
});

app.use(authRouter);
app.use('/mcp', mcpRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`codexmcp running on http://0.0.0.0:${PORT}`);
  console.log(`MCP endpoint (add to claude.ai): ${tunnelUrl}/mcp`);
});
