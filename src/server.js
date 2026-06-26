import express from 'express';
import { router as authRouter } from './auth.js';
import { router as mcpRouter } from './mcp.js';
import 'dotenv/config';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // needed for OAuth token endpoint

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', server: 'codexmcp', version: '0.0.1' });
});

// Auth routes: /.well-known/*, /oauth/*
app.use(authRouter);

// MCP route: /mcp
app.use('/mcp', mcpRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`codexmcp running on http://0.0.0.0:${PORT}`);
}); 