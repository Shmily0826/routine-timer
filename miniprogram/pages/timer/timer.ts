import {
  createSession,
  reconcile,
  pause,
  resume,
  next,
  previous,
  SessionSnapshot,
} from '../../domain/timer';
import { SESSION_KEY, ACTIVE_ROUNDS_KEY, HISTORY_KEY } from '../../domain/storage';
function fmtDur(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m ? `${m}分${r ? r + '秒' : ''}` : `${r}秒`;
}
Page({
  data: {
    phase: 'work',
    name: '',
    group: 1,
    total: 1,
    display: '00:00',
    next: '完成',
    paused: false,
    completed: false,
    summary: null as any,
  } as any,
  session: null as SessionSnapshot | null,
  tickId: 0,
  audio: null as any,
  recorded: false,
  _cueKey: undefined as any,
  _cdKey: null as any,
  _audioWarned: false,
  onLoad() {
    this.recorded = false;
    const saved = wx.getStorageSync(SESSION_KEY);
    this.session =
      saved && saved.status !== 'completed'
        ? saved
        : createSession(
            wx.getStorageSync(ACTIVE_ROUNDS_KEY) || [{ name: '动作 1', workSec: 30, restSec: 10 }],
          );
    this.audio = wx.createInnerAudioContext();
    this.audio.src = '/assets/cue.wav';
    this.audio.onError((e: any) => {
      if (!this._audioWarned) {
        this._audioWarned = true;
        console.warn('cue audio play failed:', e && (e.errMsg || e));
      }
    });
    wx.setInnerAudioOption({ obeyMuteSwitch: false });
    wx.setKeepScreenOn({ keepScreenOn: true });
    this.persist();
    this.render();
  },
  onShow() {
    if (this.tickId) clearInterval(this.tickId);
    this.render();
    this.tickId = setInterval(() => this.render(), 250) as any;
  },
  onHide() {
    clearInterval(this.tickId);
    this.tickId = 0;
    this.persist();
  },
  persist() {
    if (this.session) wx.setStorageSync(SESSION_KEY, this.session);
  },
  cue() {
    try {
      wx.vibrateShort({ type: 'medium' });
    } catch {}
    try {
      this.audio?.stop();
      this.audio?.play();
    } catch {}
  },
  render() {
    if (!this.session) return;
    const v = reconcile(this.session, Date.now());
    this.session = v.session;
    const _pk = this._cueKey;
    const _k =
      this.session.status === 'completed'
        ? 'completed'
        : this.session.phase + '#' + this.session.currentRoundIndex;
    if (_pk !== undefined && _pk !== null && _pk !== _k) this.cue();
    this._cueKey = _k;
    const sec = Math.ceil(v.remainingMs / 1000);
    const cdK =
      this.session.status === 'running' && sec > 0 && sec <= 3
        ? `cd#${this.session.phase}#${this.session.currentRoundIndex}#${sec}`
        : null;
    if (cdK && cdK !== this._cdKey) {
      this._cdKey = cdK;
      try {
        wx.vibrateShort({ type: 'light' });
      } catch {}
    } else if (!cdK) this._cdKey = null;
    const r = this.session.rounds[this.session.currentRoundIndex];
    const n = this.session.rounds[this.session.currentRoundIndex + 1];
    const _nx: any = {
      phase: this.session.phase,
      name:
        this.session.phase === 'rest'
          ? '休息'
          : r.name || `第${this.session.currentRoundIndex + 1}组`,
      group: this.session.currentRoundIndex + 1,
      total: this.session.rounds.length,
      display: `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`,
      next: n?.name || '完成',
      paused: this.session.status === 'paused',
      completed: this.session.status === 'completed',
    };
    const _cur: any = this.data;
    const _d: any = {};
    for (const _k2 in _nx) {
      if (_cur[_k2] !== _nx[_k2]) _d[_k2] = _nx[_k2];
    }
    if (Object.keys(_d).length) this.setData(_d);
    if (this.session.status === 'completed') {
      clearInterval(this.tickId);
      this.tickId = 0;
      if (!this.recorded) {
        this.recorded = true;
        try {
          const rs = this.session.rounds;
          const tw = rs.reduce((a: any, r: any) => a + (r.workSec || 0), 0);
          const tr = rs.reduce((a: any, r: any) => a + (r.restSec || 0), 0);
          const rec = {
            id: String(Date.now()),
            ts: Date.now(),
            rounds: rs.length,
            totalWorkSec: tw,
            totalRestSec: tr,
            label: (rs[0] && rs[0].name) || '练习',
          };
          const hist = Array.isArray(wx.getStorageSync(HISTORY_KEY))
            ? wx.getStorageSync(HISTORY_KEY)
            : [];
          wx.setStorageSync(HISTORY_KEY, [rec, ...hist].slice(0, 100));
          this.setData({
            summary: {
              rounds: rs.length,
              work: fmtDur(tw),
              rest: fmtDur(tr),
              total: fmtDur(tw + tr),
            },
          });
        } catch {}
      }
      wx.setKeepScreenOn({ keepScreenOn: false });
      this.persist();
    }
  },
  toggle() {
    if (!this.session || this.session.status === 'completed') return;
    this.session = this.session.status === 'paused' ? resume(this.session) : pause(this.session);
    this.persist();
    this.render();
  },
  goNext() {
    if (this.session) {
      this.session = next(this.session);
      this.persist();
      this.render();
    }
  },
  goPrevious() {
    if (this.session) {
      this.session = previous(this.session);
      this.persist();
      this.render();
    }
  },
  again() {
    this.recorded = false;
    this.setData({ summary: null });
    this.session = createSession(this.session?.rounds || []);
    this.persist();
    this.render();
  },
  stop() {
    clearInterval(this.tickId);
    wx.setKeepScreenOn({ keepScreenOn: false });
    this.audio?.destroy();
    wx.removeStorageSync(SESSION_KEY);
    wx.navigateBack();
  },
  onUnload() {
    clearInterval(this.tickId);
    wx.setKeepScreenOn({ keepScreenOn: false });
    this.audio?.destroy();
  },
});
