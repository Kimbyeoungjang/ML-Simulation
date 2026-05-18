"use client";

import { useState } from "react";

export type DownloadFn = (name: string, text: string, type?: string) => void;

export function FieldLabel({
  children,
  tip,
}: {
  children: React.ReactNode;
  tip: string;
}) {
  return (
    <label title={tip}>
      {children}
      <span className="hint" aria-hidden="true">
        ?
      </span>
    </label>
  );
}

export function ActionButton({
  children,
  tip,
  className,
  onClick,
}: {
  children: React.ReactNode;
  tip: string;
  className?: string;
  onClick: () => void;
}) {
  return (
    <button className={className} title={tip} onClick={onClick}>
      {children}
    </button>
  );
}

export function MiniField({
  label,
  tip,
  children,
}: {
  label: string;
  tip?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mini-field" title={tip}>
      <span>{label}</span>
      {children}
    </div>
  );
}

function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .slice(0, 80);
}

function InlineMarkdown({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
        if (part.startsWith("`") && part.endsWith("`")) return <code key={i}>{part.slice(1, -1)}</code>;
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

export function MarkdownView({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  const nodes: React.ReactNode[] = [];
  let list: string[] = [];
  let code: string[] | null = null;
  const flushList = () => {
    if (list.length) {
      nodes.push(
        <ul key={`ul-${nodes.length}`}>
          {list.map((item, i) => <li key={i}><InlineMarkdown text={item} /></li>)}
        </ul>,
      );
      list = [];
    }
  };
  lines.forEach((line, idx) => {
    if (line.trim().startsWith("```")) {
      if (code) {
        nodes.push(<pre key={`code-${nodes.length}`} className="pre"><code>{code.join("\n")}</code></pre>);
        code = null;
      } else {
        flushList();
        code = [];
      }
      return;
    }
    if (code) { code.push(line); return; }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushList();
      const level = h[1].length;
      const body = h[2];
      const id = slugifyHeading(body);
      if (level === 1) nodes.push(<h1 key={idx} id={id}>{body}</h1>);
      else if (level === 2) nodes.push(<h2 key={idx} id={id}>{body}</h2>);
      else if (level === 3) nodes.push(<h3 key={idx} id={id}>{body}</h3>);
      else nodes.push(<h4 key={idx} id={id}>{body}</h4>);
      return;
    }
    const li = line.match(/^[-*]\s+(.*)$/);
    if (li) { list.push(li[1]); return; }
    if (line.trim() === "") { flushList(); nodes.push(<br key={idx} />); return; }
    flushList();
    nodes.push(<p key={idx}><InlineMarkdown text={line} /></p>);
  });
  flushList();
  const remainingCode = code as string[] | null;
  if (remainingCode !== null) nodes.push(<pre key={`code-${nodes.length}`} className="pre"><code>{remainingCode.join("\n")}</code></pre>);
  return <div className="markdown-view">{nodes}</div>;
}

export function Artifact({
  name,
  text,
  download,
}: {
  name: string;
  text: string;
  download: DownloadFn;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const isMarkdown = name.toLowerCase().endsWith(".md");
  return (
    <section className="artifact-panel" title={`${name} 미리보기와 다운로드입니다.`}>
      <div className="artifact-toolbar">
        <ActionButton
          tip={`${name} 파일을 다운로드합니다.`}
          onClick={() => download(name, text)}
        >{`${name} 다운로드`}</ActionButton>
        {isMarkdown && (
          <button className="secondary" onClick={() => setShowRaw((v) => !v)} title="Markdown 렌더링과 원문 보기를 전환합니다.">
            {showRaw ? "렌더링 보기" : "원문 보기"}
          </button>
        )}
      </div>
      {isMarkdown && !showRaw ? (
        <MarkdownView text={text} />
      ) : (
        <pre className="pre" title={`${name} 파일 내용 미리보기입니다.`}>
          {text}
        </pre>
      )}
    </section>
  );
}
