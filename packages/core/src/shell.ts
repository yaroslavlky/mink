export type ShellName = 'bash' | 'zsh' | 'fish' | 'powershell';

export function shellCompletion(shell: ShellName): string {
  const commands =
    'ui list check run init preset favorite doctor plan watch why cache trust untrust env graph fmt lint explain summary choose completions shell-init upgrade config';
  if (shell === 'fish') return `complete -c mink -f -a '${commands}'`;
  if (shell === 'powershell')
    return `Register-ArgumentCompleter -Native -CommandName mink -ScriptBlock { param($wordToComplete) '${commands}'.Split(' ') | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_) } }`;
  const functionName = shell === 'zsh' ? '_mink' : '_mink_complete';
  const registration =
    shell === 'zsh' ? `compdef ${functionName} mink` : `complete -F ${functionName} mink`;
  return `${functionName}() { COMPREPLY=( $(compgen -W '${commands}' -- "${'$'}{COMP_WORDS[1]}") ); }\n${registration}`;
}

export function shellInit(shell: ShellName): string {
  const completion = shellCompletion(shell);
  return shell === 'powershell'
    ? `$env:MINK_SHELL='powershell'\n${completion}`
    : `export MINK_SHELL=${shell}\n${completion}`;
}
