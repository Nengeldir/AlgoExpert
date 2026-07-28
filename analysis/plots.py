"""Charts for the live lecture analysis.

Palette is the validated 8-slot categorical set (slots assigned in fixed order,
never cycled) plus neutral ink for all text. Light and dark are separately
stepped sets, not an automatic flip.

Three light-mode slots sit under 3:1 contrast on the light surface, so every
chart that uses them ships direct labels, and run.py always writes the
per-round table as CSV -- that is the "relief" the contrast check requires.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.ticker import (  # noqa: E402
    FuncFormatter,
    LogLocator,
    MaxNLocator,
    NullLocator,
    PercentFormatter,
)

from expert_algorithm import Run  # noqa: E402


@dataclass(frozen=True)
class Theme:
    surface: str
    ink: str
    ink_secondary: str
    ink_muted: str
    grid: str
    context: str  # un-highlighted "everyone else" lines
    series: list[str] = field(default_factory=list)


LIGHT = Theme(
    surface="#fcfcfb",
    ink="#0b0b0b",
    ink_secondary="#52514e",
    ink_muted="#8a8880",
    grid="#e3e2df",
    context="#c9c8c4",
    series=[
        "#2a78d6",  # 1 blue
        "#eb6834",  # 2 orange
        "#1baf7a",  # 3 aqua
        "#eda100",  # 4 yellow
        "#e87ba4",  # 5 magenta
        "#008300",  # 6 green
        "#4a3aa7",  # 7 violet
        "#e34948",  # 8 red
    ],
)

DARK = Theme(
    surface="#1a1a19",
    ink="#ffffff",
    ink_secondary="#c3c2b7",
    ink_muted="#8a8880",
    grid="#343431",
    context="#4a4a46",
    series=[
        "#3987e5",
        "#d95926",
        "#199e70",
        "#c98500",
        "#d55181",
        "#008300",
        "#9085e9",
        "#e66767",
    ],
)

LINE_W = 2.0
MARKER = 5.0  # radius in points -> ~10px diameter

# Two experts with identical answer histories carry identical weights, so their
# lines coincide exactly and the later one hides the earlier. Dash patterns keep
# both visible; they double as the secondary encoding that makes the series
# distinguishable without relying on hue alone.
DASHES = [
    (None, None),  # slot 1 stays solid -- it is usually the leader
    (5, 2),
    (1, 1.6),
    (7, 2, 1.5, 2),
    (3, 1.4),
    (9, 2.4),
    (2, 1.4, 6, 1.4),
    (4, 1.2, 1, 1.2),
]


def _dash(i: int):
    """matplotlib kwargs for the i-th series' dash pattern."""
    pattern = DASHES[i % len(DASHES)]
    if pattern[0] is None:
        return {}
    return {"dashes": pattern}


def _percent_tick(v, _pos=None) -> str:
    """Percent label with just enough decimals to stay distinct on a log axis."""
    if v <= 0:
        return ""
    if v >= 0.01:
        return f"{v:.0%}"
    if v >= 0.001:
        return f"{v:.1%}"
    if v >= 0.0001:
        return f"{v:.2%}"
    return f"{v:.3%}"


def _figure(theme: Theme, size=(10, 5.5)):
    fig, ax = plt.subplots(figsize=size, facecolor=theme.surface)
    ax.set_facecolor(theme.surface)
    ax.grid(True, color=theme.grid, linewidth=0.8, alpha=0.9)
    ax.set_axisbelow(True)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(theme.grid)
    ax.tick_params(colors=theme.ink_secondary, labelsize=9, length=0)
    return fig, ax


def _title(ax, theme: Theme, title: str, subtitle: str | None = None):
    pad = 30 if subtitle else 14
    ax.set_title(title, color=theme.ink, fontsize=13, fontweight="600", loc="left", pad=pad)
    if subtitle:
        ax.text(
            0.0,
            1.015,
            subtitle,
            transform=ax.transAxes,
            color=theme.ink_secondary,
            fontsize=9.5,
            va="bottom",
        )


def _save(fig, out: Path, theme: Theme) -> Path:
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out, dpi=200, bbox_inches="tight", facecolor=theme.surface)
    plt.close(fig)
    return out


