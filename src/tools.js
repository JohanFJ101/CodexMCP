import { spawn } from 'child_process';
import { readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

// Route through the user's Codex CLI (codex exec) so calls use the ChatGPT
// subscription instead of a paid API key. The CLI owns auth + token refresh.
// On Windows, codex is a .cmd shim — Node can only spawn it via a shell.
const IS_WIN = process.platform === 'win32';
const CODEX_BIN = IS_WIN ? 'codex.cmd' : 'codex';

// Routing matrix: model tier (fast/smart) × power (low/mid/high/xhigh).
// `effort` omitted means no reasoning_effort is passed for that cell.
const MODELS = {
  fast: {
    low: { model: 'gpt-5.4-nano' },
    mid: { model: 'gpt-5.4-mini' },
    high: { model: 'gpt-5.4', effort: 'high' },
    xhigh: { model: 'gpt-5.4', effort: 'xhigh' },
  },
  smart: {
    low: { model: 'gpt-5.5' },
    mid: { model: 'gpt-5.5', effort: 'medium' },
    high: { model: 'gpt-5.5', effort: 'high' },
    xhigh: { model: 'gpt-5.5', effort: 'xhigh' },
  },
};

const SYSTEM_PREAMBLE =
  'You are a code and content generation assistant. Output only the requested content. ' +
  'No explanation, no preamble, no markdown fences unless the output is markdown.';

export const TOOLS = [
  {
    name: 'query_offload',
    description:
      'Use this for any task that is repetitive, mechanical, or output-heavy with no reasoning required. ' +
      'Examples: boilerplate code, schema to types, CRUD routes, repetitive test cases, summarizing large text, bulk transformations. ' +
      'Do NOT use for debugging, architecture decisions, security review, or anything needing judgment. ' +
      'Pass a clear task and any relevant context. Returns completed output ready to use.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'What to generate or transform.' },
        context: { type: 'string', description: 'Relevant code, schema, or spec to work from.' },
        model: { type: 'string', enum: ['fast', 'smart'], description: 'fast=gpt-5.4 family, smart=gpt-5.5. Default fast.' },
        power: { type: 'string', enum: ['low', 'mid', 'high', 'xhigh'], description: 'Effort/capability level. Default mid.' },
      },
      required: ['task'],
    },
  },
];

export async function handleToolCall(name, args) {
  if (name === 'query_offload') return queryOffload(args);
  throw new Error(`Unknown tool: ${name}`);
}

async function queryOffload({ task, context = '', model = 'fast', power = 'mid' }) {
  const tier = (MODELS[model] || MODELS.fast)[power] || MODELS.fast.mid;
  const { model: modelId, effort } = tier;

  const parts = [SYSTEM_PREAMBLE];
  if (context) parts.push(`Context:\n${context}`);
  parts.push(`Task:\n${task}`);
  const prompt = parts.join('\n\n');

  const outFile = join(tmpdir(), `codex-offload-${randomUUID()}.txt`);
  const args = [
    'exec',
    '-m', modelId,
    ...(effort ? ['-c', `model_reasoning_effort=${effort}`] : []),
    '-s', 'read-only',
    '--skip-git-repo-check',
    '--ephemeral',
    '--color', 'never',
    '-o', outFile,
    '-', // read prompt from stdin
  ];

  const text = await new Promise((resolve, reject) => {
    // On Windows, codex.cmd must run via a shell. Pass one command string
    // (not args + shell:true, which is deprecated and unescaped) — every
    // interpolated value here is a controlled constant; the prompt is on stdin.
    const child = IS_WIN
      ? spawn(
          `${CODEX_BIN} exec -m ${modelId}${effort ? ` -c model_reasoning_effort=${effort}` : ''} ` +
            `-s read-only --skip-git-repo-check --ephemeral --color never -o "${outFile}" -`,
          { stdio: ['pipe', 'ignore', 'pipe'], shell: true }
        )
      : spawn(CODEX_BIN, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => reject(new Error(`Failed to launch ${CODEX_BIN}: ${e.message}. Is the Codex CLI installed and logged in (codex login)?`)));
    child.on('close', async (code) => {
      if (code !== 0) {
        return reject(new Error(`codex exec exited with code ${code}: ${stderr.trim().slice(-500) || 'no stderr'}`));
      }
      try {
        resolve(await readFile(outFile, 'utf8'));
      } catch (e) {
        reject(new Error(`codex exec produced no output file: ${e.message}`));
      } finally {
        unlink(outFile).catch(() => {});
      }
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });

  console.log(`[query_offload] model=${modelId} reasoning_effort=${effort ?? 'none'} chars=${text.length}`);
  return text.trim();
}
