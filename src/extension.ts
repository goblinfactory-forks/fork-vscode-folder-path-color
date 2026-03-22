import * as vscode from 'vscode';
import * as path from 'path';
import { minimatch } from 'minimatch';

const namedColorMap: Record<string, string> = {
  blue: 'terminal.ansiBlue',
  magenta: 'terminal.ansiBrightMagenta',
  red: 'terminal.ansiBrightRed',
  cyan: 'terminal.ansiBrightCyan',
  green: 'terminal.ansiBrightGreen',
  yellow: 'terminal.ansiBrightYellow',
  custom1: 'folderPathColor.custom1',
  custom2: 'folderPathColor.custom2',
  custom3: 'folderPathColor.custom3',
  custom4: 'folderPathColor.custom4',
  custom5: 'folderPathColor.custom5',
  custom6: 'folderPathColor.custom6',
};

const HEX_SLOTS = [
  'folderPathColor.custom1',
  'folderPathColor.custom2',
  'folderPathColor.custom3',
  'folderPathColor.custom4',
  'folderPathColor.custom5',
  'folderPathColor.custom6',
];

const HEX_REGEX = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

class ColorDecorationProvider implements vscode.FileDecorationProvider {
  private readonly _onDidChangeFileDecorations: vscode.EventEmitter<
    vscode.Uri | vscode.Uri[] | undefined
  > = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  public readonly onDidChangeFileDecorations: vscode.Event<
    vscode.Uri | vscode.Uri[] | undefined
  > = this._onDidChangeFileDecorations.event;

  private folders: {
    path: string;
    colorId: string;
    symbol?: string;
    tooltip?: string;
  }[] = [];

  async constructFolders() {
    this.folders = [];
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const config = vscode.workspace.getConfiguration('folder-path-color', workspaceFolder?.uri);
    const folderConfigs: {
      path: string;
      color?: string;
      symbol?: string;
      tooltip?: string;
    }[] = config.get('folders') || [];

    const autoColors = Object.keys(namedColorMap).filter((k) => !k.startsWith('custom'));
    let autoIndex = 0;
    let hexSlotIndex = 0;
    const hexColorCustomizations: Record<string, string> = {};

    for (const folder of folderConfigs) {
      let colorId: string;

      if (!folder.color) {
        colorId = namedColorMap[autoColors[autoIndex % autoColors.length]];
        autoIndex++;
      } else if (HEX_REGEX.test(folder.color)) {
        if (hexSlotIndex < HEX_SLOTS.length) {
          const slot = HEX_SLOTS[hexSlotIndex++];
          hexColorCustomizations[slot] = folder.color;
          colorId = slot;
        } else {
          colorId = namedColorMap[autoColors[0]];
        }
      } else {
        colorId = namedColorMap[folder.color] ?? namedColorMap['blue'];
      }

      this.folders.push({
        path: folder.path,
        colorId,
        symbol: folder.symbol,
        tooltip: folder.tooltip,
      });
    }

    await this.syncColorCustomizations(hexColorCustomizations);
  }

  private async syncColorCustomizations(hexColors: Record<string, string>) {
    try {
      const config = vscode.workspace.getConfiguration();
      const existing = config.get<Record<string, string>>('workbench.colorCustomizations') ?? {};

      const updated: Record<string, string> = {};
      for (const [key, value] of Object.entries(existing)) {
        if (!key.startsWith('folderPathColor.custom')) {
          updated[key] = value;
        }
      }
      Object.assign(updated, hexColors);

      await config.update(
        'workbench.colorCustomizations',
        Object.keys(updated).length > 0 ? updated : undefined,
        vscode.ConfigurationTarget.Workspace
      );
    } catch {
      // No workspace open or write not permitted — silently skip
    }
  }

  constructor() {
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('folder-path-color.folders')) {
        this.constructFolders().then(() => {
          this._onDidChangeFileDecorations.fire(undefined);
        });
      }
    });
    this.constructFolders().then(() => {
      this._onDidChangeFileDecorations.fire(undefined);
    });
  }

  provideFileDecoration(
    uri: vscode.Uri,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.FileDecoration> {
    if (!vscode.workspace.workspaceFolders) return undefined;

    const workspacePaths = vscode.workspace.workspaceFolders.map((f) => f.uri.path);

    for (const folder of this.folders) {
      const pathIsInConfig = workspacePaths.some((root) => {
        const normalizedUriPath = uri.path.replace(/\\/g, '/');
        const fullPath = path.join(root, folder.path).replace(/\\/g, '/');
        const hasGlob = /[\*\?\[\]]/.test(folder.path);

        if (hasGlob) {
          const relativePath = path.relative(root, uri.fsPath).replace(/\\/g, '/');
          return minimatch(relativePath, folder.path, { matchBase: true });
        }

        return normalizedUriPath.includes(fullPath);
      });

      if (pathIsInConfig) {
        return new vscode.FileDecoration(
          folder.symbol,
          folder.tooltip,
          new vscode.ThemeColor(folder.colorId)
        );
      }
    }

    return undefined;
  }
}

export function activate(context: vscode.ExtensionContext) {
  const provider = new ColorDecorationProvider();
  context.subscriptions.push(vscode.window.registerFileDecorationProvider(provider));
}
