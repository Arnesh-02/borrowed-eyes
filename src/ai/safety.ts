import { AI_LIMITS } from './limits';

const injectionPatterns = [
  /\b(?:ignore|override|disregard|forget|bypass|replace)\b.{0,80}\b(?:instruction|rule|prompt|safety|system|developer|previous|above|guard|filter)s?\b/i,
  /\b(?:system|developer|assistant)\s*(?:message|prompt|role|:)/i,
  /\b(?:reveal|repeat|print|show|leak)\b.{0,60}\b(?:prompt|secret|instruction|chain.of.thought|reasoning)\b/i,
  /\b(?:jailbreak|prompt injection|do anything now|chain.of.thought)\b/i,
  /\b(?:pretend|act|behave)\s+(?:that\s+)?(?:you\s+are|as)\b/i,
  /\b(?:return|output|respond with)\b.{0,30}\b(?:json|missionId|factId|instructions|navigation|status)\b/i,
  /<\|?|\|>|\[\/?(?:INST|SYSTEM)\]|```/i,
];

const commandsOrLinks = [
  /(?:[a-z][a-z\d+.-]*:\/\/|www\.|mailto:|javascript:|data:|file:|intent:)/i,
  /\b[a-z\d-]+(?:\.[a-z\d-]+)+\b/i,
  /\b(?:curl|wget|sudo|powershell|cmd\.exe|bash|npm|npx|bunx|eval|exec|chmod|rm\s+-|git\s+clone)\b/i,
  /\b(?:install|download|execute|open|visit|browse|click|tap)\b.{0,40}\b(?:url|link|site|browser|terminal|command|script|app|button)\b/i,
  /[<>{}\[\]`\\]|\$\(|&&|\|\||%[a-f\d]{2}/i,
];

// These are intentionally conservative English-language heuristics, NOT a full
// semantic safety/perception/factuality guarantee. Some harmless wording will
// be rejected; paraphrases and unsupported languages can evade lexical rules.
// Mission IDs, keys, facts, timing, and state are separately enforced structurally.
const unsafeSpokenPatterns = [
  /\b(?:kill|hurt|harm|attack|assault|threaten|stalk|steal|arson|trespassing|break\s+in|scale|vault|leap|blindfold|suicide|overdose)\b/i,
  /\b(?:walk|walking|run|running|jog|jogging|sprint|climb|climbing|cross|crossing|jump|jumping|swim|swimming|drive|driving|cycle|cycling|crawl|crawling|chase|follow|enter|trespass|approach|wander|wandering|explore)\b/i,
  /\b(?:touch|grab|pick|lift|push|pull|reach|lean|bend|crouch|kneel|balance|stretch|throw|throwing|cut|break|kick|punch|fight|lick|taste|swallow|drink|eat|inhale|exhale|hyperventilate|breathe|breathing|breaths)\b/i,
  /\b(?:move|moving|turn|turning|go|step|stepping|look|looking|listen|listening|sit|sitting|stand|standing|smell|close|open|find|search|inspect|photograph)\b/i,
  /\b(?:hold|stop|control|slow|deepen|count)\b.{0,30}\b(?:breath|breathing|heartbeat)\b/i,
  /\b(?:close|cover|shut|blindfold)\b.{0,25}\b(?:eye|eyes|ears)\b/i,
  /\b(?:traffic|road|railway|railroad|tracks|ledge|rooftop|weapon|knife|gun|fire|flame|electric|chemical|stranger|headphones|earbuds)\b/i,
  /(?:^|[.!?;:]\s*|\bplease\s+|\b(?:can|could|will|would)\s+you\s+|\byou\s+(?:can|should|must|need to|could)\s+|\btry\s+(?:to\s+)?)(?:now\s+|gently\s+|slowly\s+|just\s+)?(?:look|listen|smell|move|turn|go|step|take|sit|stand|stay|stop|find|search|notice|inspect|check|put|remove|raise|lower|open|shut|head|keep)\b/i,
  /\b(?:toward|towards|straight ahead|to your (?:left|right)|behind you|beside you|near you|around you|next to you|in front of you)\b/i,
  /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|sixty|a|an)\s*(?:seconds?|minutes?|hours?|paces?|steps?|metres?|meters?|feet|yards?|miles?)\b/i,
  /\b(?:I|we)(?:'m|'re)?\s+(?:(?:can|could|do|did|just|also|clearly|already|am|are)\s+)*(?:see|seeing|saw|hear|hearing|heard|notice|noticing|noticed|observe|observing|observed|watch|watching|spot|spotted|detect|detected|sense|sensing|sensed|smell|feel)\b/i,
  /\b(?:I|we)(?:'ve| have)\s+(?:seen|heard|noticed|observed|spotted|detected)\b/i,
  /\b(?:there (?:is|are|was|were)|there's|I am watching|I'm watching|your (?:camera|microphone|location|surroundings)|you(?:'re| are) (?:in|at|near|standing|sitting|wearing))\b/i,
  /\b(?:mission|session|task)\s+(?:(?:is|was|has been|now)\s+)*(?:complete|completed|finished|skipped|paused|resumed)\b/i,
  /\b(?:I|we)(?:'ve| have)?\s+(?:marked|completed|skipped|paused|resumed|finished)\b/i,
  /\b(?:you|you've|you have)\s+(?:completed|finished|succeeded|passed)\b/i,
  /\b(?:complete|skip|pause|resume|end|restart|reset|navigate)\b.{0,30}\b(?:mission|session|app|screen)\b/i,
  /\b(?:scientists? (?:say|found)|research (?:shows|proves)|according to|studies show|fun fact|it is a fact)\b/i,
  /\b\d{3,}\b|\d\s*%|\b(?:said|wrote|quoted)\s*["“]/i,
];

function normalized(text: string): string {
  return text.normalize('NFKC').replace(/[’‘]/g, "'");
}

export function hasPromptInjection(text: string): boolean {
  const value = normalized(text);
  return injectionPatterns.some((pattern) => pattern.test(value))
    || commandsOrLinks.some((pattern) => pattern.test(value));
}

export function isSafeSpokenText(text: string): boolean {
  if (!text.trim() || text.length > AI_LIMITS.spokenText || /[\p{Cc}\p{Cf}]/u.test(text)) return false;
  const value = normalized(text);
  if (hasPromptInjection(value) || unsafeSpokenPatterns.some((pattern) => pattern.test(value))) return false;
  if ((value.match(/\?/g) ?? []).length > 1) return false;
  const sentences = value.split(/[.!?]+(?:["')\]]?\s+|$)/).filter((sentence) => sentence.trim());
  return sentences.length >= 1 && sentences.length <= 3;
}
