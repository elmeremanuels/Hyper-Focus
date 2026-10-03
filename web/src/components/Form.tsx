// Form fields in the house style: a label above, a 2 px border.
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { T } from '../texts';
import { Button } from './Button';

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

/** Save and cancel under a form, with a short error when sending failed. */
export function FormActions({ busy, failed, onCancel, label = T.save }: { busy: boolean; failed: boolean; onCancel: () => void; label?: string }) {
  return (
    <>
      {failed && <p className="text-sm font-semibold">{T.error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={busy}>
          {label}
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          {T.cancel}
        </Button>
      </div>
    </>
  );
}
