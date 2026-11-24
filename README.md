# NFL EPA feed — 2026

Two-stage import for **NFL Historic** Google Sheets. GitHub Actions processes nflverse compressed season play-by-play outside Google Apps Script and publishes a compact 26-column per-team/per-game CSV. Apps Script then appends missing team-game rows and fills ONLY empty metric cells in the main 2026 sheet.

## Step 1: Generate the feed in GitHub

1. Open [Actions: Refresh NFL EPA team-game feed](https://github.com/doctorbb2b/nfl-epa-feed/actions/workflows/refresh-nfl-epa.yml).
2. Click **Run workflow**, select **main**, then **Run workflow**.
3. Confirm the job turns green and that both files appear under the data folder: nfl_2026_team_games.csv and nfl_2026_status.json.
4. If the workflow cannot commit because the token is read-only, change Settings → Actions → General → Workflow permissions to Read and write permissions if allowed.

The workflow also schedules two checks daily during NFL-season months, at 11:15 and 16:15 UTC. GitHub scheduling may be delayed. Inspect latest_game_date in the published status JSON to confirm nflverse actually includes recent games.

## Step 2: Connect the existing Google Sheet

1. Open [NFL Historic](https://docs.google.com/spreadsheets/d/1kGssKpKg8I9kbW9L7y1HFboOZUpNt-BcpsQRvBhf_G8/edit) → Extensions → Apps Script.
2. Back up then replace the contents of your existing NFL_2026_Advanced_Importer.gs with this repository's [Apps Script replacement](NFL_2026_Advanced_Importer.gs). Do not add a second definition of NFL26 or NFL_refresh2026.
3. Run NFL26_DELTA_install once. Approve Apps Script permissions. This runs an immediate backfill and installs a daily approximately 8 AM Eastern check.
4. Verify log messages NFL EPA FEED OK and NFL EPA CONNECT. Confirm the stage tab includes games after November 16, and the 2026 tab AM:BD shows the available advanced stats for completed games.

Preserve the existing NFL26_REPAIR_run score updater. It can call the replacement small-feed NFL_refresh2026 function. Do not leave a second copy of the old full-season URL downloader active under another name.

## Safety

- GitHub Actions reads the nflverse processed season file externally; Google Apps Script downloads only the smaller 26-column team-game feed.
- The Apps Script importer does not clear staging, overwrites no populated metric in the main sheet, and leaves scores, betting profiles, odds, and historical frozen snapshots untouched.
- Missing game pairs, duplicate keys, schema changes, stale feed dates, and recent missing records trigger visible errors.
- Data may lag nflverse publication; a green GitHub job alone does not prove completeness.

## Files

- [Python processor](scripts/build_nfl_epa.py)
- [Apps Script replacement](NFL_2026_Advanced_Importer.gs)
- [Scheduled GitHub workflow](.github/workflows/refresh-nfl-epa.yml)
- [Processed nflverse PBP source](https://github.com/nflverse/nflverse-data/releases/tag/pbp)
