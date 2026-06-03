package pty

import (
	_ "embed"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const shellIntegrationOSC = 16162

//go:embed shellintegration/bash_preexec.sh
var bashPreexecScript string

type shellIntegrationFiles struct {
	dir      string
	zdotdir  string
	bashRC   string
	fishInit string
	pwshInit string
}

func prepareShellIntegrationFiles(shellPath string) (*shellIntegrationFiles, error) {
	shellType := getShellType(shellPath)
	if shellType != ShellTypeZsh && shellType != ShellTypeBash && shellType != ShellTypeFish && shellType != ShellTypePowerShell {
		return nil, nil
	}
	dir, err := os.MkdirTemp("", "ropcode-shell-integration-*")
	if err != nil {
		return nil, err
	}
	files := &shellIntegrationFiles{dir: dir}
	if err := files.write(shellType); err != nil {
		files.cleanup()
		return nil, err
	}
	return files, nil
}

func (f *shellIntegrationFiles) write(shellType string) error {
	switch shellType {
	case ShellTypeZsh:
		f.zdotdir = f.dir
		if err := os.WriteFile(filepath.Join(f.zdotdir, ".zshenv"), []byte(zshShellIntegrationZshenv()), 0600); err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(f.zdotdir, ".zprofile"), []byte(zshShellIntegrationZprofile()), 0600); err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(f.zdotdir, ".zshrc"), []byte(zshShellIntegrationRC()), 0600); err != nil {
			return err
		}
		return os.WriteFile(filepath.Join(f.zdotdir, ".zlogin"), []byte(zshShellIntegrationZlogin()), 0600)
	case ShellTypeFish:
		f.fishInit = filepath.Join(f.dir, "ropcode.fish")
		return os.WriteFile(f.fishInit, []byte(fishShellIntegrationScript()), 0600)
	case ShellTypeBash:
		f.bashRC = filepath.Join(f.dir, "bashrc")
		if err := os.WriteFile(filepath.Join(f.dir, "bash_preexec.sh"), []byte(bashPreexecScript), 0600); err != nil {
			return err
		}
		return os.WriteFile(f.bashRC, []byte(bashShellIntegrationRC()), 0600)
	case ShellTypePowerShell:
		f.pwshInit = filepath.Join(f.dir, "ropcode.ps1")
		return os.WriteFile(f.pwshInit, []byte(powerShellIntegrationScript()), 0600)
	default:
		return nil
	}
}

func (f *shellIntegrationFiles) cleanup() {
	if f == nil || f.dir == "" {
		return
	}
	_ = os.RemoveAll(f.dir)
}

func zshShellIntegrationRC() string {
	var b strings.Builder
	b.WriteString("# Source the original zshrc only if ZDOTDIR has not been changed by user startup.\n")
	b.WriteString("if [ \"$ZDOTDIR\" = \"$ROPCODE_ZDOTDIR\" ]; then\n")
	b.WriteString("  [ -f ~/.zshrc ] && source ~/.zshrc\n")
	b.WriteString("fi\n")
	b.WriteString(zshShellIntegrationScript())
	return b.String()
}

func zshShellIntegrationZshenv() string {
	return `ROPCODE_ZDOTDIR="$ZDOTDIR"
[ -f ~/.zshenv ] && source ~/.zshenv
if [ "$ZDOTDIR" != "$ROPCODE_ZDOTDIR" ]; then
  [ -f "$ROPCODE_ZDOTDIR/.zshrc" ] && source "$ROPCODE_ZDOTDIR/.zshrc"
fi
`
}

func zshShellIntegrationZprofile() string {
	return `[ -f ~/.zprofile ] && source ~/.zprofile
`
}

func zshShellIntegrationZlogin() string {
	return `[ -f ~/.zlogin ] && source ~/.zlogin
if [ "$ZDOTDIR" = "$ROPCODE_ZDOTDIR" ]; then
  unset ZDOTDIR
fi
unset ROPCODE_ZDOTDIR
`
}

