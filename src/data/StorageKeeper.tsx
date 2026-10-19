/**
 * Says so when writes to the phone stop landing.
 *
 * saveDB() used to swallow a failed write outright: the app kept working for
 * the rest of the session, but whatever had just been rung up only ever
 * existed in memory, gone the moment the app closed, with nothing on screen
 * to say it hadn't been kept. This turns a run of failures (storage full,
 * permission revoked — see storage.ts) into a toast instead of a silent
 * loss, and tells the operator again once writes recover.
 */
import { useEffect, useRef } from 'react';
import { onSaveStatus, currentSaveStatus, oldBookUnreadable } from './storage';
import { useToast } from '../components/Toast';

export default function StorageKeeper() {
  const { error: toastError, success: toastSuccess } = useToast();
  const wasFailing = useRef(currentSaveStatus() === 'failing');
  /* The books saved the old way were too large for Android to read back.
     They are not lost from the cloud: say so plainly instead of letting the
     phone look like a new shop. */
  useEffect(() => {
    if (oldBookUnreadable()) {
      toastError('The books saved on this phone earlier are too large to open. Sign in with the business account to bring them back from the cloud.');
    }
  }, [toastError]);

  useEffect(() => onSaveStatus((status) => {
    if (status === 'failing' && !wasFailing.current) {
      wasFailing.current = true;
      toastError('Changes are not being saved on this phone. Free up storage space, then reopen the app.');
    } else if (status === 'ok' && wasFailing.current) {
      wasFailing.current = false;
      toastSuccess('Saving is working again.');
    }
  }), [toastError, toastSuccess]);

  return null;
}
