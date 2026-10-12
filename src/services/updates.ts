import { useEffect, useState } from 'react';
import type { UpdateStatus } from '../types';
import { api } from './api';

/** The app updater's current state, kept live by the main process. */
export function useUpdateStatus(): UpdateStatus {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'unsupported' });
  useEffect(() => {
    let live = true;
    api()
      .updates.status()
      .then((s) => {
        if (live) setStatus(s);
      })
      .catch(() => undefined);
    const off = api().updates.onStatus(setStatus);
    return () => {
      live = false;
      off();
    };
  }, []);
  return status;
}
