"""Keeps the review heatmap on the website up to date.

After every sync, and when Anki closes, this writes how many reviews you did each day to
data/anki.json in the website folder. push.sh then commits that file and pushes it to
GitHub in the background. Tools > Update Website Heatmap does the same on demand.
Only the daily counts leave Anki, never card content.

This folder must be linked into Anki's add-ons folder, not copied (see README.md): the
add-on finds the website as the folder that contains it.
"""

from __future__ import annotations

import json
import subprocess
import time
from datetime import date, timedelta
from pathlib import Path

from aqt import gui_hooks, mw
from aqt.qt import QAction, qconnect
from aqt.utils import tooltip

HERE = Path(__file__).resolve().parent  # follows the link in addons21 back to the website
WEBSITE = HERE.parent
OUT = WEBSITE / "data" / "anki.json"


def daily_counts() -> dict:
    """Reviews per day from the first review through today, with zeros for days off.

    A day starts at Anki's "Next day starts at" hour, in the Mac's current time zone.
    Log entries with no answer button (ease 0) are hand reschedules such as Set Due Date
    or Forget, not reviews, so they are left out.
    """
    shift = time.localtime(mw.col.sched.day_cutoff).tm_hour * 3600
    counts = dict(
        mw.col.db.all(
            "select date(id / 1000 - ?, 'unixepoch', 'localtime'), count() from revlog"
            " where ease > 0 group by 1",
            shift,
        )
    )
    today = time.strftime("%Y-%m-%d", time.localtime(time.time() - shift))
    start = min(counts, default=today)
    first = date.fromisoformat(start)
    days = (date.fromisoformat(today) - first).days + 1
    series = [counts.get((first + timedelta(days=i)).isoformat(), 0) for i in range(days)]
    return {"updated": today, "start": start, "counts": series}


def update(manual: bool = False) -> None:
    """Writes data/anki.json, then starts push.sh to commit and push it."""
    try:
        if not mw.col:
            return
        if not OUT.parent.is_dir():
            raise RuntimeError(
                f"{OUT.parent} not found. Link this add-on from the website folder; don't copy it."
            )
        data = daily_counts()
        tmp = OUT.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, separators=(",", ":")) + "\n")
        tmp.replace(OUT)  # swap in the whole file, so push.sh never sees half of one
        # A new session keeps push.sh running after Anki quits. It logs to push.log.
        subprocess.Popen(
            ["/bin/sh", str(HERE / "push.sh"), str(WEBSITE)],
            start_new_session=True,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception as err:  # never let this get in the way of a sync or of closing Anki
        tooltip(f"Website heatmap: {err}")
        return
    if manual:
        tooltip(
            f"Website heatmap: wrote {sum(data['counts']):,} reviews to data/anki.json.<br>"
            "Pushing in the background; anki-addon/push.log says how it went."
        )


def update_now() -> None:
    update(manual=True)


action = QAction("Update Website Heatmap", mw)
qconnect(action.triggered, update_now)
mw.form.menuTools.addAction(action)

gui_hooks.sync_did_finish.append(update)  # also runs for the sync when Anki closes
gui_hooks.profile_will_close.append(update)  # for when syncing on close is off
