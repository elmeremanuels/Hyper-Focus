// A trash can on a card. The first tap shows a question on the card itself; only the second deletes.
import { T } from '../texts';
import { useSubmit } from '../useSubmit';
import { Button } from './Button';

export function TrashButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="rounded-lg p-2 text-muted hover:bg-ink/5 hover:text-ink">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0-1 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 6m4 5v6m4-6v6" />
      </svg>
    </button>
  );
}

export function ConfirmDelete({ label, question, onDelete, onCancel }: { label: string; question: string; onDelete: () => Promise<void>; onCancel: () => void }) {
  const { busy, failed, run } = useSubmit(onCancel);
  return (
    <div role="alertdialog" aria-label={label} className="mt-3 rounded-lg border-2 border-ink bg-paper p-3">
      <p className="text-sm">{question}</p>
      {failed && <p className="mt-1 text-sm font-semibold">{T.error}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="strong" disabled={busy} onClick={() => void run(onDelete)()}>
          {T.projects.delete}
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          {T.cancel}
        </Button>
      </div>
    </div>
  );
}
