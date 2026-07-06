import { promises as fs } from 'fs';
import path from 'path';
import { PROJECTS_DIR } from './project';
import { OUTPUT_DIR } from './render';

// Stopgap disk-space guard: Railway's filesystem is ephemeral, but a long-
// lived instance can still accumulate every source video (PROJECTS_DIR) and
// rendered clip (OUTPUT_DIR) it has ever processed, since nothing else ever
// deletes them. Rather than a separate cron process, this runs as a cheap
// check at the top of /api/transcribe. A real fix (S3/R2-backed storage) can
// replace this later without changing the call site.
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Output files are flat (one per job+variant), so each entry's own mtime is
// the staleness signal.
async function sweepFlatDir(dir: string, cutoffMs: number): Promise<number> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return 0;
  }

  let removed = 0;
  await Promise.all(
    names.map(async (name) => {
      const entryPath = path.join(dir, name);
      try {
        const stats = await fs.stat(entryPath);
        if (stats.mtimeMs < cutoffMs) {
          await fs.rm(entryPath, { force: true });
          removed++;
        }
      } catch {
        // Lost race with another cleanup/request; ignore.
      }
    })
  );
  return removed;
}

// Each project is a directory whose project.json is rewritten on every edit
// (caption edits, style/render changes), so project.json's mtime -- not the
// directory's own mtime, which only changes when entries are added/removed
// -- reflects when the project was last actually touched.
async function sweepProjectDirs(dir: string, cutoffMs: number): Promise<number> {
  let ids: string[];
  try {
    ids = await fs.readdir(dir);
  } catch {
    return 0;
  }

  let removed = 0;
  await Promise.all(
    ids.map(async (id) => {
      const projectPath = path.join(dir, id);
      try {
        const metaStats = await fs.stat(path.join(projectPath, 'project.json'));
        if (metaStats.mtimeMs < cutoffMs) {
          await fs.rm(projectPath, { recursive: true, force: true });
          removed++;
        }
      } catch {
        // No project.json (partial/corrupt dir from a crashed request) --
        // fall back to the directory's own mtime so these don't linger forever.
        try {
          const dirStats = await fs.stat(projectPath);
          if (dirStats.mtimeMs < cutoffMs) {
            await fs.rm(projectPath, { recursive: true, force: true });
            removed++;
          }
        } catch {
          // Lost race with another cleanup/request; ignore.
        }
      }
    })
  );
  return removed;
}

export async function sweepStaleTempFiles(): Promise<void> {
  const cutoffMs = Date.now() - MAX_AGE_MS;

  try {
    const [projectsRemoved, outputsRemoved] = await Promise.all([
      sweepProjectDirs(PROJECTS_DIR, cutoffMs),
      sweepFlatDir(OUTPUT_DIR, cutoffMs),
    ]);

    if (projectsRemoved > 0 || outputsRemoved > 0) {
      console.log(
        `[cleanup] removed ${projectsRemoved} stale project(s) and ${outputsRemoved} stale output file(s) older than 24h`
      );
    }
  } catch (err) {
    // Never let a cleanup failure block the actual request it's piggybacking on.
    console.error('[cleanup] sweep failed:', err instanceof Error ? err.message : String(err));
  }
}
