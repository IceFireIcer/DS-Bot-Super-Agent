import { pathToFileURL } from 'node:url'

export const jobs = [
  ['test', 'SCOPE_TEST', 'RESULT_TEST'],
  ['superagent', 'SCOPE_SUPERAGENT', 'RESULT_SUPERAGENT'],
  ['app', 'SCOPE_APP', 'RESULT_APP'],
  ['mobile', 'SCOPE_MOBILE', 'RESULT_MOBILE'],
  ['app-package', 'SCOPE_APP_PACKAGE', 'RESULT_APP_PACKAGE'],
  ['app-package-macos', 'SCOPE_APP_PACKAGE', 'RESULT_APP_PACKAGE_MACOS'],
  ['app-package-linux', 'SCOPE_APP_PACKAGE', 'RESULT_APP_PACKAGE_LINUX'],
  ['docker', 'SCOPE_DOCKER', 'RESULT_DOCKER'],
]

export function checkResults({ changes, scan, results }) {
  const problems = []
  if (changes !== 'success') problems.push(`Change scope: ${changes || 'missing'}`)
  if (scan !== 'success') problems.push(`Leak scan: ${scan || 'missing'}`)
  for (const job of results) {
    if (job.result === 'failure' || job.result === 'cancelled') problems.push(`${job.name}: ${job.result}`)
    else if (job.required === 'true' && job.result !== 'success') problems.push(`${job.name}: the change requires this job, but it was ${job.result || 'missing'}`)
  }
  return problems
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problems = checkResults({
    changes: process.env.CHANGES ?? '',
    scan: process.env.SCAN ?? '',
    results: jobs.map(([name, scope, result]) => ({
      name, required: process.env[scope] ?? '', result: process.env[result] ?? '',
    })),
  })
  if (problems.length) {
    console.error(problems.join('\n'))
    process.exitCode = 1
  } else console.log('Every job required by the change passed.')
}
