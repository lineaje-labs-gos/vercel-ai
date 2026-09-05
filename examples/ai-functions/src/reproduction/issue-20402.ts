import { HarnessAgent } from '@ai-sdk/harness/agent';
import { createPi } from '@ai-sdk/harness-pi';
import { createJustBashSandbox } from '@ai-sdk/sandbox-just-bash';

const CAPTURED_REQUEST_RESPONSE = new Response(
  JSON.stringify({
    error: {
      message: 'Reproduction stops after capturing the model-visible tools.',
    },
  }),
  {
    status: 400,
    headers: { 'content-type': 'application/json' },
  },
);

async function main() {
  let modelVisibleTools: string[] | undefined;

  globalThis.fetch = async (input, init) => {
    const payload = (await new Request(input, init).json()) as {
      tools?: Array<{
        name?: unknown;
        function?: { name?: unknown };
      }>;
    };
    modelVisibleTools = payload.tools
      ?.map(tool => tool.name ?? tool.function?.name)
      .filter((name): name is string => typeof name === 'string');
    return CAPTURED_REQUEST_RESPONSE.clone();
  };

  const harness = createPi({
    model: 'openai/gpt-4.1-mini',
    auth: { OPENAI_API_KEY: 'reproduction-key' },
    extensionFactories: [
      pi => {
        pi.registerTool({
          name: 'ping',
          label: 'ping',
          description: 'Return pong.',
          parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          } as never,
          execute: async () => ({
            content: [{ type: 'text', text: 'pong' }],
            details: {},
          }),
        });
      },
    ],
  });
  const agent = new HarnessAgent({
    harness,
    sandbox: createJustBashSandbox(),
  });
  const session = await agent.createSession({
    sessionId: 'issue-20402',
  });

  try {
    await agent.generate({
      session,
      prompt: 'List the tools available to you.',
    });
  } catch {
    // The synthetic provider response terminates the turn after fetch captures
    // the exact tool list sent to the model provider.
  } finally {
    await session.destroy();
  }

  if (modelVisibleTools == null) {
    throw new Error(
      'Issue 20402 reproduction failed before the provider request was captured.',
    );
  }

  if (!modelVisibleTools.includes('ping')) {
    console.error(
      `ISSUE_20402_REPRODUCED: extension tool "ping" was not exposed to the model; visible tools: ${modelVisibleTools.join(', ')}`,
    );
    process.exitCode = 1;
    return;
  }

  console.log('Extension tool "ping" was exposed to the model.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 2;
});
