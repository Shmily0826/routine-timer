import { HISTORY_KEY } from '../../domain/storage';

function fmtDur(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m ? `${m}分${r ? r + '秒' : ''}` : `${r}秒`;
}
function fmtDate(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

interface HistoryRecord {
  id: string;
  ts: number;
  rounds: number;
  totalWorkSec: number;
  totalRestSec: number;
  label: string;
}
interface Stats {
  count: number;
  rounds: number;
  duration: string;
}

Page({
  data: { items: [] as any[], stats: null as Stats | null },
  records: [] as HistoryRecord[],
  onShow() {
    this.load();
  },
  load() {
    try {
      const x = wx.getStorageSync(HISTORY_KEY);
      // Keep the raw records for mutations: data.items below are display-shaped
      // (durations pre-formatted), so writing them back to storage would lose
      // totalWorkSec/totalRestSec.
      this.records = Array.isArray(x) ? x.slice().sort((a: any, b: any) => b.ts - a.ts) : [];
      const count = this.records.length;
      const rounds = this.records.reduce((a: number, r: HistoryRecord) => a + (r.rounds || 0), 0);
      const sec = this.records.reduce(
        (a: number, r: HistoryRecord) => a + (r.totalWorkSec || 0) + (r.totalRestSec || 0),
        0,
      );
      this.setData({
        items: this.records.map((r: HistoryRecord) => ({
          id: r.id,
          label: r.label,
          rounds: r.rounds,
          work: fmtDur(r.totalWorkSec || 0),
          rest: fmtDur(r.totalRestSec || 0),
          total: fmtDur((r.totalWorkSec || 0) + (r.totalRestSec || 0)),
          date: fmtDate(r.ts),
        })),
        stats: { count, rounds, duration: fmtDur(sec) },
      });
    } catch {
      this.records = [];
      this.setData({ items: [], stats: null });
    }
  },
  clear() {
    wx.showModal({
      title: '清空历史',
      content: '确定清空全部训练记录？此操作不可恢复。',
      success: (r: any) => {
        if (r.confirm) {
          wx.removeStorageSync(HISTORY_KEY);
          this.load();
        }
      },
    });
  },
  remove(e: any) {
    const rec = this.records[e.currentTarget.dataset.index];
    if (!rec) return;
    wx.setStorageSync(
      HISTORY_KEY,
      this.records.filter((r: HistoryRecord) => r.id !== rec.id),
    );
    this.load();
  },
});
