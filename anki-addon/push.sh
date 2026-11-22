#!/bin/sh
# Commits data/anki.json and pushes it to GitHub. __init__.py starts this in the background
# after writing the file, so it finishes even if Anki has quit. Output goes to push.log.
# Usage: push.sh <website folder>
#
# It never publishes work of yours: it commits only data/anki.json, and it pushes only
# when every commit that GitHub doesn't have yet is one of its own.

SUBJECT="Update Anki review counts"
FILE=data/anki.json
PATH="/opt/homebrew/bin:/usr/local/bin:$PATH:/usr/bin:/bin" # Anki's own PATH is minimal
GIT_TERMINAL_PROMPT=0 # no terminal to ask for a password in; fail instead
export PATH GIT_TERMINAL_PROMPT

log="$(cd "$(dirname "$0")" && pwd)/push.log"
cd "$1" || exit 1
git_dir=$(git rev-parse --absolute-git-dir 2>/dev/null) || {
  echo "== $(date '+%F %T')
$1 is not a git repository yet, so $FILE was updated but not committed." >>"$log"
  exit 1
}

# One run at a time: when Anki closes it calls this twice (before and after its sync).
lock="$git_dir/anki-heatmap.lock"
tries=0
until shlock -f "$lock" -p $$; do
  tries=$((tries + 1))
  [ "$tries" -ge 120 ] && exit 1
  sleep 1
done
trap 'rm -f "$lock"' EXIT

# Keep only the last 200 lines of the log.
[ -f "$log" ] && tail -n 200 "$log" >"$log.tmp" && mv "$log.tmp" "$log"
exec >>"$log" 2>&1
echo "== $(date '+%F %T')"

if [ -n "$(git status --porcelain -- "$FILE")" ]; then
  git add -- "$FILE" && git commit --quiet -m "$SUBJECT" -- "$FILE" || exit 1
  echo "Committed $FILE."
fi

if ! git rev-parse --verify --quiet '@{upstream}' >/dev/null; then
  echo "This branch isn't connected to GitHub yet, so nothing was pushed."
  exit 0
fi
if [ -z "$(git rev-list '@{upstream}..HEAD')" ]; then
  echo "Nothing to push."
  exit 0
fi
if git log --format=%s '@{upstream}..HEAD' | grep -qvxF "$SUBJECT"; then
  echo "Not pushing: you have commits of your own that aren't on GitHub yet."
  echo "The review counts will go up with your next git push."
  exit 0
fi

git fetch --quiet || exit 1
if [ -n "$(git rev-list 'HEAD..@{upstream}')" ]; then
  # GitHub has commits this copy doesn't (made on github.com, or by a workflow). Replay
  # the review-count commits on top of them, but only when that can't touch uncommitted edits.
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echo "Not pushing: GitHub has newer commits and you have uncommitted changes."
    echo "Run git pull when you're ready; the next sync will push."
    exit 0
  fi
  git rebase --quiet '@{upstream}' || {
    git rebase --abort
    echo "Could not catch up with GitHub; nothing pushed."
    exit 1
  }
  echo "Caught up with newer commits from GitHub."
fi
git push --quiet && echo "Pushed."