def _label_line_ends(ax, theme: Theme, items, min_gap: float = 0.045, markers: bool = True):
    """Direct labels at the right end of each line -- this is what lets the
    low-contrast slots stay legible without relying on the legend swatch.

    Labels are de-collided in axes-fraction space: series whose final values
    are close together (which is common once weights converge) would otherwise
    print on top of each other. Call this *after* the scale and limits are set,
    since it reads the data->axes transform.
    """
    if not items:
        return

    to_axes = ax.transAxes.inverted()
    placed = []
    for x, y, text, color in items:
        if markers:
            # dot sits at the true value, always
            ax.plot([x], [y], "o", color=color, markersize=MARKER, zorder=6,
                    markeredgecolor=theme.surface, markeredgewidth=1.5)
        fx, fy = to_axes.transform(ax.transData.transform((x, y)))
        placed.append([fy, fx, text, color, y])

    # push apart from the bottom up, then clamp back inside the axes
    placed.sort(key=lambda p: p[0])
    for i in range(1, len(placed)):
        if placed[i][0] - placed[i - 1][0] < min_gap:
            placed[i][0] = placed[i - 1][0] + min_gap
    overflow = placed[-1][0] - 1.0
    if overflow > 0:
        for p in placed:
            p[0] -= overflow

    for fy, fx, text, _color, _y in placed:
        ax.annotate(
            text,
            xy=(fx, fy),
            xycoords="axes fraction",
            xytext=(7, 0),
            textcoords="offset points",
            color=theme.ink_secondary,
            fontsize=9,
            va="center",
            fontweight="500",
            annotation_clip=False,
        )


# ---------------------------------------------------------------------------


def plot_daily_rates(run: Run, out: Path, theme: Theme = LIGHT) -> Path:
    """Per-round success rate of Follow i. One series -> one color, no legend."""
    fig, ax = _figure(theme, size=(11, 5))

    xs = [r.index for r in run.rounds]
    ys = [r.p for r in run.rounds]

    ax.bar(xs, ys, width=0.78, color=theme.series[0], zorder=3)

    mean = run.follow_i_rate
    ax.axhline(0.5, color=theme.ink_muted, linewidth=1.4, linestyle=(0, (5, 4)), zorder=4)
    ax.axhline(mean, color=theme.series[1], linewidth=1.6, zorder=4)

    ax.set_xlabel("round", color=theme.ink_secondary, fontsize=10)
    ax.set_ylabel("weight on the correct answer", color=theme.ink_secondary, fontsize=10)
    ax.set_ylim(0, 1)
    ax.set_xlim(0.3, xs[-1] + 0.7)
    ax.yaxis.set_major_formatter(PercentFormatter(1.0))

    # The average often lands within a point or two of the 50% line, so these
    # two labels need the same de-collision treatment as the series labels.
    _label_line_ends(
        ax,
        theme,
        [
            (xs[-1] + 0.7, 0.5, "coin flip, 50%", theme.ink_muted),
            (xs[-1] + 0.7, mean, f"average, {mean:.1%}", theme.series[1]),
        ],
        min_gap=0.05,
        markers=False,
    )
    _title(
        ax,
        theme,
        "Chance of being right on each question",
        f'"Follow i" with growth rate G = {run.growth_rate:.0%}',
    )
    return _save(fig, out, theme)


