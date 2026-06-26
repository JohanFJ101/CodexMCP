import { Router } from 'express';
import { requireAuth } from './auth.js';
import { handleToolCall, TOOLS } from './tools.js';
import { randomUUID } from 'crypto';

export const router = Router();

async function dispatch(body) {
  const { method, params, id } = body;

  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  const err = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

  switch (method) {
    case 'initialize':
      return ok({
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'codexmcp', version: '0.0.1' },
        capabilities: { tools: {} },
        instructions:
          'Use query_offload for any task that is repetitive, mechanical, or output-heavy with no reasoning required. Pass a clear task and relevant context. You will receive completed output ready to use directly.',
      });

    case 'tools/list':
      return ok({ tools: TOOLS });

    case 'tools/call': {
      const { name, arguments: args } = params;
      try {
        const output = await handleToolCall(name, args);
        return ok({ content: [{ type: 'text', text: output }], isError: false });
      } catch (e) {
        return ok({ content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });
      }
    }

    case 'notifications/initialized':
      return null;

    default:
      return err(-32601, `Method not found: ${method}`);
  }
}

router.post('/', requireAuth, async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] || randomUUID();
  res.setHeader('mcp-session-id', sessionId);
  res.setHeader('Content-Type', 'application/json');

  const body = req.body;

  if (Array.isArray(body)) {
    const results = await Promise.all(body.map(dispatch));
    const filtered = results.filter(Boolean);
    return res.json(filtered.length === 1 ? filtered[0] : filtered);
  }

  const result = await dispatch(body);
  if (!result) return res.status(202).end();
  return res.json(result);
});