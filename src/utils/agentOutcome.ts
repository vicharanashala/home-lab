import type { AgentActionResult } from './agentActions';
import type { ToastKind } from '../store/useStore';

/**
 * What the House Bot says after it has applied the model's proposals.
 *
 * WHY THE SAYING IS A RULE AND NOT A LINE IN THE PAGE: the page is the only
 * place that shows the outcome, so the rule used to live there too — inline,
 * in a page that cannot be run by a test. A rule that cannot be run by a test
 * is a rule that nobody checks, and this one had stopped saying the truth.
 *
 * WHAT WAS WRONG
 * The page showed a warning only when NOTHING was applied:
 *
 *     if (outcome.skipped > 0 && outcome.applied === 0) {
 *       toast('House Bot couldn’t apply that change', 'warning');
 *     }
 *
 * So a batch where one change worked and one did not produced ONE toast — the
 * success one — and the failure was never mentioned:
 *
 *     the model said   "Added milk and set the yeast to 3"
 *     the shelf held   no yeast
 *     the household saw "House Bot · Milk → grocery"
 *
 * The model writes its own confirmation into the reply the household reads, so
 * the claim "I set the yeast to 3" is on the screen. Nothing on the screen
 * contradicted it. The yeast was not touched, and the household had no way to
 * tell.
 *
 * WHY THIS IS WORTH FIXING RATHER THAN REPORTING: `applyAgentActions` counts
 * every action it drops, and its own comment says why — "counted as skipped so
 * the user still sees that something was dropped rather than silently losing
 * part of the request". The count was being kept for exactly that reason, and
 * the one place that shows the count was hiding it whenever the batch had a
 * single success in it.
 *
 * WHY IT LIVES HERE AND NOT IN THE PAGE: the rule is about what a RESULT
 * means, and the result is a plain value. A page that builds the wording
 * inline cannot be asked "what does the app say when one of two changes
 * failed?" without rendering a whole React page to find out.
 */

/** One thing to show the household, and how it should be shown. */
export interface AgentOutcomeToast {
  message: string;
  kind: ToastKind;
}

/**
 * What to say about a batch of actions that has been applied.
 *
 * WHY BOTH A SUCCESS AND A WARNING CAN COME OUT OF THIS: the two facts are
 * different and the household needs both. "Milk → grocery" is what happened;
 * "1 of 2 changes could not be applied" is what did not. One toast carrying
 * both would bury the second fact inside the first, and the first fact is the
 * one the household was already told by the bot's own message.
 *
 * WHY THE WARNING IS COUNTED AND NOT JUST PRESENTED: "something didn't work"
 * does not tell the household whether one thing or five did not. The number
 * is the difference between "try that again" and "the bot did most of it".
 *
 * @param outcome what the actions did
 * @returns the toasts to show — none, one, or two
 */
export function describeAgentOutcome(outcome: AgentActionResult): AgentOutcomeToast[] {
  const toasts: AgentOutcomeToast[] = [];

  if (outcome.applied > 0) {
    toasts.push({
      message:
        outcome.summary.length > 90
          ? `House Bot updated ${outcome.applied} item${outcome.applied === 1 ? '' : 's'}`
          : `House Bot · ${outcome.summary}`,
      kind: 'success',
    });
  }

  if (outcome.skipped > 0) {
    // WHY THE TOTAL IS ADDED UP RATHER THAN TAKEN FROM THE BATCH: every
    // action ends up counted as applied or as skipped, so the two together
    // are the number the household asked for.
    const total = outcome.applied + outcome.skipped;
    toasts.push({
      message:
        total === 1
          ? 'House Bot couldn’t apply that change'
          : `House Bot couldn’t apply ${outcome.skipped} of ${total} changes`,
      kind: 'warning',
    });
  }

  // WHY A BLOCK THE BRIDGE COULD NOT READ IS ITS OWN TOAST: the model's
  // action block did not parse, so the number of changes it asked for is not
  // in it — and a number put there would be one the household could check
  // and could not. So the sentence says what is true: a change was asked
  // for, it did not happen, and the reason is that it could not be read.
  //
  // WHY IT IS NOT FOLDED INTO THE COUNT ABOVE: "couldn't apply 1 of 2
  // changes" is a statement about two changes the app can name. This is a
  // statement about a number of changes the app cannot name, and adding the
  // two together would turn the second into a count it does not have.
  //
  // WHY IT MATTERS THAT THIS IS HERE AT ALL: the model's own sentence is
  // shown to the household verbatim — "Added eggs and milk to your fridge" —
  // and the block it wrote the changes in did not parse, so the shelf held
  // nothing. Without this toast nothing on the screen contradicts what the
  // household was told.
  if (outcome.unreadable) {
    toasts.push({
      message: 'House Bot couldn’t apply a change it couldn’t read',
      kind: 'warning',
    });
  }

  return toasts;
}
