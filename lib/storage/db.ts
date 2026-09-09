export const DB_NAME = 'northbound-roadbook';
let connection: Promise<IDBDatabase> | undefined;
export function openDatabase(): Promise<IDBDatabase> {
  if (connection) return connection;
  connection = new Promise<IDBDatabase>((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('此浏览器无法使用本地存储，请更换浏览器'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('state');
      db.createObjectStore('routes', { keyPath: 'key' });
      db.createObjectStore('backups', { keyPath: 'id' });
    };
    req.onerror = () => reject(req.error || new Error('无法打开本地路书'));
    req.onblocked = () => reject(new Error('请关闭其他路书窗口后重试'));
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        connection = undefined;
      };
      resolve(db);
    };
  }).catch((e) => {
    connection = undefined;
    throw e;
  });
  return connection;
}
export function transactionResult<T>(
  tx: IDBTransaction,
  result: () => T,
  error?: () => Error | undefined,
): Promise<T> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => {
      try {
        resolve(result());
      } catch (e) {
        reject(e);
      }
    };
    tx.onabort = () =>
      reject(error?.() || tx.error || new Error('保存未完成，请导出备份'));
    tx.onerror = () => {};
  });
}
