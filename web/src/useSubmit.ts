import { useState, type FormEvent } from 'react';

/** Actions that send once, show a short error and close the form on success. */
export function useSubmit(done: () => void = () => undefined) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const run = (action: () => Promise<unknown>) => async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setFailed(false);
    try {
      await action();
      done();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return { busy, failed, run };
}
