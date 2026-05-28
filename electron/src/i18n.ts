type SupportedLocale = 'en' | 'zh';

let currentLocale: SupportedLocale = 'en';

const translations: Record<SupportedLocale, Record<string, string>> = {
  en: {
    'menu.file': 'File',
    'menu.edit': 'Edit',
    'menu.view': 'View',
    'menu.installCli': 'Install CLI to PATH',
    'context.copyLink': 'Copy Link',
    'context.openInBrowser': 'Open Link in Browser',
    'dialog.cliInstalled': 'Ropcode CLI installed to PATH',
    'dialog.cliInstalledDetail': 'CLI installed at {{linkPath}}. PATH update saved{{profileNote}}.',
    'dialog.cliInstalledDetailSimple': 'CLI installed at {{linkPath}}.',
    'dialog.cliFailed': 'Failed to install Ropcode CLI to PATH',
    'dialog.ok': 'OK',
  },
  zh: {
    'menu.file': '文件',
    'menu.edit': '编辑',
    'menu.view': '视图',
    'menu.installCli': '安装 CLI 到 PATH',
    'context.copyLink': '复制链接',
    'context.openInBrowser': '在浏览器中打开链接',
    'dialog.cliInstalled': 'Ropcode CLI 已安装到 PATH',
    'dialog.cliInstalledDetail': 'CLI 已安装到 {{linkPath}}。PATH 更新已保存{{profileNote}}。',
    'dialog.cliInstalledDetailSimple': 'CLI 已安装到 {{linkPath}}。',
    'dialog.cliFailed': '安装 Ropcode CLI 到 PATH 失败',
    'dialog.ok': '确定',
  },
};

export function setLocale(locale: SupportedLocale): void {
  currentLocale = locale;
}

export function getLocale(): SupportedLocale {
  return currentLocale;
}

export function t(key: string, params?: Record<string, string>): string {
  let text = translations[currentLocale][key] ?? translations.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{{${k}}}`, v);
    }
  }
  return text;
}
