import Icon from './Icon'
import type { IconName } from './Icon'
import PageHeader from './PageHeader'

/** Placeholder for pages whose real content arrives in a later module.
 *  It shows no numbers: only a description of what will live here. */
export default function ComingSoon({
  title,
  description,
  module,
  icon,
  willInclude,
}: {
  title: string
  description: string
  module: string
  icon: IconName
  willInclude: string[]
}) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900 sm:p-12">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-50 text-teal-600 dark:bg-teal-500/10 dark:text-teal-300">
          <Icon name={icon} className="h-7 w-7" />
        </div>
        <span className="mt-5 inline-block rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
          Coming in {module}
        </span>
        <h2 className="mt-4 text-lg font-semibold">This page is wired into the app and waiting for its module</h2>
        <ul className="mx-auto mt-5 max-w-md space-y-2 text-left text-sm text-slate-600 dark:text-slate-300">
          {willInclude.map((line) => (
            <li key={line} className="flex gap-3">
              <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}
