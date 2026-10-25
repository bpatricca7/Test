import type { PolicyMode } from './types'

/** Claude Code permission mode for a Tandem policy. */
export function claudePermissionMode(policy: PolicyMode): 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' {
  switch (policy) {
    case 'ask':
      return 'default'
    case 'auto-edit':
      return 'acceptEdits'
    case 'full-auto':
      return 'bypassPermissions'
    case 'plan':
      return 'plan'
  }
}

export type CodexApprovalPolicy = 'untrusted' | 'on-request' | 'never'
export type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'

/** Codex approval policy + sandbox for a Tandem policy. */
export function codexPolicy(policy: PolicyMode): { approvalPolicy: CodexApprovalPolicy; sandbox: CodexSandboxMode } {
  switch (policy) {
    case 'ask':
      return { approvalPolicy: 'on-request', sandbox: 'workspace-write' }
    case 'auto-edit':
      return { approvalPolicy: 'on-request', sandbox: 'workspace-write' }
    case 'full-auto':
      return { approvalPolicy: 'never', sandbox: 'danger-full-access' }
    case 'plan':
      return { approvalPolicy: 'on-request', sandbox: 'read-only' }
  }
}
