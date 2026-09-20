/**
 * Extract the tagged version's section from CHANGELOG.md into
 * release-notes.md — consumed by cli-release.yml to build the GitHub
 * Release body (TRD §14 step 4). Fails loudly if the section is missing,
 * so a release can never ship without matching changelog entries.
 *
 * Usage: GITHUB_REF_NAME=cli-v0.1.0 node scripts/release-notes.mjs
 */

import fs from 'node:fs';

const tag = process.env.GITHUB_REF_NAME ?? '';
const version = tag.replace(/^cli-/, '');

if (!/^v\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error(`release-notes: GITHUB_REF_NAME "${tag}" is not a cli-vX.Y.Z tag`);
  process.exit(1);
}

// Tags are cli-vX.Y.Z; Keep-a-Changelog headings are [X.Y.Z] (no "v").
const bareVersion = version.replace(/^v/, '');

const changelogPath = new URL('../CHANGELOG.md', import.meta.url);
const changelog = fs.readFileSync(changelogPath, 'utf8');

// "## [0.1.0] - 2026-09-20" up to the next "## " heading or EOF. No "m"
// flag on purpose: "$" must mean end-of-file — in multiline mode it also
// matches at the end of the blank line right after the heading, which
// would capture an empty body.
const section = new RegExp(
  `(?:^|\\n)## \\[${bareVersion}\\][^\\n]*\\n([\\s\\S]*?)(?=\\n## |$)`,
);
const match = changelog.match(section);
if (!match) {
  console.error(`release-notes: no CHANGELOG.md section for ${version}`);
  process.exit(1);
}

const notes = match[1]
  .replace(/^\s*\n/, '') // blank line between heading and body
  .replace(/\n+\[[^\]]+\]:\s*\S+\s*$/, '') // link-reference footer
  .trim() + '\n';

fs.writeFileSync('release-notes.md', notes, 'utf8');
console.log(`release-notes: wrote ${notes.split('\n').length} lines for ${version}`);
