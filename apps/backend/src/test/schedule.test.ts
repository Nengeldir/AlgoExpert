import { describe, it, expect } from 'vitest'
import { nextQuestionSchedule, zurichTimeUTC } from '../services/schedule'

describe('zurichTimeUTC', () => {
  it('resolves winter wall-clock times against CET (UTC+1)', () => {
    expect(zurichTimeUTC('2026-01-15', 12)).toBe('2026-01-15T11:00:00.000Z')
    expect(zurichTimeUTC('2026-01-15', 8)).toBe('2026-01-15T07:00:00.000Z')
  })

  it('resolves summer wall-clock times against CEST (UTC+2)', () => {
    expect(zurichTimeUTC('2026-07-28', 12)).toBe('2026-07-28T10:00:00.000Z')
    expect(zurichTimeUTC('2026-07-28', 8)).toBe('2026-07-28T06:00:00.000Z')
  })

  it('treats hour 24 as midnight ending that Zurich day', () => {
    // End of 28 July (CEST) is 22:00 UTC on the same date
    expect(zurichTimeUTC('2026-07-28', 24)).toBe('2026-07-28T22:00:00.000Z')
    // End of 15 January (CET) is 23:00 UTC on the same date
    expect(zurichTimeUTC('2026-01-15', 24)).toBe('2026-01-15T23:00:00.000Z')
  })

  it('keeps the anchor at the same wall-clock across the DST switch', () => {
    // Last Sunday in March 2026 — the CET -> CEST switch happens at 02:00
    const before = zurichTimeUTC('2026-03-28', 12)
    const after = zurichTimeUTC('2026-03-29', 12)
    expect(before).toBe('2026-03-28T11:00:00.000Z') // CET
    expect(after).toBe('2026-03-29T10:00:00.000Z') // CEST
  })
})

describe('nextQuestionSchedule', () => {
  it('targets today when approving before the voting deadline', () => {
    // 09:00 Zurich on 28 July (CEST) = 07:00 UTC, before the 12:00 close
    const s = nextQuestionSchedule(new Date('2026-07-28T07:00:00Z'))
    expect(s.questionDate).toBe('2026-07-28')
    expect(s.publishedAt).toBe('2026-07-28T06:00:00.000Z') // 08:00 CEST
    expect(s.deadline).toBe('2026-07-28T10:00:00.000Z') // 12:00 CEST
    expect(s.raceEndsAt).toBe('2026-07-28T22:00:00.000Z') // 24:00 CEST
  })

  it('rolls to tomorrow when approving after the voting deadline', () => {
    // 14:00 Zurich on 28 July = 12:00 UTC, after the 12:00 Zurich close
    const s = nextQuestionSchedule(new Date('2026-07-28T12:00:00Z'))
    expect(s.questionDate).toBe('2026-07-29')
    expect(s.deadline).toBe('2026-07-29T10:00:00.000Z')
  })

  it('starts the race exactly when voting closes', () => {
    const s = nextQuestionSchedule(new Date('2026-07-28T07:00:00Z'))
    // This is the whole point: no part of the measured window is observable to voters
    expect(s.raceStartsAt).toBe(s.deadline)
  })

  it('orders publish < voting close < race end', () => {
    const s = nextQuestionSchedule(new Date('2026-01-15T05:00:00Z'))
    expect(s.publishedAt < s.deadline).toBe(true)
    expect(s.deadline < s.raceEndsAt).toBe(true)
  })
})
