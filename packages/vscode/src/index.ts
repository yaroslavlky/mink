type Disposable = { dispose(): unknown };
type ExtensionContext = { subscriptions: Disposable[] };
type VSCode = {
  commands: { registerCommand(id: string, callback: (...args: unknown[]) => unknown): Disposable };
  window: {
    createTreeView(id: string, options: { treeDataProvider: TreeProvider }): Disposable;
    createTerminal(options: { name: string; cwd?: string }): {
      show(): void;
      sendText(text: string): void;
    };
    showQuickPick(items: string[], options?: { placeHolder?: string }): Promise<string | undefined>;
    showInformationMessage(message: string): unknown;
  };
  workspace: { workspaceFolders?: Array<{ uri: { fsPath: string } }> };
  EventEmitter: new <T>() => { event: unknown; fire(value?: T): void; dispose(): void };
  TreeItem: new (label: string) => {
    command?: { command: string; title: string; arguments: unknown[] };
  };
};
interface TreeProvider {
  onDidChangeTreeData: unknown;
  getTreeItem(item: unknown): unknown;
  getChildren(): Promise<unknown[]>;
}

export async function activate(context: ExtensionContext): Promise<void> {
  const vscode = (await Function('return import("vscode")')()) as VSCode;
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const changes = new vscode.EventEmitter<void>();
  const provider: TreeProvider = {
    onDidChangeTreeData: changes.event,
    getTreeItem: (item) => item,
    async getChildren() {
      const output = await command(cwd, ['list', '--json']);
      const entries = JSON.parse(output) as Array<{ id: string; name: string }>;
      return entries.map((entry) => {
        const item = new vscode.TreeItem(`${entry.name} (${entry.id})`);
        item.command = { command: 'mink.run', title: 'Run', arguments: [entry.id] };
        return item;
      });
    },
  };
  context.subscriptions.push(
    vscode.window.createTreeView('mink.commands', { treeDataProvider: provider }),
  );
  context.subscriptions.push(vscode.commands.registerCommand('mink.refresh', () => changes.fire()));
  context.subscriptions.push(
    vscode.commands.registerCommand('mink.run', async (selected?: unknown) => {
      const id = typeof selected === 'string' ? selected : await choose(vscode, cwd);
      if (id) terminal(vscode, cwd, ['run', id]);
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('mink.services', async () => {
      vscode.window.showInformationMessage(await command(cwd, ['attach', '--json']));
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('mink.logs', async () => {
      const id = await choose(vscode, cwd);
      if (id) terminal(vscode, cwd, ['logs', id, '--follow']);
    }),
  );
}
export function deactivate(): void {}
async function choose(vscode: VSCode, cwd?: string): Promise<string | undefined> {
  const entries = JSON.parse(await command(cwd, ['list', '--json'])) as Array<{ id: string }>;
  return vscode.window.showQuickPick(
    entries.map((entry) => entry.id),
    { placeHolder: 'Mink command' },
  );
}
function terminal(vscode: VSCode, cwd: string | undefined, args: string[]): void {
  const instance = vscode.window.createTerminal({ name: 'Mink', cwd });
  instance.show();
  instance.sendText(['mink', ...args].map(shellWord).join(' '));
}
async function command(cwd: string | undefined, args: string[]): Promise<string> {
  const { execFile } = await import('node:child_process');
  return new Promise((resolve, reject) =>
    execFile('mink', args, { cwd, encoding: 'utf8', maxBuffer: 1024 * 1024 }, (error, stdout) =>
      error ? reject(error) : resolve(stdout),
    ),
  );
}
function shellWord(value: string): string {
  return /^[A-Za-z0-9_./:-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}
