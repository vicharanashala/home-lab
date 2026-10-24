/**
 * Finding the openclaw CLI.
 *
 * WHY THIS IS ITS OWN MODULE: the bridge starts a server the moment it is
 * imported, so a rule written inside it cannot be run from a test. Which
 * binary to run is a decision, and a decision that decides whether a whole
 * feature works belongs where it can be checked.
 */
import path from 'node:path';
import os from 'node:os';
import { promises as fs, constants } from 'node:fs';

/** The CLI's name, as it is installed and as it is typed. */
export const OPENCLAW_BIN = 'openclaw';

/**
 * The directory the openclaw installer puts the CLI in.
 *
 * This is not a guess: the bridge already knows this root — the overwatch
 * agent's own system prompt lives in ~/.openclaw/workspaces/overwatch/ — so
 * the install directory is the same one, one level down.
 */
export function openclawInstallDir(homedir = os.homedir()) {
  return path.join(homedir, '.openclaw', 'bin');
}

/** Whether a path is a file we can actually run. */
async function isExecutable(file) {
  try {
    await fs.access(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * The command to run for the overwatch agent.
 *
 * WHY IT IS NOT LEFT TO THE PATH: the bridge is started by the supervisor,
 * and launchd hands an agent a minimal PATH. The supervisor extends it with
 * node's own directory — without that the bridge cannot start at all — but
 * the openclaw CLI is installed in ~/.openclaw/bin, which is not on it.
 *
 * So on a machine where openclaw was installed and working, every overwatch
 * call failed with ENOENT: the agent was never reached, the feature was
 * dead, and the bridge said so honestly rather than pretending otherwise.
 *
 * THE PATH IS STILL THE FALLBACK: a CLI installed somewhere else, and
 * already on the PATH, is found by the spawn itself, so nothing is lost by
 * looking in the known place first.
 *
 * @param homedir the home directory to look in
 * @param exists  how to ask whether a file is runnable, so the rule can be
 *                checked without touching a real disk
 */
export async function resolveOpenclaw({
  homedir = os.homedir(),
  exists = isExecutable,
} = {}) {
  const installed = path.join(openclawInstallDir(homedir), OPENCLAW_BIN);
  if (await exists(installed)) return installed;
  return OPENCLAW_BIN;
}