func bashShellIntegrationRC() string {
	home := os.Getenv("HOME")
	userBashrc := filepath.Join(home, ".bashrc")
	var b strings.Builder
	b.WriteString("[ -f /etc/profile ] && source /etc/profile\n")
	if _, err := os.Stat(userBashrc); err == nil {
		b.WriteString("source ")
		b.WriteString(shellQuote(userBashrc))
		b.WriteString("\n")
	}
	b.WriteString("__ropcode_si_bashrc_dir=\"$(cd \"$(dirname \"${BASH_SOURCE[0]}\")\" && pwd)\"\n")
	b.WriteString("if [ -z \"${bash_preexec_imported:-}\" ] && [ -f \"$__ropcode_si_bashrc_dir/bash_preexec.sh\" ]; then\n")
	b.WriteString("  source \"$__ropcode_si_bashrc_dir/bash_preexec.sh\"\n")
	b.WriteString("fi\n")
	b.WriteString("unset __ropcode_si_bashrc_dir\n")
	b.WriteString(bashShellIntegrationScript())
	return b.String()
}

func shellOSC(command, payload string) string {
	if payload == "" {
		return fmt.Sprintf("\\033]%d;%s\\007", shellIntegrationOSC, command)
	}
	return fmt.Sprintf("\\033]%d;%s;%s\\007", shellIntegrationOSC, command, payload)
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'"
}

func powerShellIntegrationScript() string {
	return strings.Join([]string{
		"$Global:_ROPCODE_SI_FIRSTPROMPT = $true",
		"",
		"function Global:_ropcode_si_blocked {",
		"    return ($env:TMUX -or $env:STY -or $env:TERM -like \"tmux*\" -or $env:TERM -like \"screen*\")",
		"}",
		"",
		"function Global:_ropcode_si_osc7 {",
		"    if (_ropcode_si_blocked) { return }",
		"    $encoded_pwd = [System.Uri]::EscapeDataString($PWD.Path)",
		"    Write-Host -NoNewline \"`e]7;file://localhost/$encoded_pwd`a\"",
		"}",
		"",
		"function Global:_ropcode_si_prompt {",
		"    if (_ropcode_si_blocked) { return }",
		"    if ($Global:_ROPCODE_SI_FIRSTPROMPT) {",
		"        $shellversion = $PSVersionTable.PSVersion.ToString()",
		"        Write-Host -NoNewline \"`e]16162;M;{`\"shell`\":`\"pwsh`\",`\"shellversion`\":`\"$shellversion`\",`\"integration`\":false}`a\"",
		"        $Global:_ROPCODE_SI_FIRSTPROMPT = $false",
		"    }",
		"    _ropcode_si_osc7",
		"}",
		"",
		"if (Test-Path Function:\\prompt) {",
		"    $global:_ropcode_original_prompt = $function:prompt",
		"    function Global:prompt {",
		"        _ropcode_si_prompt",
		"        & $global:_ropcode_original_prompt",
		"    }",
		"} else {",
		"    function Global:prompt {",
		"        _ropcode_si_prompt",
		"        \"PS $($executionContext.SessionState.Path.CurrentLocation)$('>' * ($nestedPromptLevel + 1)) \"",
		"    }",
		"}",
		"",
	}, "\n")
}

func zshShellIntegrationScript() string {
	return strings.TrimSpace(fmt.Sprintf(`
typeset -g __ropcode_si_first_prompt=1
__ropcode_si_osc7_path() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import os, urllib.parse; print(urllib.parse.quote(os.getcwd()), end="")' 2>/dev/null
  else
    printf '%%s' "$PWD"
  fi
}
__ropcode_si_precmd() {
  local __ropcode_si_status=$?
  if (( __ropcode_si_first_prompt )); then
    printf '%s'
  else
    printf '\033]%d;D;{"exitcode":%%d}\007' "$__ropcode_si_status"
  fi
  printf '\033]7;file://localhost/%%s\007' "$(__ropcode_si_osc7_path)"
  printf '%s'
  __ropcode_si_first_prompt=0
}
__ropcode_si_preexec() {
  local cmd="$1"
  local cmd64
  cmd64=$(printf '%%s' "$cmd" | base64 2>/dev/null | tr -d '\n\r')
  if [ -n "$cmd64" ]; then
    printf '\033]%d;C;{"cmd64":"%%s"}\007' "$cmd64"
  else
    printf '%s'
  fi
}
autoload -Uz add-zsh-hook
add-zsh-hook precmd __ropcode_si_precmd
add-zsh-hook preexec __ropcode_si_preexec
`, shellOSC("M", `{"shell":"zsh","integration":true}`), shellIntegrationOSC, shellOSC("A", ""), shellIntegrationOSC, shellOSC("C", ""))) + "\n"
}

