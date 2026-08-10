import { describe, it, expect } from 'vitest'
import {
  anytimeRegret,
  buildRoundVotes,
  etaForRound,
  etaFromGrowthRate,
  followISuccess,
  growthRateFromEta,
  hedgeLossBound,
  normalise,
  optimalEta,
  predict,
  seededFill,
  slidesGuarantee,
  uniformWeights,
  updateWeights,
  wmMistakeBound,
  type Choice,
  type RoundVotes,
} from '../services/predictorEngine'
import reference from './fixtures/python-reference.json'

/**
 * The live predictor and `analysis/expert_algorithm.py` must produce the same run, or the
 * lecture ends up quoting two different sets of numbers for the same algorithm. They are
 * written in opposite conventions — the analysis grows the winners by (1+G), this grows
 * nothing and shrinks the losers by exp(-eta) — which agree after renormalisation exactly
 * when eta = ln(1+G).
 *
 * `fixtures/python-reference.json` is the Python side's output over
 * `analysis/fixture_slides.csv` at G = 1. Regenerate it with:
 *
 *   cd analysis && python -c "..."   (see the commit that added the fixture)
 */
describe('engine agrees with the Python reference', () => {
  const eta = etaFromGrowthRate(reference.growth_rate)
  const experts = reference.experts as string[]

  it('translates G = 1 to eta = ln 2', () => {
    expect(eta).toBeCloseTo(Math.LN2, 12)
    expect(growthRateFromEta(eta)).toBeCloseTo(1, 12)
  })

  it('reproduces every prediction, success rate and final weight', () => {
    let weights = uniformWeights(experts)

    for (const expected of reference.rounds) {
      const raw = reference.votes.find((v) => v.question_id === expected.question_id)
      expect(raw, `votes for question ${expected.question_id}`).toBeDefined()

      const votes: RoundVotes = Object.fromEntries(
        Object.entries(raw!.votes as Record<string, string>).map(([pseudonym, choice]) => [
          pseudonym,
          { choice: choice as Choice, manual: true },
        ]),
      )
      const truth = expected.truth as Choice

      const prediction = predict(weights, votes, 'A')
      expect(prediction.weightedMajority, `round ${expected.index} WM`).toBe(expected.wm)
      expect(prediction.plainMajority, `round ${expected.index} plain majority`).toBe(expected.mv)
      expect(followISuccess(weights, votes, truth)).toBeCloseTo(expected.p, 10)

      weights = updateWeights(weights, [{ votes, truth }], eta)
    }

    for (const [pseudonym, share] of Object.entries(reference.final_weights)) {
      expect(weights[pseudonym], `final weight of ${pseudonym}`).toBeCloseTo(share as number, 10)
    }
  })
})

describe('seeded coin flip', () => {
  it('is stable across calls — the committed prediction must never change on reload', () => {
    const first = seededFill(20260828, 42, 'Expert 3')
    for (let i = 0; i < 100; i++) expect(seededFill(20260828, 42, 'Expert 3')).toBe(first)
  })

  it('varies by seed, question and expert', () => {
    const pool = Array.from({ length: 40 }, (_, i) => `Expert ${i}`)
    const heads = pool.filter((p) => seededFill(1, 7, p) === 'A').length
    // Not a distribution test — a guard against a hash that collapses to one answer.
    expect(heads).toBeGreaterThan(5)
    expect(heads).toBeLessThan(35)

    // Each input has to actually reach the hash.
    const varyQuestion = new Set(Array.from({ length: 20 }, (_, q) => seededFill(1, q, 'Expert 1')))
    const varySeed = new Set(Array.from({ length: 20 }, (_, s) => seededFill(s, 7, 'Expert 1')))
    expect(varyQuestion.size).toBe(2)
    expect(varySeed.size).toBe(2)
  })

  it('fills only the experts who did not vote, and tags which is which', () => {
    const pool = ['a', 'b', 'c']
    const votes = buildRoundVotes(pool, new Map([['a', 'A']]), 99, 1)

    expect(votes.a).toEqual({ choice: 'A', manual: true })
    expect(votes.b.manual).toBe(false)
    expect(votes.c.manual).toBe(false)
    expect(Object.keys(votes)).toHaveLength(3)
  })
})