def plot_cumulative_rates(run: Run, out: Path, theme: Theme = LIGHT) -> Path:
    """Running success rate: the algorithm against its three comparators."""
    fig, ax = _figure(theme)

    n = run.n_rounds
    xs = list(range(1, n + 1))

    follow, wmaj, umaj = [], [], []
    run_p = run_w = run_u = 0.0

    for i, r in enumerate(run.rounds, 1):
        run_p += r.p
        run_w += float(r.weighted_majority_correct)
        run_u += float(r.unweighted_majority_correct)
        follow.append(run_p / i)
        wmaj.append(run_w / i)
        umaj.append(run_u / i)

    # "Best expert in hindsight" is a single number known only at the end, so
    # it is drawn as a flat line -- that is exactly the comparator the slides
    # use, and drawing it as a running curve would imply it was knowable early.
    series = [
        ("Best expert (hindsight)", [run.best_expert_rate] * n, theme.series[3]),
        ('"Follow i"', follow, theme.series[0]),
        ("Weighted majority", wmaj, theme.series[2]),
        ("Plain majority", umaj, theme.series[1]),
    ]

    label_items = []
    for label, ys, color in series:
        ax.plot(xs, ys, color=color, linewidth=LINE_W, solid_capstyle="round", zorder=3)
        label_items.append((xs[-1], ys[-1], f"{label}  {ys[-1]:.0%}", color))

    ax.axhline(0.5, color=theme.ink_muted, linewidth=1.2, linestyle=(0, (5, 4)), zorder=2)

    if run.guarantee > 0:
        ax.axhline(
            run.guarantee,
            color=theme.ink_muted,
            linewidth=1.2,
            linestyle=(0, (2, 3)),
            zorder=2,
        )
        ax.annotate(
            f"guarantee, {run.guarantee:.0%}",
            xy=(1, run.guarantee),
            xytext=(0, 5),
            textcoords="offset points",
            color=theme.ink_muted,
            fontsize=8.5,
        )

    ax.set_xlabel("rounds played", color=theme.ink_secondary, fontsize=10)
    ax.set_ylabel("success rate so far", color=theme.ink_secondary, fontsize=10)
    ax.set_ylim(0, 1)
    ax.set_xlim(1, n * 1.02)
    ax.yaxis.set_major_formatter(PercentFormatter(1.0))
    _label_line_ends(ax, theme, label_items)
    ax.legend(
        handles=[
            plt.Line2D([], [], color=c, linewidth=LINE_W, label=lab)
            for lab, _, c in series
        ],
        loc="lower left",
        frameon=False,
        fontsize=9,
        labelcolor=theme.ink_secondary,
        ncol=2,
    )
    _title(
        ax,
        theme,
        "The algorithm against the alternatives",
        f"{n} questions, {run.n_experts} experts, G = {run.growth_rate:.0%}",
    )
    return _save(fig, out, theme)


def plot_weight_trajectories(
    run: Run, out: Path, top_n: int = 6, theme: Theme = LIGHT
) -> Path:
    """Weight share per expert over time. Top few get identity, rest are context."""
    fig, ax = _figure(theme, size=(11, 5.5))

    top = [s.pseudonym for s in run.expert_stats[:top_n]]
    xs = list(range(1, run.n_rounds + 1))

    for e in run.experts:
        if e in top:
            continue
        ys = [r.weight_shares[e] for r in run.rounds]
        ax.plot(xs, ys, color=theme.context, linewidth=0.9, alpha=0.75, zorder=2)

    label_items = []
    for i, e in enumerate(top):
        color = theme.series[i % len(theme.series)]
        ys = [r.weight_shares[e] for r in run.rounds]
        ax.plot(xs, ys, color=color, linewidth=LINE_W, solid_capstyle="round",
                zorder=4, **_dash(i))
        label_items.append((xs[-1], ys[-1], e, color))

    ax.set_yscale("log")
    ax.set_xlabel("round", color=theme.ink_secondary, fontsize=10)
    ax.set_ylabel("share of total weight (log)", color=theme.ink_secondary, fontsize=10)
    ax.set_xlim(1, run.n_rounds * 1.02)
    ax.xaxis.set_major_locator(MaxNLocator(integer=True))

    # Eliminated experts decay towards zero, so an auto y-range can span six
    # decades and squash the whole story into the top fifth of the plot. Frame
    # on the named series instead; context lines simply run off the bottom,
    # which is a fair reading of what happened to them.
    named = [r.weight_shares[e] for e in top for r in run.rounds]
    named = [v for v in named if v > 0]
    if named:
        ax.set_ylim(min(named) / 3, max(named) * 2)

    # Plain decade ticks leave a log axis nearly unlabelled over the 1-2 decades
    # a class-sized run spans, so tick the 1/2/5 subdivisions too.
    ax.yaxis.set_major_locator(LogLocator(base=10.0, subs=(1.0, 2.0, 5.0), numticks=15))
    ax.yaxis.set_minor_locator(NullLocator())
    ax.yaxis.set_major_formatter(FuncFormatter(_percent_tick))
    _label_line_ends(ax, theme, label_items)

    n_other = run.n_experts - len(top)
    handles = [
        plt.Line2D([], [], color=theme.series[i % len(theme.series)], linewidth=LINE_W,
                   label=e, **_dash(i))
        for i, e in enumerate(top)
    ]
    if n_other > 0:
        handles.append(
            plt.Line2D([], [], color=theme.context, linewidth=0.9, label=f"other ({n_other})")
        )
    ax.legend(
        handles=handles, loc="lower left", frameon=False, fontsize=9,
        labelcolor=theme.ink_secondary, ncol=3,
    )
    _title(
        ax,
        theme,
        "Where the weight went",
        "everyone starts equal; the algorithm concentrates on whoever keeps being right",
    )
    return _save(fig, out, theme)


