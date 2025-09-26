export const layout = {
  appShell: 'flex min-h-screen flex-col bg-slate-50 text-slate-900',
  main: 'flex-1',
  page: 'mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-8',
  header: 'flex flex-wrap items-center justify-between gap-4',
  sectionHeader: 'flex flex-wrap items-center justify-between gap-3',
  card: 'rounded-2xl bg-white p-6 shadow-xl shadow-slate-900/10 ring-1 ring-slate-200/60',
  cardActions: 'flex flex-wrap items-center gap-3',
  grid: 'grid gap-4 sm:grid-cols-2',
  tableWrapper: 'overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm',
  statusBar: 'flex flex-wrap items-center gap-4 bg-slate-900 px-6 py-3 text-xs text-white/80'
};

export const button = {
  base: 'inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60',
  primary: 'inline-flex items-center justify-center rounded-lg border border-primary bg-primary px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60',
  muted: 'inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white/80 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60',
  nav: 'inline-flex items-center justify-center rounded-md border border-white/40 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 disabled:cursor-not-allowed disabled:opacity-60',
  link: 'inline-flex items-center justify-center rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2'
};

export const text = {
  subtle: 'text-sm text-slate-500',
  mono: 'font-mono break-all text-slate-800',
  hint: 'text-xs text-slate-500'
};

export const table = {
  base: 'min-w-full divide-y divide-slate-200 text-left text-sm text-slate-700',
  headRow: 'bg-slate-50',
  headCell: 'px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500',
  cell: 'px-4 py-3 align-top',
  row: 'even:bg-slate-50/40'
};

export const surface = {
  pill: 'inline-flex items-center rounded-full bg-white/75 px-3 py-1 text-xs font-semibold text-slate-900 shadow-sm ring-1 ring-slate-200',
  badge: 'inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600',
  codeBlock: 'overflow-x-auto rounded-xl bg-slate-900/90 p-4 font-mono text-sm text-lime-200'
};

export const form = {
  label: 'flex flex-col gap-2 text-sm font-medium text-slate-700',
  input: 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/60',
  textarea: 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/60',
  checkbox: 'flex items-center gap-3 text-sm text-slate-700',
  radio: 'flex items-center gap-3 text-sm text-slate-700'
};
