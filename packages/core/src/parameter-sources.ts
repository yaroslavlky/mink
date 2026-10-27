import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { glob } from 'tinyglobby';
const execute = promisify(execFile);

export async function parameterSource(
  source: 'git_branches' | 'git_tags' | 'docker_contexts' | 'kubectl_contexts' | 'files' | 'exec',
  directory: string,
  specification?: { pattern?: string; executable?: string; args?: string[] },
): Promise<string[]> {
  if (source === 'files')
    return glob(specification?.pattern ?? '*', { cwd: directory, onlyFiles: true });
  let executable: string;
  let args: string[];
  if (source === 'git_branches')
    [executable, args] = ['git', ['branch', '--format=%(refname:short)']];
  else if (source === 'git_tags') [executable, args] = ['git', ['tag', '--list']];
  else if (source === 'docker_contexts')
    [executable, args] = ['docker', ['context', 'ls', '--format', '{{.Name}}']];
  else if (source === 'kubectl_contexts')
    [executable, args] = ['kubectl', ['config', 'get-contexts', '-o', 'name']];
  else {
    if (!specification?.executable) throw new Error('exec parameter source requires executable');
    [executable, args] = [specification.executable, specification.args ?? []];
  }
  const { stdout } = await execute(executable, args, { cwd: directory, encoding: 'utf8' });
  return [
    ...new Set(
      stdout
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}
