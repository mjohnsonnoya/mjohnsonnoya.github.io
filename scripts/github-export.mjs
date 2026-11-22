// Writes daily GitHub contribution counts (the calendar on your profile) to data/github.json
// for the contribution heatmap. Uses the GitHub CLI's login (`gh auth login`).
// Run with: npm run github. It also runs daily on GitHub (.github/workflows/github-heatmap.yml).
// The counts match the public profile, which already shows private-repo activity as numbers
// if "Private contributions" is on in your GitHub profile settings.

import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

const OUT = new URL('../data/github.json', import.meta.url);

function gh(args) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    const why = err.code === 'ENOENT' ? 'The GitHub CLI (gh) is not installed.' : (err.stderr || err.message).trim();
    throw new Error(`gh ${args[0]} ${args[1]} failed: ${why}`);
  }
}

const login = process.env.GITHUB_USER ?? gh(['api', 'user', '--jq', '.login']).trim();
const query = `query($login: String!) {
  user(login: $login) {
    contributionsCollection { contributionCalendar { weeks { contributionDays { date contributionCount } } } }
  }
}`;
const res = JSON.parse(gh(['api', 'graphql', '-F', `login=${login}`, '-f', `query=${query}`]));
// The calendar covers the past year, one entry per day, already in date order.
const days = res.data.user.contributionsCollection.contributionCalendar.weeks.flatMap((w) => w.contributionDays);

const counts = days.map((d) => d.contributionCount);
await writeFile(OUT, JSON.stringify({ updated: days.at(-1).date, start: days[0].date, counts }) + '\n');
const total = counts.reduce((a, b) => a + b, 0);
console.log(`Wrote ${days.length} days (${days[0].date} to ${days.at(-1).date}), ${total.toLocaleString('en-US')} contributions for ${login}, to data/github.json`);
