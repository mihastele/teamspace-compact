import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { markdownUrl } from "../../lib/markdown-shortcuts";

/** HTML is never interpreted; URLs are restricted before reaching links/images. */
export default function MarkdownText({ text }: { text: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      urlTransform={markdownUrl}
      components={{
        img: ({ src, alt }) =>
          src ? (
            // User Markdown may reference any allowed HTTPS host; do not proxy it through Next image optimization.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={alt || ""} loading="lazy" />
          ) : (
            <span>{alt}</span>
          ),
        a: ({ children, href }) =>
          href ? (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ) : (
            <span>{children}</span>
          ),
      }}
    >
      {text}
    </Markdown>
  );
}
