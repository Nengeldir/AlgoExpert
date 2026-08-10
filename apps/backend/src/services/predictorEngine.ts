// The Expert Algorithm, live. Pure functions only — no DB, no I/O, no clock.
//
// This is the TypeScript twin of `analysis/expert_algorithm.py`, and the two must agree
// round for round (`predictorEngine.test.ts` checks that against the shared fixture).
// They are written in different conventions, which is the one thing to keep straight:
//
//   slides / analysis:  reward variant, w *= (1 + G) for the experts who were right
//   handout / here:     penalty variant, w *= exp(-eta) for the experts who were wrong
//
// After renormalisation these are the *same* algorithm — only the weight *ratios* are
// ever read — related by
//
//   eta = ln(1 + G)        G = e^eta - 1
//
// so `growthRateFromEta` / `etaFromGrowthRate` translate between what this module runs
// and what the lecture slides quote. Do not mix the two rates without converting.
//
// Two learners are derived from the same weights:
//
//   Follow i             randomized; picks expert i with probability w_i / W. Its loss is
//                        the weight sitting on the wrong answer, so it is a fraction, and
//                        it is the learner the Hedge regret bound covers.
//   Weighted Majority    deterministic; commits a single A/B. Its loss is 0 or 1 and it
//                        gets the Littlestone–Warmuth mistake bound instead.

export type Choice = 'A' | 'B'

export interface ExpertVote {
  choice: Choice
  /** true for a vote the student actually cast, false for a coin flip filled in for them */
  manual: boolean
}

/** pseudonym -> weight share. Always renormalised to sum to 1. */
export type Weights = Record<string, number>

/** pseudonym -> the vote that counted for one question, real or filled */
export type RoundVotes = Record<string, ExpertVote>

// ---------------------------------------------------------------------------
// The seeded coin flip for absentees
// ---------------------------------------------------------------------------

