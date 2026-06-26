import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
        model: { type: 'string', enum: ['fast', 'smart'], description: 'fast=gpt-4.1-mini, smart=gpt-5.5' },
      },
      required: ['task'],
    },
  },
];

export async function handleToolCall(name, args) {
  if (name === 'query_offload') return queryOffload(args);
  throw new Error(`Unknown tool: ${name}`);
}

async function queryOffload({ task, context = '', model = 'smart' }) {
  const modelId = model === 'fast' ? 'gpt-4.1-mini' : 'gpt-5.5';
  const prompt = context ? `Context:\n${context}\n\nTask:\n${task}` : task;

  const response = await openai.chat.completions.create({
    model: modelId,
    max_tokens: 4096,
    messages: [
      {
        role: 'system',
        content:
          'You are a code and content generation assistant. Output only the requested content. ' +
          'No explanation, no preamble, no markdown fences unless the output is markdown.',
      },
      { role: 'user', content: prompt },
    ],
  });

  const usage = response.usage;
  console.log(`[query_offload] model=${modelId} in=${usage.prompt_tokens} out=${usage.completion_tokens}`);

  return response.choices[0].message.content;
}