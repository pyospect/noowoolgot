import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

export function ChatMarkdown({ content }: { content: string }) {
  return (
    <div className="space-y-3 text-[15px] leading-7 text-white/90 sm:text-base">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: (props) => <p className="whitespace-pre-wrap leading-7" {...props} />,
          h1: (props) => <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl" {...props} />,
          h2: (props) => <h2 className="text-xl font-semibold tracking-tight sm:text-2xl" {...props} />,
          h3: (props) => <h3 className="text-lg font-semibold tracking-tight sm:text-xl" {...props} />,
          ul: (props) => <ul className="list-disc space-y-1 pl-6" {...props} />,
          ol: (props) => <ol className="list-decimal space-y-1 pl-6" {...props} />,
          li: (props) => <li className="pl-1" {...props} />,
          strong: (props) => <strong className="font-semibold text-white" {...props} />,
          blockquote: (props) => (
            <blockquote className="border-l-2 border-white/25 pl-4 text-white/75" {...props} />
          ),
          code: ({ className, children, ...props }) => {
            const isBlock = String(className ?? "").includes("language-");
            if (isBlock) {
              return (
                <code
                  className={cn(
                    "block overflow-x-auto rounded-xl bg-black/30 px-4 py-3 text-base",
                    className
                  )}
                  {...props}
                >
                  {children}
                </code>
              );
            }

            return (
              <code className="rounded-md bg-black/30 px-1.5 py-0.5 text-[0.9em]" {...props}>
                {children}
              </code>
            );
          },
          a: (props) => (
            <a className="text-[#9fd4ff] underline underline-offset-2" target="_blank" {...props} />
          ),
          table: ({ children }) => (
            <div className="my-4 overflow-x-auto rounded-xl border border-white/15 bg-black/20">
              <table className="w-full min-w-[560px] border-collapse text-left text-[13px] sm:text-sm">
                {children}
              </table>
            </div>
          ),
          thead: (props) => <thead className="bg-white/10" {...props} />,
          tbody: (props) => <tbody className="divide-y divide-white/10" {...props} />,
          tr: (props) => <tr className="align-top" {...props} />,
          th: (props) => (
            <th className="border-r border-white/10 px-3 py-2 font-semibold text-white/95 last:border-r-0" {...props} />
          ),
          td: (props) => (
            <td className="border-r border-white/10 px-3 py-2 leading-relaxed text-white/85 last:border-r-0" {...props} />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
