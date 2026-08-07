// Site metadata and navigation.
//
// `nav` is the single source of truth for both the sidebar order and which files get
// built. A markdown file in content/ that is not listed here is NOT published — the
// build fails loudly on the mismatch rather than silently dropping or orphaning a page.

export const site = {
  title: 'Expert Vote — Operator Handbook',
  shortTitle: 'Operator Handbook',
  description:
    'Everything you need to run the ETH Expert Algorithm voting app for a semester: daily operations, the admin console, cron setup, deployment, and lecture day.',
  repo: 'https://github.com/', // set to the real repo URL if you have one
}

export const nav = [
  {
    section: 'Start here',
    items: [
      { file: 'index.md', title: 'Overview', slug: 'index' },
      { file: 'getting-started.md', title: 'Getting started', slug: 'getting-started' },
    ],
  },
  {
    section: 'Running the app',
    items: [
      { file: 'daily-operations.md', title: 'Daily operations', slug: 'daily-operations' },
      { file: 'question-lifecycle.md', title: 'Question lifecycle', slug: 'question-lifecycle' },
      { file: 'admin-console.md', title: 'Admin console', slug: 'admin-console' },
      { file: 'cron-setup.md', title: 'Cron setup', slug: 'cron-setup' },
    ],
  },
  {
    section: 'Infrastructure',
    items: [
      { file: 'deployment.md', title: 'Deployment', slug: 'deployment' },
      {
        file: 'external-services.md',
        title: 'External services',
        slug: 'external-services',
      },
      { file: 'troubleshooting.md', title: 'Troubleshooting', slug: 'troubleshooting' },
      { file: 'semester-reset.md', title: 'Semester reset', slug: 'semester-reset' },
      { file: 'handover.md', title: 'Handover', slug: 'handover' },
    ],
  },
  {
    section: 'Reference',
    items: [
      { file: 'lecture-day.md', title: 'Lecture day', slug: 'lecture-day' },
      { file: 'reference.md', title: 'Reference', slug: 'reference' },
    ],
  },
]

/** Flattened nav, in sidebar order — used for prev/next links and the search index. */
export const pages = nav.flatMap((s) => s.items.map((i) => ({ ...i, section: s.section })))