describe('prediction', () => {
  const votes = (spec: Record<string, Choice>): RoundVotes =>
    Object.fromEntries(Object.entries(spec).map(([k, v]) => [k, { choice: v, manual: true }]))

  it('weights the majority rather than counting it', () => {
    // Two experts on B outnumber one on A, but A carries more weight.
    const weights = normalise({ a: 0.8, b: 0.1, c: 0.1 })
    const prediction = predict(weights, votes({ a: 'A', b: 'B', c: 'B' }), 'A')

    expect(prediction.weightedMajority).toBe('A')
    expect(prediction.plainMajority).toBe('B')
    expect(prediction.weightA).toBeCloseTo(0.8, 10)
  })

  it('honours the configured tie break on an exact split', () => {
    const weights = uniformWeights(['a', 'b'])
    expect(predict(weights, votes({ a: 'A', b: 'B' }), 'A').weightedMajority).toBe('A')
    expect(predict(weights, votes({ a: 'A', b: 'B' }), 'B').weightedMajority).toBe('B')
  })

  it('excludes experts outside the frozen pool', () => {
    const weights = uniformWeights(['a', 'b'])
    const prediction = predict(weights, votes({ a: 'A', b: 'A', latecomer: 'B' }), 'A')

    expect(prediction.nVoters).toBe(2)
    expect(prediction.weightParticipating).toBeCloseTo(1, 10)
  })

  it('keeps W to the participants when an expert is genuinely absent', () => {
    const weights = uniformWeights(['a', 'b', 'c', 'd'])
    const prediction = predict(weights, votes({ a: 'A', b: 'B' }), 'A')

    expect(prediction.weightParticipating).toBeCloseTo(0.5, 10)
    expect(followISuccess(weights, votes({ a: 'A', b: 'B' }), 'A')).toBeCloseTo(0.5, 10)
  })
})

describe('weight update', () => {
  const votes = (spec: Record<string, Choice>): RoundVotes =>
    Object.fromEntries(Object.entries(spec).map(([k, v]) => [k, { choice: v, manual: true }]))

  it('penalises only the wrong and renormalises to 1', () => {
    const updated = updateWeights(
      uniformWeights(['a', 'b']),
      [{ votes: votes({ a: 'A', b: 'B' }), truth: 'A' }],
      Math.LN2,
    )

    // b is halved (beta = e^-ln2 = 1/2), so shares become 2/3 and 1/3.
    expect(updated.a).toBeCloseTo(2 / 3, 10)
    expect(updated.b).toBeCloseTo(1 / 3, 10)
    expect(updated.a + updated.b).toBeCloseTo(1, 12)
  })

  it('leaves an absent expert untouched', () => {
    const updated = updateWeights(
      uniformWeights(['a', 'b', 'c']),
      [{ votes: votes({ a: 'A', b: 'B' }), truth: 'A' }],
      Math.LN2,
    )
    expect(updated.a).toBeCloseTo(updated.c, 10)
    expect(updated.b).toBeLessThan(updated.c)
  })

  it('applies a whole batch in one shot, so neither question informs the other', () => {
    const pool = ['a', 'b']
    const q1 = votes({ a: 'A', b: 'B' }) // truth A -> a right, b wrong
    const q2 = votes({ a: 'B', b: 'A' }) // truth A -> a wrong, b right

    const batched = updateWeights(
      uniformWeights(pool),
      [
        { votes: q1, truth: 'A' },
        { votes: q2, truth: 'A' },
      ],
      Math.LN2,
    )

    // One loss each, so they come out level. Feeding the questions through sequentially
    // would give the same answer here, but only because the losses are symmetric — the
    // point is that q1's truth never reached the weights that predicted q2.
    expect(batched.a).toBeCloseTo(0.5, 10)
    expect(batched.b).toBeCloseTo(0.5, 10)
  })

  it('a batch is not the same as two sequential rounds', () => {
    const both = votes({ a: 'A', b: 'B' })

    const batched = updateWeights(
      uniformWeights(['a', 'b']),
      [
        { votes: both, truth: 'A' },
        { votes: both, truth: 'A' },
      ],
      Math.LN2,
    )
    // Sequentially the second round would be predicted with weights that already absorbed
    // the first round's truth. The weights land in the same place either way, but the
    // prediction in between does not — which is why commitDueBatches shares one vector.
    const sequential = updateWeights(
      updateWeights(uniformWeights(['a', 'b']), [{ votes: both, truth: 'A' }], Math.LN2),
      [{ votes: both, truth: 'A' }],
      Math.LN2,
    )

    expect(batched.a).toBeCloseTo(sequential.a, 10)
    expect(batched.a).toBeCloseTo(4 / 5, 10)
  })

  it('rejects a non-positive learning rate', () => {
    expect(() => updateWeights(uniformWeights(['a']), [], 0)).toThrow(/learning rate/)
  })
})

