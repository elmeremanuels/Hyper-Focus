// Form fields in the house style: a label above, a 2 px border.
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

const FIELD = 'mt-1 w-full rounded-lg border-2 border-ink bg-card px-3 py-2 text-base';

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col text-sm font-semibold">
      {label}
      {children}
    </label>
  );
}

export const Input = (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} className={`${FIELD} font-normal`} />;
export const Select = (props: SelectHTMLAttributes<HTMLSelectElement>) => <select {...props} className={`${FIELD} font-normal`} />;
export const Textarea = (props: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea rows={4} {...props} className={`${FIELD} font-normal`} />;

export function Badge({ children, tone = 'plain' }: { children: string; tone?: 'plain' | 'accent' }) {
  return (
    <span className={`rounded-full border-2 border-ink px-2 py-0.5 text-xs font-semibold ${tone === 'accent' ? 'bg-accent-soft' : 'bg-card'}`}>{children}</span>
  );
}