function fnv1a(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/**
 * The vote filled in for an expert who did not answer this question.
 *
 * Per the class policy (see docs/algorithm.md), a non-voter is not dropped from the
 * round — a coin is flipped on their behalf. The flip has to be *reproducible*: the
 * predictor commits before the truth is known and must never be able to land on a
 * different answer when the page is reloaded, so it is a hash of (seed, question,
 * pseudonym) rather than a draw from a random stream.
 */
export function seededFill(seed: number, questionId: number, pseudonym: string): Choice {
  return fnv1a(`${seed}:${questionId}:${pseudonym}`) % 2 === 0 ? 'A' : 'B'
}

/** Every expert in the pool gets a vote for this question: their own, or a coin flip. */
export function buildRoundVotes(
  pool: string[],
  cast: Map<string, Choice>,
  seed: number,
  questionId: number,
): RoundVotes {
  const votes: RoundVotes = {}
  for (const pseudonym of pool) {
    const own = cast.get(pseudonym)
    votes[pseudonym] = own
      ? { choice: own, manual: true }
      : { choice: seededFill(seed, questionId, pseudonym), manual: false }
  }
  return votes
}

// ---------------------------------------------------------------------------
// Prediction
// ---------------------------------------------------------------------------

export interface Prediction {
  /** Weight behind A among the experts who voted */
  weightA: number
  weightB: number
  /** W_t — total weight of the participants, 1 unless the pool has genuine absentees */
  weightParticipating: number
  weightedMajority: Choice
  plainMajority: Choice
  nVoters: number
  /** of nVoters, how many were real cast votes rather than coin flips */
  nManual: number
}

/**
 * Commit one prediction from the weights held *entering* the round.
 *
 * An expert with no entry in `votes` contributes no weight and is left untouched — the
 * sleeping-expert case. With the coin-flip fill applied upstream this does not arise in
 * production, but keeping W restricted to participants means the numbers stay honest if
 * it ever does.
 */
export function predict(weights: Weights, votes: RoundVotes, tieBreak: Choice = 'A'): Prediction {
  let weightA = 0
  let weightParticipating = 0
  let countA = 0
  let nVoters = 0
  let nManual = 0

  for (const [pseudonym, vote] of Object.entries(votes)) {
    const w = weights[pseudonym]
    if (w === undefined) continue // not in the frozen expert pool
    weightParticipating += w
    nVoters += 1
    if (vote.manual) nManual += 1
    if (vote.choice === 'A') {
      weightA += w
      countA += 1
    }
  }

  const weightB = weightParticipating - weightA
  const countB = nVoters - countA

  return {
    weightA,
    weightB,
    weightParticipating,
    weightedMajority: argmax(weightA, weightB, tieBreak),
    plainMajority: argmax(countA, countB, tieBreak),
    nVoters,
    nManual,
  }
}

/** Follow-i's probability of being right: the share of participating weight on the truth. */
export function followISuccess(weights: Weights, votes: RoundVotes, truth: Choice): number {
  let correct = 0
  let participating = 0
  for (const [pseudonym, vote] of Object.entries(votes)) {
    const w = weights[pseudonym]
    if (w === undefined) continue
    participating += w
    if (vote.choice === truth) correct += w
  }
  return participating > 0 ? correct / participating : 0
}

// ---------------------------------------------------------------------------
// The weight update
// ---------------------------------------------------------------------------

export interface ResolvedQuestion {
  votes: RoundVotes
  truth: Choice
}

/**
 * Hedge update over a whole batch: `w_i *= exp(-eta * L_i)` where `L_i` is how many of
 * the batch's questions expert i got wrong, then renormalise.
 *
 * The batch is updated in one shot rather than question by question because the questions
 * in it closed at the same instant — their truths become known together, so no question in
 * the batch may influence the weights that predicted another one.
 */
export function updateWeights(weights: Weights, batch: ResolvedQuestion[], eta: number): Weights {
  if (eta <= 0) throw new Error(`learning rate must be positive, got ${eta}`)

  const updated: Weights = { ...weights }

  for (const { votes, truth } of batch) {
    for (const [pseudonym, vote] of Object.entries(votes)) {
      if (updated[pseudonym] === undefined) continue
      if (vote.choice !== truth) updated[pseudonym] *= Math.exp(-eta)
    }
  }

  return normalise(updated)
}

/** Rescale to sum to 1. Ratios are all the algorithm reads, so this changes nothing. */
export function normalise(weights: Weights): Weights {
  const total = Object.values(weights).reduce((sum, w) => sum + w, 0)
  if (total <= 0) return { ...weights }
  const out: Weights = {}
  for (const [pseudonym, w] of Object.entries(weights)) out[pseudonym] = w / total
  return out
}

export function uniformWeights(pool: string[]): Weights {
  const share = pool.length > 0 ? 1 / pool.length : 0
  return Object.fromEntries(pool.map((p) => [p, share]))
}

// ---------------------------------------------------------------------------
// Learning rate
// ---------------------------------------------------------------------------

/**
 * The rate that minimises the Hedge bound when the horizon T is known: `sqrt(8 ln N / T)`.
 */
export function optimalEta(nExperts: number, horizon: number): number {
  if (nExperts < 2 || horizon <= 0) return 1
  return Math.sqrt((8 * Math.log(nExperts)) / horizon)
}

/**
 * The rate to use entering round `t`.
 *
 * 'anytime' recomputes `sqrt(8 ln N / t)` each round, which costs only a small constant
 * factor and — the reason we run it — does not require committing to T in advance. With a
 * fixed rate, T has to be guessed before the window opens, and any later correction to it
 * would look exactly like tuning the rate against the data.
 */
export function etaForRound(
  mode: 'fixed' | 'anytime',
  fixedEta: number,
  nExperts: number,
  t: number,
): number {
  return mode === 'fixed' ? fixedEta : optimalEta(nExperts, Math.max(1, t))
}

export function growthRateFromEta(eta: number): number {
  return Math.exp(eta) - 1
}

export function etaFromGrowthRate(growthRate: number): number {
  return Math.log(1 + growthRate)
}

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

/**
 * Hedge, fixed rate: `L_A <= L_best + ln(N)/eta + eta*T/8`.
 *
 * `L_A` here is Follow-i's *expected* loss (the sum of the weight that sat on the wrong
 * answer), not the deterministic learner's mistake count — those get `wmMistakeBound`.
 */
export function hedgeLossBound(
  bestLoss: number,
  nExperts: number,
  eta: number,
  horizon: number,
): number {
  if (nExperts < 2 || eta <= 0) return Number.POSITIVE_INFINITY
  return bestLoss + Math.log(nExperts) / eta + (eta * horizon) / 8
}

/** The anytime regret term `sqrt(2 T ln N)`, up to the O(ln N) the handout drops. */
export function anytimeRegret(nExperts: number, horizon: number): number {
  if (nExperts < 2 || horizon <= 0) return 0
  return Math.sqrt(2 * horizon * Math.log(nExperts))
}

/** The tuned regret `sqrt((T/2) ln N)`, i.e. the bound at eta = optimalEta. */
export function tunedRegret(nExperts: number, horizon: number): number {
  if (nExperts < 2 || horizon <= 0) return 0
  return Math.sqrt((horizon / 2) * Math.log(nExperts))
}

/**
 * Littlestone & Warmuth for the *deterministic* learner:
 *
 *   M_A <= (eta * M_best + ln N) / ln(2 / (1 + beta)),   beta = e^-eta
 *
 * At beta = 1/2 (eta = ln 2) this is the familiar `2.41 (M_best + log2 N)`.
 */
export function wmMistakeBound(bestMistakes: number, nExperts: number, eta: number): number {
  if (nExperts < 2 || eta <= 0) return Number.POSITIVE_INFINITY
  const beta = Math.exp(-eta)
  const denominator = Math.log(2 / (1 + beta))
  if (denominator <= 0) return Number.POSITIVE_INFINITY
  return (eta * bestMistakes + Math.log(nExperts)) / denominator
}

/**
 * The slides' guarantee, in success-rate form:
 *
 *   rate >= ln(1+G)/G * best expert's rate - ln(E)/(D*G)
 *
 * Kept so the live view can quote the same number `analysis/run.py` prints. Frequently
 * negative at lecture-sized D, in which case it promises nothing and should be said so.
 */
export function slidesGuarantee(
  growthRate: number,
  bestExpertRate: number,
  nExperts: number,
  nRounds: number,
): number {
  if (nRounds === 0 || growthRate <= 0 || nExperts < 2) return Number.NEGATIVE_INFINITY
  const fraction = Math.log(1 + growthRate) / growthRate
  const penalty = Math.log(nExperts) / (nRounds * growthRate)
  return fraction * bestExpertRate - penalty
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function argmax(a: number, b: number, tieBreak: Choice): Choice {
  if (a > b) return 'A'
  if (b > a) return 'B'
  return tieBreak
}
