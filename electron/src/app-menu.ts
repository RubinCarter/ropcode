import type { MenuItemConstructorOptions } from 'electron';
import { t } from './i18n';

export function buildAppMenuTemplate(
  platform: NodeJS.Platform,
  onInstallCliToPath: () => void | Promise<void>,
): MenuItemConstructorOptions[] {
  const installCliItem: MenuItemConstructorOptions = {
    label: t('menu.installCli'),
    click: () => {
      void onInstallCliToPath();
    },
  };

  const fileMenu: MenuItemConstructorOptions = {
    label: t('menu.file'),
    submenu: [installCliItem, { type: 'separator' }, { role: platform === 'darwin' ? 'close' : 'quit' }],
  };

  const editMenu: MenuItemConstructorOptions = {
    label: t('menu.edit'),
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
    ],
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: t('menu.view'),
    submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }],
  };

  const helpMenu: MenuItemConstructorOptions = {
    role: 'help',
    submenu: [installCliItem],
  };

  if (platform === 'darwin') {
    return [
      {
        role: 'appMenu',
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          installCliItem,
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      fileMenu,
      editMenu,
      viewMenu,
      { role: 'windowMenu' },
      helpMenu,
    ];
  }

  return [fileMenu, editMenu, viewMenu, helpMenu];
}
