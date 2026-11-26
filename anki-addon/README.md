# Website Review Heatmap (Anki add-on)

Keeps `data/anki.json`, the data behind the review heatmap on the website, up to date.
After every sync, and when Anki closes, it writes your daily review counts to that file,
commits it, and pushes it to GitHub. GitHub Pages then republishes the site.
**Tools > Update Website Heatmap** does the same on demand.

## Install

Link this folder into Anki's add-ons folder, then restart Anki:

```sh
ln -s ~/Coding/mjohnsonnoya.github.io/anki-addon \
  ~/Library/Application\ Support/Anki2/addons21/website_heatmap
```

Link it, don't copy it: the add-on finds the website as the folder that contains it.

## What it commits and pushes

- It commits only `data/anki.json`, with the message "Update Anki review counts".
  Other changes you are working on are left alone, staged or not.
- Its commits are authored by "Anki heatmap <anki-heatmap@noreply.invalid>", not by you,
  so syncing doesn't count as a GitHub contribution or show up in the GitHub heatmap.
- It pushes only when its own commits are the only ones GitHub doesn't have yet. If you
  have unpushed commits of your own, it waits, and the counts go up with your next push.
- `push.log` in this folder records what happened on each run.
