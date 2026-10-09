import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'plain' | 'quiet' | 'strong';
const STYLES: Record<Variant, string> = {
  primary: 'bg-accent text-white border-ink',
  plain: 'bg-card text-ink border-ink',
  quiet: 'bg-transparent text-ink border-transparent underline underline-offset-4',
  /** For an action that cannot be undone. */
  strong: 'bg-ink text-paper border-ink',
};

export function Button({ variant = 'plain', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...props}
      className={`rounded-xl border-2 px-4 py-2 text-sm font-semibold disabled:opacity-50 ${STYLES[variant]} ${className}`}
    />
  );
}

export function LinkButton({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="rounded-xl border-2 border-ink bg-accent-soft px-4 py-2 text-sm font-semibold">
      {children}
    </a>
  );
}
