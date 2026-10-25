import React, { memo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, Copy } from 'lucide-react'

function Pre({ children, ...rest }: React.ComponentPropsWithoutRef<'pre'>): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const text = extractText(children)
  return (
    <pre {...rest}>
      <button
        type="button"
        className="btn xs copy-btn"
        onClick={() => {
          void navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        }}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
      {children}
    </pre>
  )
}

function extractText(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (React.isValidElement(node)) return extractText((node.props as { children?: React.ReactNode }).children)
  return ''
}

export const Markdown = memo(function Markdown({ text, streaming }: { text: string; streaming?: boolean }): React.JSX.Element {
  return (
    <div className={`md ${streaming ? 'cursor' : ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: Pre,
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault()
                if (href) void window.tandem.openExternal(href)
              }}
            >
              {children}
            </a>
          )
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})

export function DiffView({ diff }: { diff: string }): React.JSX.Element {
  const lines = diff.split('\n')
  return (
    <div className="diff">
      {lines.map((l, i) => {
        let cls = ''
        if (l.startsWith('+++') || l.startsWith('---')) cls = 'file'
        else if (l.startsWith('@@')) cls = 'hunk'
        else if (l.startsWith('+')) cls = 'add'
        else if (l.startsWith('-')) cls = 'del'
        return (
          <div key={i} className={cls}>
            {l || ' '}
          </div>
        )
      })}
    </div>
  )
}
