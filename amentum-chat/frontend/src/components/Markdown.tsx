import { memo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";

function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (node && typeof node === "object" && "props" in node) {
    return nodeText((node as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

export function CopyButton({ text, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="icon-btn subtle"
      title="Copy"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        });
      }}
    >
      {done ? <Check size={14} /> : <Copy size={14} />}
      {label && <span>{done ? "Copied" : label}</span>}
    </button>
  );
}

function CodeBlock({ children, className }: { children?: ReactNode; className?: string }) {
  const lang = /language-(\w+)/.exec(className || "")?.[1] ?? "text";
  const text = nodeText(children).replace(/\n$/, "");
  return (
    <div className="code-block">
      <div className="code-block-head">
        <span className="code-lang">{lang}</span>
        <CopyButton text={text} label="Copy" />
      </div>
      <pre>
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

/** Map a model-written link like "report.docx", "sandbox:/mnt/data/report.docx" or "./out/report.docx"
 *  to the generated file's download URL. Returns null for other relative links (which would 404). */
function resolveLink(href: string | undefined, files?: Record<string, string>): string | null | undefined {
  if (!href) return href;
  if (/^(https?:|mailto:|#)/i.test(href)) return href;
  let path = href.replace(/^sandbox:/, "").split(/[?#]/)[0];
  try {
    path = decodeURIComponent(path);
  } catch {
    /* keep the raw path */
  }
  const name = path.split("/").pop() ?? "";
  return files?.[name] ?? files?.[name.toLowerCase()] ?? null;
}

export const Markdown = memo(function Markdown({ text, className, files }: {
  text: string; className?: string; files?: Record<string, string>;
}) {
  return (
    <div className={`markdown ${className ?? ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children, ...rest }) => {
            const inline = !className && !String(nodeText(children)).includes("\n");
            if (inline) return <code className="inline-code" {...rest}>{children}</code>;
            return <CodeBlock className={className}>{children}</CodeBlock>;
          },
          table: ({ children }) => (
            <div className="table-wrap">
              <table>{children}</table>
            </div>
          ),
          a: ({ children, href }) => {
            const url = resolveLink(href, files);
            if (url === null) return <span className="dead-link">{children}</span>;
            if (url !== href) return <a href={url} download>{children}</a>;
            return (
              <a href={href} target="_blank" rel="noreferrer noopener">
                {children}
              </a>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
