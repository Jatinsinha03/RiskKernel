import React from "react";
import ReactMarkdown from "react-markdown";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className = "" }: MarkdownRendererProps) {
  return (
    <div className={`text-slate-200 text-sm sm:text-base leading-relaxed space-y-3 ${className}`}>
      <ReactMarkdown
        components={{
          p: ({ children }) => <p className="leading-relaxed">{children}</p>,
          strong: ({ children }) => <strong className="font-bold text-white">{children}</strong>,
          em: ({ children }) => <em className="italic text-slate-300">{children}</em>,
          ul: ({ children }) => (
            <ul className="list-disc pl-5 space-y-1.5 my-2 marker:text-indigo-400">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-5 space-y-1.5 my-2 marker:text-indigo-400">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="pl-1 leading-relaxed">{children}</li>,
          code: ({ children }) => (
            <code className="px-1.5 py-0.5 rounded-md bg-white/10 font-mono text-xs text-indigo-300 font-semibold border border-white/5">
              {children}
            </code>
          ),
          h1: ({ children }) => <h1 className="text-lg font-bold text-white my-2">{children}</h1>,
          h2: ({ children }) => <h2 className="text-base font-bold text-white my-2">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-bold text-white my-1">{children}</h3>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-indigo-500/50 pl-3 py-1 my-2 text-slate-300 bg-indigo-500/5 rounded-r-lg">
              {children}
            </blockquote>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