def plot_growth_sweep(
    sweep: list[tuple[float, float, float]], out: Path, theme: Theme = LIGHT
) -> Path:
    """Empirical success rate and the theoretical bound, both against G."""
    fig, ax = _figure(theme)

    gs = [g for g, _, _ in sweep]
    emp = [e for _, e, _ in sweep]
    bound = [max(0.0, b) for _, _, b in sweep]

    ax.plot(gs, emp, color=theme.series[0], linewidth=LINE_W, solid_capstyle="round", zorder=4)
    ax.plot(gs, bound, color=theme.series[1], linewidth=LINE_W, solid_capstyle="round", zorder=3)

    best_emp = max(range(len(gs)), key=lambda i: emp[i])
    best_bnd = max(range(len(gs)), key=lambda i: bound[i])

    for idx, ys, color, label in (
        (best_emp, emp, theme.series[0], f"best actual  G = {gs[best_emp]:.0%}"),
        (best_bnd, bound, theme.series[1], f"best guaranteed  G = {gs[best_bnd]:.0%}"),
    ):
        ax.plot([gs[idx]], [ys[idx]], "o", color=color, markersize=MARKER + 1,
                markeredgecolor=theme.surface, markeredgewidth=1.5, zorder=6)
        ax.annotate(
            label,
            xy=(gs[idx], ys[idx]),
            xytext=(8, 8),
            textcoords="offset points",
            color=theme.ink_secondary,
            fontsize=9,
            fontweight="500",
        )

    ax.set_xlabel("growth rate G", color=theme.ink_secondary, fontsize=10)
    ax.set_ylabel("success rate", color=theme.ink_secondary, fontsize=10)
    ax.xaxis.set_major_formatter(PercentFormatter(1.0))
    ax.yaxis.set_major_formatter(PercentFormatter(1.0))
    ax.set_ylim(0, 1)
    ax.legend(
        handles=[
            plt.Line2D([], [], color=theme.series[0], linewidth=LINE_W, label="what this class got"),
            plt.Line2D([], [], color=theme.series[1], linewidth=LINE_W, label="what the theorem guarantees"),
        ],
        loc="lower right",
        frameon=False,
        fontsize=9,
        labelcolor=theme.ink_secondary,
    )
    _title(
        ax,
        theme,
        "Tuning the growth rate",
        "the guarantee is worst-case, so the two curves peak in different places",
    )
    return _save(fig, out, theme)


def plot_leaderboard(run: Run, out: Path, top_n: int = 15, theme: Theme = LIGHT) -> Path:
    """Final weight share. One series -> one color; values labelled directly."""
    stats = run.expert_stats[:top_n]
    fig, ax = _figure(theme, size=(9, 0.42 * len(stats) + 2))

    names = [s.pseudonym for s in stats][::-1]
    shares = [s.final_weight_share for s in stats][::-1]
    ys = range(len(names))

    ax.barh(list(ys), shares, height=0.72, color=theme.series[0], zorder=3)
    for y, s, stat in zip(ys, shares, stats[::-1]):
        ax.annotate(
            f"  {s:.1%}   ({stat.correct}/{stat.answered} right)",
            xy=(s, y),
            color=theme.ink_secondary,
            fontsize=9,
            va="center",
        )

    ax.set_yticks(list(ys), names, color=theme.ink, fontsize=9.5)
    ax.set_xlim(0, max(shares) * 1.45 if shares else 1)
    ax.xaxis.set_major_formatter(PercentFormatter(1.0))
    ax.grid(axis="y", visible=False)
    ax.set_xlabel("final share of total weight", color=theme.ink_secondary, fontsize=10)
    _title(
        ax,
        theme,
        "Who the algorithm ended up trusting",
        f"top {len(stats)} of {run.n_experts} by final weight",
    )
    return _save(fig, out, theme)
