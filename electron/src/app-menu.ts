import type { MenuItemConstructorOptions } from 'electron';

export function buildAppMenuTemplate(
  platform: NodeJS.Platform,
  onInstallCliToPath: () => void | Promise<void>,
): MenuItemConstructorOptions[] {
  const installCliItem: MenuItemConstructorOptions = {
    label: 'Install CLI to PATH',
    click: () => {
      void onInstallCliToPath();
    },
  };

  const fileMenu: MenuItemConstructorOptions = {
    label: 'File',
    submenu: [installCliItem, { type: 'separator' }, { role: platform === 'darwin' ? 'close' : 'quit' }],
  };

  const editMenu: MenuItemConstructorOptions = {
    label: 'Edit',
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
    label: 'View',
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
