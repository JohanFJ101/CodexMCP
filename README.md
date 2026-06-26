# CodexMCP

Personal MCP server that exposes a `query_offload` tool to Claude. Lets Claude delegate mechanical, output-heavy tasks (boilerplate, type generation, summarisation) to OpenAI while keeping reasoning in-context.

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Make `codexmcp` available globally

```bash
npm link
```

This creates a global `codexmcp` binary pointing at `bin/codexmcp.js`.

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in:

| Variable | Description |
|---|---|
| `TUNNEL_URL` | Your Tailscale Funnel URL (e.g. `https://t480.tail1234.ts.net`) |
| `OPENAI_API_KEY` | OpenAI API key |
| `JWT_SECRET` | Any random 32+ character string |
| `PORT` | Port to listen on (default `3000`) |

### 4. Tailscale Funnel (T480)

Tailscale Funnel exposes a local port on a stable public HTTPS URL — no dynamic DNS, no port forwarding.

```bash
# On the T480, run once (survives reboots if you enable it):
tailscale funnel 3000
```

Get your permanent URL:

```bash
tailscale funnel status
# Example output: https://t480.tail1234.ts.net -> localhost:3000
```

Copy that URL into `TUNNEL_URL` in your `.env`.

### 5. Start the server

```bash
codexmcp
```

Expected output:

```
codexmcp running on http://0.0.0.0:3000
MCP endpoint (add to claude.ai): https://t480.tail1234.ts.net/mcp
```

### 6. Verify

```bash
curl http://localhost:3000/health
# {"status":"ok","server":"codexmcp","version":"0.0.1"}
```

### 7. Connect to claude.ai

1. Go to **claude.ai → Settings → Connectors → Add custom connector**
2. Paste your `TUNNEL_URL/mcp` (e.g. `https://t480.tail1234.ts.net/mcp`)
3. Complete the OAuth flow — it auto-approves (single-user server)

### 8. Create a Claude Project

1. Create a new Project in claude.ai
2. Add the codexmcp connector to it
3. Paste the system prompt below into **Project Instructions**

---

## Permanent deployment with systemd (T480)

Copy the repo to the T480, install, link, and deploy the service:

```bash
# On T480
git clone <repo> ~/codexmcp
cd ~/codexmcp
npm install
npm link

# Copy and enable the service
sudo cp offload-mcp.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable offload-mcp
sudo systemctl start offload-mcp

# Check status
sudo systemctl status offload-mcp
journalctl -u offload-mcp -f
```

The `ExecStart` in `offload-mcp.service` points to `/usr/local/bin/codexmcp` (where `npm link` installs the global binary on Linux). Adjust if your `npm prefix` is different (`npm prefix -g` to check).

---

## Claude Project system prompt

Paste this verbatim into the Project Instructions field:

```
## Behavior
- Never glaze. Be direct, honest, no sycophancy.
- Make no assumptions. Use the MCQ tool to clarify before proceeding. If skipped, pick the best option yourself.
- Format all responses carefully in clean markdown.
- Think before responding unless the query is trivial.
- When asked for opinions, be unbiased — say what is true, not what I want to hear.

## Task Routing
For every response, mentally split the task first:
1. Pure mechanical output (boilerplate, type generation, bulk code, summarizing large text, repetitive patterns) → call query_offload, return the result directly.
2. Mixed task (reasoning + output) → handle the reasoning yourself, call query_offload for the output part.
3. Pure reasoning (debugging, architecture, review, explanation) → answer directly, no tool call.
Call query_offload automatically. Never ask if you should use it.
```

---

## Development

```bash
npm run dev   # node --watch src/server.js
```
