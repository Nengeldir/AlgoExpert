import { useState } from 'react'
import type { PredictorExpert, PredictorSeriesPoint } from '../api/client'

/* Charts for the admin predictor view. Hand-rolled SVG on the tokens.css palette — the
   app carries no UI or charting dependency and this is not worth breaking that for.

   The colour scheme deliberately gives an identity hue to only the two *learners*. The
   expert benchmarks are neutral ink separated by dash pattern, so the chart reads the
   same with 5 students or 50 and never needs a cycled categorical ramp. */

const VB_W = 760
const VB_H = 340
const PAD = { top: 16, right: 104, bottom: 40, left: 46 }
const PLOT_W = VB_W - PAD.left - PAD.right
const PLOT_H = VB_H - PAD.top - PAD.bottom

const pct = (v: number) => `${Math.round(v * 100)}%`

function xAt(i: number, n: number): number {
  if (n <= 1) return PAD.left + PLOT_W / 2
  return PAD.left + (i / (n - 1)) * PLOT_W
}

function yAt(value: number): number {
  return PAD.top + (1 - value) * PLOT_H
}

function pathFor(values: number[]): string {
  return values
    .map(
      (v, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i, values.length).toFixed(2)} ${yAt(v).toFixed(2)}`,
    )
    .join(' ')
}

// ---------------------------------------------------------------------------
// Cumulative accuracy
// ---------------------------------------------------------------------------

export function AccuracyChart({ series }: { series: PredictorSeriesPoint[] }) {
  const [hover, setHover] = useState<number | null>(null)

  if (series.length === 0) {
    return (
      <p className="chart-empty">
        No scored rounds yet — the first point appears once a question has closed and resolved.
      </p>
    )
  }

  const n = series.length
  const lines = [
    { key: 'wm', label: 'Weighted Majority', color: 'var(--chart-wm)', dash: '', width: 2.5 },
    { key: 'follow_i', label: 'Follow i', color: 'var(--chart-follow-i)', dash: '', width: 2 },
    { key: 'best_expert', label: 'Best expert', color: 'var(--chart-ref)', dash: '', width: 1.5 },
    {
      key: 'mean_expert',
      label: 'Mean expert',
      color: 'var(--chart-ref)',
      dash: '5 4',
      width: 1.5,
    },
  ] as const

  const active = hover !== null ? series[hover] : null

  return (
    <figure className="chart">
      <div className="chart__plot">
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          role="img"
          className="chart__svg"
          aria-label={`Cumulative success rate over ${n} scored round${n === 1 ? '' : 's'}. Weighted Majority ends at ${pct(series[n - 1].wm)}, best expert at ${pct(series[n - 1].best_expert)}. Full figures are in the round ledger table below.`}
        >
          {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
            <g key={tick}>
              <line
                x1={PAD.left}
                x2={PAD.left + PLOT_W}
                y1={yAt(tick)}
                y2={yAt(tick)}
                stroke="var(--chart-grid)"
                strokeWidth={1}
                strokeDasharray={tick === 0.5 ? '2 4' : undefined}
              />
              <text x={PAD.left - 10} y={yAt(tick) + 4} className="chart__tick" textAnchor="end">
                {pct(tick)}
              </text>
            </g>
          ))}
          {/* The coin flip is the floor any predictor has to beat — labelled, not just drawn.
              It sits below the rule at the left, where no series ever runs; above it on the
              right, the mean-expert line crosses straight through the text. */}
          <text x={PAD.left + 6} y={yAt(0.5) + 14} className="chart__rule-label" textAnchor="start">
            coin flip
          </text>

          {series.map((point, i) =>
            n > 12 && i % Math.ceil(n / 8) !== 0 && i !== n - 1 ? null : (
              <text
                key={point.round_index}
                x={xAt(i, n)}
                y={VB_H - 16}
                className="chart__tick"
                textAnchor="middle"
              >
                {point.round_index}
              </text>
            ),
          )}
          <text
            x={PAD.left + PLOT_W / 2}
            y={VB_H - 2}
            className="chart__axis-title"
            textAnchor="middle"
          >
            round
          </text>

          {lines.map((line) => (
            <path
              key={line.key}
              d={pathFor(series.map((p) => p[line.key]))}
              fill="none"
              stroke={line.color}
              strokeWidth={line.width}
              strokeDasharray={line.dash || undefined}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

          {/* Direct labels for the two the eye should land on first; the rest use the legend.
              The predictor tracking the best expert closely is the whole point, so these two
              land on top of each other exactly when the chart is working — nudge them apart
              rather than letting the good case render as a smudge. */}
          {(() => {
            const last = series[n - 1]
            let wmY = yAt(last.wm)
            let bestY = yAt(last.best_expert)
            const MIN_GAP = 13

            if (Math.abs(wmY - bestY) < MIN_GAP) {
              const mid = (wmY + bestY) / 2
              const wmOnTop = wmY <= bestY
              wmY = mid + (wmOnTop ? -MIN_GAP : MIN_GAP) / 2
              bestY = mid + (wmOnTop ? MIN_GAP : -MIN_GAP) / 2
            }

            return (
              <>
                <text
                  x={xAt(n - 1, n) + 8}
                  y={wmY + 4}
                  className="chart__direct-label"
                  fill="var(--chart-wm)"
                >
                  Predictor
                </text>
                <text
                  x={xAt(n - 1, n) + 8}
                  y={bestY + 4}
                  className="chart__direct-label"
                  fill="var(--chart-ref)"
                >
                  Best expert
                </text>
              </>
            )
          })()}

          {hover !== null && (
            <>
              <line
                x1={xAt(hover, n)}
                x2={xAt(hover, n)}
                y1={PAD.top}
                y2={PAD.top + PLOT_H}
                stroke="var(--color-outline)"
                strokeWidth={1}
              />
              {lines.map((line) => (
                <circle
                  key={line.key}
                  cx={xAt(hover, n)}
                  cy={yAt(series[hover][line.key])}
                  r={5}
                  fill={line.color}
                  stroke="var(--color-surface-container-lowest)"
                  strokeWidth={2}
                />
              ))}
            </>
          )}

          {/* Full-height hit bands: bigger targets than the marks, and no coordinate math. */}
          {series.map((point, i) => (
            <rect
              key={point.round_index}
              x={i === 0 ? PAD.left : xAt(i, n) - PLOT_W / Math.max(1, n - 1) / 2}
              y={PAD.top}
              width={n <= 1 ? PLOT_W : PLOT_W / (n - 1)}
              height={PLOT_H}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </svg>

        {active && (
          <div
            className="chart__tooltip"
            style={{
              left: `${(xAt(hover as number, n) / VB_W) * 100}%`,
              transform: (hover as number) > n / 2 ? 'translateX(-100%)' : 'translateX(0)',
            }}
          >
            <p className="chart__tooltip-title">
              Round {active.round_index} — {active.label}
            </p>
            {lines.map((line) => (
              <p key={line.key} className="chart__tooltip-row">
                <span className="chart__swatch" style={{ background: line.color }} />
                {line.label}
                <strong>{pct(active[line.key])}</strong>
              </p>
            ))}
          </div>
        )}
      </div>

      <figcaption className="chart__legend">
        {lines.map((line) => (
          <span key={line.key} className="chart__legend-item">
            <span
              className="chart__swatch"
              style={{
                background: line.dash ? 'transparent' : line.color,
                borderTop: line.dash ? `2px dashed ${line.color}` : undefined,
                borderRadius: line.dash ? 0 : undefined,
              }}
            />
            {line.label}
          </span>
        ))}
      </figcaption>
    </figure>
  )
}

// ---------------------------------------------------------------------------
// Weight heatmap
// ---------------------------------------------------------------------------

const RAMP = [
  'var(--chart-seq-1)',
  'var(--chart-seq-2)',
  'var(--chart-seq-3)',
  'var(--chart-seq-4)',
]

/**
 * Where the weight sat entering each round, one row per expert.
 *
 * A stacked area or a line per expert would need one colour per student; a single-hue
 * heatmap scales to any cohort and shows the thing that actually matters — that the
 * weight concentrates on a few people as the window runs.
 */
export function WeightHeatmap({
  history,
  experts,
}: {
  history: { round_index: number; shares: Record<string, number> }[]
  experts: PredictorExpert[]
}) {
  const [hover, setHover] = useState<{ round: number; pseudonym: string; share: number } | null>(
    null,
  )

  if (history.length === 0 || experts.length === 0) {
    return <p className="chart-empty">No committed rounds yet.</p>
  }

  const max = Math.max(...history.flatMap((h) => Object.values(h.shares)), 1e-9)
  const step = (share: number) =>
    RAMP[Math.min(RAMP.length - 1, Math.floor((share / max) * RAMP.length))]

  return (
    <figure className="chart">
      <div className="heatmap-scroll">
        <table className="heatmap">
          <thead>
            <tr>
              <th className="heatmap__corner">Expert</th>
              {history.map((h) => (
                <th key={h.round_index} className="heatmap__col-head" scope="col">
                  {h.round_index}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {experts.map((expert) => (
              <tr key={expert.pseudonym}>
                <th className="heatmap__row-head" scope="row">
                  {expert.pseudonym}
                </th>
                {history.map((h) => {
                  const share = h.shares[expert.pseudonym] ?? 0
                  return (
                    <td
                      key={h.round_index}
                      className="heatmap__cell"
                      style={{ background: step(share) }}
                      onMouseEnter={() =>
                        setHover({ round: h.round_index, pseudonym: expert.pseudonym, share })
                      }
                      onMouseLeave={() => setHover(null)}
                      title={`${expert.pseudonym}, round ${h.round_index}: ${(share * 100).toFixed(1)}% of the weight`}
                    />
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <figcaption className="chart__legend chart__legend--between">
        <span className="chart__legend-item">
          Weight share entering the round — low
          {RAMP.map((color) => (
            <span
              key={color}
              className="chart__swatch chart__swatch--square"
              style={{ background: color }}
            />
          ))}
          high (max {pct(max)})
        </span>
        {hover && (
          <span className="chart__legend-item">
            <strong>{hover.pseudonym}</strong> — round {hover.round}:{' '}
            {(hover.share * 100).toFixed(1)}%
          </span>
        )}
      </figcaption>
    </figure>
  )
}

// ---------------------------------------------------------------------------
// Bound meters
// ---------------------------------------------------------------------------

/**
 * A bound is one number against a ceiling, so it is a meter, not a chart. Anything above
 * the ceiling would mean the theorem failed — which in practice means a bug, not a
 * refutation, and the view says so rather than quietly drawing a longer bar.
 */
export function BoundMeter({
  label,
  achieved,
  bound,
  holds,
  formula,
  unit,
}: {
  label: string
  achieved: number
  bound: number
  holds: boolean
  formula: string
  unit: string
}) {
  const scale = Math.max(achieved, bound, 1)
  const achievedPct = Math.min(100, (achieved / scale) * 100)
  const boundPct = Math.min(100, (bound / scale) * 100)

  return (
    <div className="bound">
      <div className="bound__header">
        <span className="bound__label">{label}</span>
        <span className={`badge ${holds ? 'badge--correct' : 'badge--wrong'}`}>
          {holds ? '✓ holds' : '✗ violated — investigate'}
        </span>
      </div>
      <div className="bound__track">
        <div className="bound__fill" style={{ width: `${achievedPct}%` }} />
        {/* Inset by its own width so the rule stays visible when the ceiling *is* the
            scale maximum, instead of being clipped by the track. */}
        <div className="bound__ceiling" style={{ left: `calc(${boundPct}% - 2px)` }} />
      </div>
      <p className="bound__numbers">
        <strong>{achieved.toFixed(2)}</strong> {unit} achieved · ceiling{' '}
        <strong>{Number.isFinite(bound) ? bound.toFixed(2) : '—'}</strong>
      </p>
      <p className="bound__formula">{formula}</p>
    </div>
  )
}