describe('learning rate', () => {
  it('optimalEta is sqrt(8 ln N / T)', () => {
    expect(optimalEta(30, 26)).toBeCloseTo(Math.sqrt((8 * Math.log(30)) / 26), 12)
  })

  it('anytime decays with the round, fixed does not', () => {
    const anytimeEarly = etaForRound('anytime', 0.5, 30, 1)
    const anytimeLate = etaForRound('anytime', 0.5, 30, 26)

    expect(anytimeEarly).toBeGreaterThan(anytimeLate)
    expect(etaForRound('fixed', 0.5, 30, 1)).toBe(0.5)
    expect(etaForRound('fixed', 0.5, 30, 26)).toBe(0.5)
  })
})

describe('bounds', () => {
  it('the Hedge bound is minimised at optimalEta', () => {
    const best = 5
    const tuned = optimalEta(30, 26)
    const atTuned = hedgeLossBound(best, 30, tuned, 26)

    for (const eta of [tuned / 2, tuned * 0.9, tuned * 1.1, tuned * 2]) {
      expect(hedgeLossBound(best, 30, eta, 26)).toBeGreaterThanOrEqual(atTuned - 1e-12)
    }
  })

  it('reduces to Littlestone–Warmuth 2.41 (M_best + log2 N) at beta = 1/2', () => {
    const nExperts = 30
    const mBest = 4

    // The paper's 2.41 is ln2 / ln(4/3) rounded; check the exact identity, then that the
    // rounded form the handout quotes lands in the same place.
    const exact = (Math.LN2 * mBest + Math.log(nExperts)) / Math.log(4 / 3)
    expect(wmMistakeBound(mBest, nExperts, Math.LN2)).toBeCloseTo(exact, 10)
    expect(Math.LN2 / Math.log(4 / 3)).toBeCloseTo(2.41, 2)
    expect(wmMistakeBound(mBest, nExperts, Math.LN2)).toBeCloseTo(
      2.41 * (mBest + Math.log2(nExperts)),
      1,
    )
  })

  it('the anytime regret matches the handout for the window', () => {
    // T = 26 questions, N = 30 experts.
    expect(anytimeRegret(30, 26)).toBeCloseTo(Math.sqrt(2 * 26 * Math.log(30)), 10)
  })

  it("the slides' guarantee can be negative and then promises nothing", () => {
    // Few rounds, many experts: the ln(E)/(D*G) penalty swamps it.
    expect(slidesGuarantee(1, 0.7, 30, 2)).toBeLessThan(0)
    expect(slidesGuarantee(1, 0.7, 30, 500)).toBeGreaterThan(0)
  })
})
