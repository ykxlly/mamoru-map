export function releaseGate({ enabled = false, approval = false, previewPassed = false, commit, deploymentId }) {
  const checks = { enabled, approval, previewPassed, commitPresent: Boolean(commit), deploymentIdPresent: Boolean(deploymentId) };
  return { checks, allowed: enabled && approval && previewPassed && checks.commitPresent && checks.deploymentIdPresent };
}
