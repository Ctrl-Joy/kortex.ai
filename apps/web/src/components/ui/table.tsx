import * as React from "react";
import { cn } from "@/lib/utils";

export function Table({ className, ...props }: React.HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full border-collapse text-[13px]", className)} {...props} />
    </div>
  );
}

export function THead(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead {...props} />;
}

export function TBody(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}

export function TR({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("border-b border-line/70 last:border-0 transition-colors", className)} {...props} />;
}

export function TH({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "border-b border-line bg-surface-2/60 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-subtle whitespace-nowrap",
        className,
      )}
      {...props}
    />
  );
}

export function TD({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-4 py-3 align-middle text-fg", className)} {...props} />;
}

export function Pagination({
  total,
  limit,
  offset,
  onChange,
}: {
  total: number;
  limit: number;
  offset: number;
  onChange: (offset: number) => void;
}) {
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-[13px] text-muted">
      <span className="num">
        {total === 0 ? "No results" : `${offset + 1}–${Math.min(offset + limit, total)} of ${total}`}
      </span>
      <div className="flex items-center gap-1">
        <button
          className="cursor-pointer rounded-md px-2.5 py-1 hover:bg-surface-2 hover:text-fg disabled:cursor-default disabled:opacity-40"
          disabled={page <= 1}
          onClick={() => onChange(Math.max(0, offset - limit))}
        >
          Previous
        </button>
        <span className="num px-1">
          {page} / {pages}
        </span>
        <button
          className="cursor-pointer rounded-md px-2.5 py-1 hover:bg-surface-2 hover:text-fg disabled:cursor-default disabled:opacity-40"
          disabled={page >= pages}
          onClick={() => onChange(offset + limit)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
