"""Plan rules for cloud processing. Mirrors supabase/functions/_shared/plans.ts: keep them in sync."""

from datetime import datetime, timedelta, timezone

# Seconds of audio per period, jobs per period (None = only seconds), and queue priority.
CLOUD = {
    "free": {"seconds": 30 * 60, "jobs": 1, "priority": False, "quality": "quick", "max_episode": 30 * 60},
    "pro": {"seconds": 3 * 3600, "jobs": None, "priority": True, "quality": "best", "max_episode": None},
    "studio": {"seconds": 10 * 3600, "jobs": None, "priority": True, "quality": "best", "max_episode": None},
}

# Container durations often run a little long; don't refuse a 30:00 episode over that.
GRACE_SECONDS = 30


def effective_plan(profile: dict | None) -> str:
    """Unpaid or ended subscriptions fall back to Free (same rule as effectivePlan in plans.ts)."""
    if not profile or profile.get("plan") not in ("pro", "studio"):
        return "free"
    return profile["plan"] if profile.get("subscription_status") in ("active", "trialing", "past_due") else "free"


def _parse(ts: str | None) -> datetime | None:
    if not ts:
        return None
    # Milliseconds, like JavaScript dates, so periods match what the site computes.
    dt = datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(timezone.utc)
    return dt.replace(microsecond=dt.microsecond // 1000 * 1000)


def current_period_start(plan: str, now: datetime, profile: dict | None) -> datetime:
    """Start of the usage period containing `now` (same rule as currentPeriod in plans.ts)."""
    if plan != "free" and profile:
        start, end = _parse(profile.get("current_period_start")), _parse(profile.get("current_period_end"))
        if start and end and start <= now < end:
            return start
    if plan != "free":
        return datetime(now.year, now.month, 1, tzinfo=timezone.utc)
    # Free weeks start Monday 00:00 UTC.
    monday = now.date() - timedelta(days=now.weekday())
    return datetime(monday.year, monday.month, monday.day, tzinfo=timezone.utc)


def check(plan: str, jobs_used: int, seconds_used: float, seconds: float) -> str | None:
    """Why an episode of `seconds` can't be processed in the cloud this period, or None if it can."""
    rules = CLOUD[plan]
    if rules["max_episode"] is not None and seconds > rules["max_episode"] + GRACE_SECONDS:
        return f"Episodes on your plan can be up to {rules['max_episode'] // 60} minutes long."
    if rules["jobs"] is not None and jobs_used >= rules["jobs"]:
        return "You've used your cloud processing for this week. Upgrade to Pro for 3 hours a month."
    left = rules["seconds"] - seconds_used
    if seconds > left + GRACE_SECONDS:
        return f"This episode needs {round(seconds / 60)} min of cloud processing and you have {max(0, round(left / 60))} min left."
    return None
