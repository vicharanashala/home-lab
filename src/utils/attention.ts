/**
 * How many things need the household's attention, in words.
 *
 * WHY THE VERB IS PART OF THE RULE: the count and the noun can be written
 * without any thought — "1 item", "2 items" — and both screens did that
 * correctly. The verb is what was left agreeing with a plural, so the
 * household with exactly ONE thing to attend to was told:
 *
 *     "1 item need attention"
 *
 * on the two screens that tell it. One thing to attend to is the commonest
 * situation there is, and it is the one the sentence gets wrong.
 *
 * WHY IT LIVES HERE AND NOT IN A SCREEN: the Alerts screen's bar and the
 * Dashboard's "Expiring soon" card write the same sentence about the same
 * kitchen, and the screens are not mounted at once — the sentence has to be
 * answerable from the count alone. Two copies of a sentence is how the two
 * copies came to disagree.
 *
 * WHY THE CALLER KEEPS THE EMPTY CASE: zero is not a count here, it is a
 * state — the Alerts screen says "All clear — nothing needs attention" and
 * the Dashboard names the window it is looking in. Both of those are the
 * caller's to write.
 *
 * @param count how many things need attention
 * @returns the sentence — "1 item needs attention", "4 items need attention"
 */
export const formatAttentionCount = (count: number): string =>
  `${count} item${count === 1 ? '' : 's'} ${count === 1 ? 'needs' : 'need'} attention`;
