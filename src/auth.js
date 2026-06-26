import { Router } from 'express';
import { SignJWT, jwtVerify } from 'jose';
import crypto from 'crypto';

export const router = Router();

const VALID_REDIRECT_URIS = [
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
];

// In-memory stores — fine for single user
const authCodes = new Map();
const refreshTokens = new Map();

const secret = () => new TextEncoder().encode(process.env.JWT_SECRET);

// ── Well-Known Endpoints ───────────────────────────────────────────────────────

function protectedResourceMetadata(req, res) {
  const base = process.env.TUNNEL_URL;
  res.json({
    resource: `${base}/mcp`,
    authorization_servers: [base],
  });
}
// Claude probes the bare path and the /mcp-suffixed path — serve both.
router.get('/.well-known/oauth-protected-resource/mcp', protectedResourceMetadata);
router.get('/.well-known/oauth-protected-resource', protectedResourceMetadata);

function authServerMetadata(req, res) {
  const base = process.env.TUNNEL_URL;
  res.json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/register`,
    response_types_supported: ['code'],
    code_challenge_methods_supported: ['S256'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
  });
}
router.get('/.well-known/oauth-authorization-server', authServerMetadata);
router.get('/.well-known/oauth-authorization-server/mcp', authServerMetadata);

// ── Dynamic Client Registration (RFC 7591) ─────────────────────────────────────
// Claude registers a client before starting the OAuth flow. Without this it
// aborts before ever reaching /oauth/authorize. Single user — accept anything.
router.post('/register', (req, res) => {
  const body = req.body || {};
  console.log('[register] hit', JSON.stringify(body));
  res.status(201).json({
    client_id: crypto.randomBytes(16).toString('hex'),
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: body.redirect_uris || VALID_REDIRECT_URIS,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  });
});

// ── Authorization Endpoint ─────────────────────────────────────────────────────

router.get('/oauth/authorize', (req, res) => {
  console.log('[oauth/authorize] hit', JSON.stringify(req.query));
  const { redirect_uri, code_challenge, code_challenge_method, state, client_id } = req.query;

  if (!redirect_uri || !code_challenge || code_challenge_method !== 'S256') {
    return res.status(400).json({ error: 'invalid_request' });
  }

  if (!VALID_REDIRECT_URIS.includes(redirect_uri)) {
    return res.status(400).json({ error: 'invalid_redirect_uri' });
  }

  // Single user — auto approve, no login screen
  const code = crypto.randomBytes(32).toString('hex');
  authCodes.set(code, {
    code_challenge,
    redirect_uri,
    expires: Date.now() + 60_000, // 1 min
  });

  const url = new URL(redirect_uri);
  url.searchParams.set('code', code);
  if (state) url.searchParams.set('state', state);

  return res.redirect(url.toString());
});

// ── Token Endpoint ─────────────────────────────────────────────────────────────

router.post('/oauth/token', async (req, res) => {
  const { grant_type, code, code_verifier, refresh_token, redirect_uri } = req.body;

  if (grant_type === 'authorization_code') {
    const stored = authCodes.get(code);

    if (!stored || Date.now() > stored.expires) {
      return res.status(400).json({ error: 'invalid_grant' });
    }

    if (stored.redirect_uri !== redirect_uri) {
      return res.status(400).json({ error: 'invalid_grant' });
    }

    // Verify PKCE
    const hash = crypto
      .createHash('sha256')
      .update(code_verifier)
      .digest('base64url');

    if (hash !== stored.code_challenge) {
      return res.status(400).json({ error: 'invalid_grant' });
    }

    authCodes.delete(code);

    const access_token = await new SignJWT({ sub: 'johan' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret());

    const rt = crypto.randomBytes(32).toString('hex');
    refreshTokens.set(rt, { sub: 'johan', expires: Date.now() + 86_400_000 });

    return res.json({ access_token, token_type: 'Bearer', expires_in: 3600, refresh_token: rt });
  }

  if (grant_type === 'refresh_token') {
    const stored = refreshTokens.get(refresh_token);

    if (!stored || Date.now() > stored.expires) {
      return res.status(400).json({ error: 'invalid_grant' });
    }

    const access_token = await new SignJWT({ sub: stored.sub })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret());

    return res.json({ access_token, token_type: 'Bearer', expires_in: 3600 });
  }

  return res.status(400).json({ error: 'unsupported_grant_type' });
});

// ── Auth Middleware (used by mcp.js) ──────────────────────────────────────────

export async function requireAuth(req, res, next) {
  const header = req.headers['authorization'];
  if (!header?.startsWith('Bearer ')) {
    res.set('WWW-Authenticate', `Bearer resource_metadata="${process.env.TUNNEL_URL}/.well-known/oauth-protected-resource/mcp"`);
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const token = header.slice(7);
    const { payload } = await jwtVerify(token, secret());
    req.user = payload;
    next();
  } catch {
    res.set('WWW-Authenticate', `Bearer error="invalid_token"`);
    return res.status(401).json({ error: 'invalid_token' });
  }
}