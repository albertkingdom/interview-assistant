export const saveInterviewRecordToStorage = (storageKey, record) => {
  try {
    const raw = localStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) : [];
    const records = Array.isArray(parsed) ? parsed : [];
    const next = [record, ...records];
    localStorage.setItem(storageKey, JSON.stringify(next));
  } catch (err) {
    console.error(err);
    throw new Error("儲存面試紀錄失敗");
  }
};
