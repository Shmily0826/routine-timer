// 版本号只在正式版有值，开发版/体验版返回空字符串，所以环境名要一起显示，
// 否则截图反馈时只能看到一个空白的版本行。
const ENV_LABEL: Record<string, string> = {
  develop: '开发版',
  trial: '体验版',
  release: '正式版',
};

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

Page({
  data: {
    version: '',
  },

  onLoad() {
    this.setData({ version: readVersion() });
  },
});
