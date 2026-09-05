// 版本号只在正式版有值，开发版/体验版返回空字符串，所以环境名要一起显示，
// 否则截图反馈时只能看到一个空白的版本行。
import {
  ACTIVE_ROUNDS_KEY,
  SESSION_KEY,
  ROUTINES_KEY,
  PREFS_KEY,
  HISTORY_KEY,
  parseSession,
} from '../../domain/storage';

const ENV_LABEL: Record<string, string> = {
  develop: '开发版',
  trial: '体验版',
  release: '正式版',
};

// The backup is a flat bag of the storage keys; every key is optional so a
// partial backup (e.g. only routines) still restores cleanly.
const BACKUP_KEYS = [ACTIVE_ROUNDS_KEY, SESSION_KEY, ROUTINES_KEY, PREFS_KEY, HISTORY_KEY];

function readVersion(): string {
  try {
    const info = wx.getAccountInfoSync();
    const mini = info && info.miniProgram;
    if (!mini) return '';
    const env = ENV_LABEL[mini.envVersion] || mini.envVersion || '';
    return mini.version ? `${mini.version}（${env}）` : env;
  } catch {
    return '';
  }
}

function buildBackup(): string {
  const data: Record<string, unknown> = {};
  for (const k of BACKUP_KEYS) {
    const v = wx.getStorageSync(k);
    // getStorageSync returns '' for a missing key; store null so the JSON is
    // explicit about "no value" rather than collapsing to an empty string.
    data[k] = v === '' ? null : v;
  }
  return JSON.stringify({
    app: 'routine-timer',
    version: 1,
    exportedAt: Date.now(),
    data,
  });
}

function validateBackup(data: any): boolean {
  if (!data || typeof data !== 'object') return false;
  let seen = 0;
  for (const k of BACKUP_KEYS) {
    if (!(k in data)) continue;
    seen++;
    const v = data[k];
    if (k === ROUTINES_KEY) {
      // On load the app normalises routines, but an export of a non-array would
      // break that path — reject early so a bad backup never overwrites good data.
      if (!Array.isArray(v)) return false;
    } else if (k === SESSION_KEY) {
      if (v !== null && v !== undefined && !parseSession(v)) return false;
    } else if (k === HISTORY_KEY) {
      if (!Array.isArray(v)) return false;
    }
  }
  return seen > 0;
}

function writeBackup(data: any): void {
  for (const k of BACKUP_KEYS) {
    if (k in data) wx.setStorageSync(k, data[k]);
  }
}

function toast(title: string): void {
  wx.showToast({ title, icon: 'none' });
}

Page({
  data: {
    version: '',
  },

  onLoad() {
    this.setData({ version: readVersion() });
  },

  exportData() {
    const json = buildBackup();
    wx.setClipboardData({
      data: json,
      success: () => toast('已复制到剪贴板'),
      fail: () => toast('导出失败'),
    });
  },

  importData() {
    wx.getClipboardData({
      success: (res: any) => {
        let parsed: any = null;
        try {
          parsed = JSON.parse(res.data);
        } catch {
          parsed = null;
        }
        // Accept both the wrapped backup and a raw bag of storage keys.
        const data =
          parsed && parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed;
        if (!validateBackup(data)) {
          toast('剪贴板不是有效的备份');
          return;
        }
        wx.showModal({
          title: '导入数据',
          content: '将用备份覆盖当前的 Routine、偏好和历史记录，现有数据会被替换。',
          success: (r: any) => {
            if (r.confirm) {
              writeBackup(data);
              toast('导入成功');
            }
          },
        });
      },
      fail: () => toast('无法读取剪贴板'),
    });
  },
});
