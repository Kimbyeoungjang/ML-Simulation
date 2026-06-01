"use client";

import { useState, type ReactNode } from "react";

export type DownloadFn = (name: string, text: string, type?: string) => void;

function InfoHint({ tip }: { tip?: string }) {
  if (!tip) return null;
  return (
    <span className="hint" title={tip} aria-label={tip} role="img">
      i
    </span>
  );
}

export function FieldLabel({
  children,
  tip,
}: {
  children: ReactNode;
  tip: string;
}) {
  return (
    <label className="field-label" title={tip}>
      <span>{children}</span>
      <InfoHint tip={tip} />
    </label>
  );
}

export function ActionButton({
  children,
  tip,
  className,
  onClick,
}: {
  children: ReactNode;
  tip: string;
  className?: string;
  onClick: () => void;
}) {
  return (
    <button className={className} title={tip} aria-label={typeof children === "string" ? `${children}: ${tip}` : tip} onClick={onClick}>
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
  children: ReactNode;
}) {
  return (
    <div className="mini-field">
      <span className="mini-field-label" title={tip}>
        {label}
        <InfoHint tip={tip} />
      </span>
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

function splitMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cell = "";
  let escaped = false;
  let code = false;
  for (const ch of trimmed) {
    if (escaped) {
      cell += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === "`") code = !code;
    if (ch === "|" && !code) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += ch;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function isTableSeparator(line: string): boolean {
  const cells = splitMarkdownTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function isTableStart(lines: string[], idx: number): boolean {
  if (idx + 1 >= lines.length) return false;
  const cur = lines[idx].trim();
  const next = lines[idx + 1].trim();
  return cur.includes("|") && next.includes("|") && isTableSeparator(next);
}

function MarkdownTable({ lines }: { lines: string[] }) {
  const header = splitMarkdownTableRow(lines[0]);
  const aligns = splitMarkdownTableRow(lines[1]).map((cell) => {
    const c = cell.trim();
    if (c.startsWith(":") && c.endsWith(":")) return "center" as const;
    if (c.endsWith(":")) return "right" as const;
    return "left" as const;
  });
  const body = lines.slice(2).map(splitMarkdownTableRow);
  return (
    <div className="md-table-wrap">
      <table className="md-table">
        <thead>
          <tr>{header.map((h, i) => <th key={i} style={{ textAlign: aligns[i] ?? "left" }}><InlineMarkdown text={h} /></th>)}</tr>
        </thead>
        <tbody>
          {body.map((row, i) => (
            <tr key={i}>
              {header.map((_, j) => <td key={j} style={{ textAlign: aligns[j] ?? "left" }}><InlineMarkdown text={row[j] ?? ""} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MarkdownView({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  const nodes: ReactNode[] = [];
  let list: string[] = [];
  let code: string[] | null = null;
  const flushList = () => {
    if (list.length) {
      nodes.push(
        <ul key={`ul-${nodes.length}`} className="md-list">
          {list.map((item, i) => <li key={i}><InlineMarkdown text={item} /></li>)}
        </ul>,
      );
      list = [];
    }
  };
  let idx = 0;
  while (idx < lines.length) {
    const line = lines[idx];
    if (line.trim().startsWith("```")) {
      if (code) {
        nodes.push(<pre key={`code-${nodes.length}`} className="pre md-code"><code>{code.join("\n")}</code></pre>);
        code = null;
      } else {
        flushList();
        code = [];
      }
      idx += 1;
      continue;
    }
    if (code) {
      code.push(line);
      idx += 1;
      continue;
    }
    if (isTableStart(lines, idx)) {
      flushList();
      const tableLines = [lines[idx], lines[idx + 1]];
      idx += 2;
      while (idx < lines.length && lines[idx].trim().includes("|") && lines[idx].trim() !== "") {
        tableLines.push(lines[idx]);
        idx += 1;
      }
      nodes.push(<MarkdownTable key={`table-${nodes.length}`} lines={tableLines} />);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushList();
      const level = h[1].length;
      const body = h[2];
      const id = slugifyHeading(body);
      const cls = "md-heading";
      if (level === 1) nodes.push(<h1 key={idx} id={id} className={cls}>{body}</h1>);
      else if (level === 2) nodes.push(<h2 key={idx} id={id} className={cls}>{body}</h2>);
      else if (level === 3) nodes.push(<h3 key={idx} id={id} className={cls}>{body}</h3>);
      else nodes.push(<h4 key={idx} id={id} className={cls}>{body}</h4>);
      idx += 1;
      continue;
    }
    const li = line.match(/^[-*]\s+(.*)$/);
    if (li) {
      list.push(li[1]);
      idx += 1;
      continue;
    }
    if (line.trim() === "") {
      flushList();
      nodes.push(<br key={idx} />);
      idx += 1;
      continue;
    }
    flushList();
    nodes.push(<p key={idx} className="md-p"><InlineMarkdown text={line} /></p>);
    idx += 1;
  }
  flushList();
  const remainingCode = code as string[] | null;
  if (remainingCode !== null) nodes.push(<pre key={`code-${nodes.length}`} className="pre md-code"><code>{remainingCode.join("\n")}</code></pre>);
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
