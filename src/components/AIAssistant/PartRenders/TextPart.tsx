import { marked } from "marked";
import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";

function splitMarkdown(markdown: string): string[] {
  return marked.lexer(markdown).map((token) => token.raw);
}

const MarkdownBlock = memo(
  ({ content }: { content: string }) => <ReactMarkdown>{content}</ReactMarkdown>,
  (prev, next) => prev.content === next.content,
);

MarkdownBlock.displayName = "MarkdownBlock";

export const TextPart = memo(
  ({ content, id }: { content: string; id: string }) => {
    const blocks = useMemo(() => splitMarkdown(content), [content]);

    return blocks.map((block, index) => (
      <MarkdownBlock content={block} key={`${id}-block_${index}`} />
    ));
  },
);

TextPart.displayName = "TextPart";
