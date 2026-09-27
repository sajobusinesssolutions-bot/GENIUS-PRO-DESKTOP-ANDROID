/**
 * Takes the scheduled device backup.
 *
 * Scheduled backups used to be taken only when someone opened Data tools,
 * and as plain JSON. This checks when the app opens and every half hour
 * after, and writes an encrypted .sa file when one is due.
 */
import { useEffect, useRef } from 'react';
import { useAppData } from './AppDataContext';
import { backupDue, writeBackup } from './deviceBackup';

const CHECK_MS = 30 * 60 * 1000;

export default function BackupKeeper() {
  const { db, setSetting } = useAppData();
  const dbRef = useRef(db);
  dbRef.current = db;
  // held in a ref so a new function identity each render does not restart the timers
  const setRef = useRef(setSetting);
  setRef.current = setSetting;

  useEffect(() => {
    const check = () => {
      const d = dbRef.current;
      if (!d || !backupDue(d.settings.backupSchedule, d.settings.lastBackupAt)) return;
      try {
        writeBackup(d, true);
        setRef.current({ lastBackupAt: new Date().toISOString() });
      } catch {
        // a backup that fails is retried on the next check; it must never stop the till
      }
    };
    const first = setTimeout(check, 5000);
    const every = setInterval(check, CHECK_MS);
    return () => { clearTimeout(first); clearInterval(every); };
  }, []);

  return null;
}