func fishShellIntegrationScript() string {
	return strings.TrimSpace(fmt.Sprintf(`
set -g __ropcode_si_first_prompt 1
function __ropcode_si_osc7_path
  if command -v python3 >/dev/null 2>&1
    python3 -c 'import os, urllib.parse; print(urllib.parse.quote(os.getcwd()), end="")' 2>/dev/null
  else
    printf '%%s' "$PWD"
  end
end
function __ropcode_si_prompt --on-event fish_prompt
  set -l __ropcode_si_status $status
  if test $__ropcode_si_first_prompt -eq 1
    printf '%s'
  else
    printf '\033]%d;D;{"exitcode":%%d}\007' $__ropcode_si_status
  end
  printf '\033]7;file://localhost/%%s\007' (__ropcode_si_osc7_path)
  printf '%s'
  set -g __ropcode_si_first_prompt 0
end
function __ropcode_si_preexec --on-event fish_preexec
  set -l cmd (string join -- ' ' $argv)
  set -l cmd64 (printf '%%s' "$cmd" | base64 2>/dev/null | string replace -a '\n' '' | string replace -a '\r' '')
  if test -n "$cmd64"
    printf '\033]%d;C;{"cmd64":"%%s"}\007' "$cmd64"
  else
    printf '%s'
  end
end
`, shellOSC("M", `{"shell":"fish","integration":true}`), shellIntegrationOSC, shellOSC("A", ""), shellIntegrationOSC, shellOSC("C", ""))) + "\n"
}

func bashShellIntegrationScript() string {
	return strings.TrimSpace(fmt.Sprintf(`
if shopt -q extdebug; then
  printf '%s'
  return 0
fi
if [ -z "${bash_preexec_imported:-}" ]; then
  printf '%s'
  return 0
fi
__ropcode_si_first_prompt=1
__ropcode_si_osc7_path() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import os, urllib.parse; print(urllib.parse.quote(os.getcwd()), end="")' 2>/dev/null
  else
    printf '%%s' "$PWD"
  fi
}
__ropcode_si_precmd() {
  local __ropcode_si_status=$?
  if [ "$__ropcode_si_first_prompt" -eq 1 ]; then
    printf '%s'
  else
    printf '\033]%d;D;{"exitcode":%%d}\007' "$__ropcode_si_status"
  fi
  printf '\033]7;file://localhost/%%s\007' "$(__ropcode_si_osc7_path)"
  printf '%s'
  __ropcode_si_first_prompt=0
}
__ropcode_si_preexec() {
  local cmd="$1"
  local cmd_length=${#cmd}
  if [ "$cmd_length" -gt 8192 ]; then
    cmd=$(printf '# command too large (%%d bytes)' "$cmd_length")
  fi
  local cmd64
  cmd64=$(printf '%%s' "$cmd" | base64 2>/dev/null | tr -d '\n\r')
  if [ -n "$cmd64" ]; then
    printf '\033]%d;C;{"cmd64":"%%s"}\007' "$cmd64"
  else
    printf '%s'
  fi
}
if [[ " ${precmd_functions[*]} " != *" __ropcode_si_precmd "* ]]; then
  precmd_functions+=(__ropcode_si_precmd)
fi
if [[ " ${preexec_functions[*]} " != *" __ropcode_si_preexec "* ]]; then
  preexec_functions+=(__ropcode_si_preexec)
fi
`, shellOSC("M", `{"integration":false}`), shellOSC("M", `{"integration":false}`), shellOSC("M", `{"shell":"bash","integration":true}`), shellIntegrationOSC, shellOSC("A", ""), shellIntegrationOSC, shellOSC("C", ""))) + "\n"
}
