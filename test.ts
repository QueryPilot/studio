import Anthropic from "@anthropic-ai/sdk";

// "refresh": "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",
// "access": "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",
const anthropic = new Anthropic({
  authToken:
    "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",
});

const msg = await anthropic.messages.create({
  model: "claude-sonnet-4-5",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello, Claude" }],
});
console.log(msg);
