// Pre-mutation backup into the nearest `_历史版本/` (ported from the lop-action-fusion Pi extension).
// No model calls; one backup per (session, file); a failed backup blocks the write.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type Backup = { dest?: string; skipped?: string };
export type BackupOptions = {
  enabled?: boolean;                       // LOP_AUTO_BACKUP=0 turns it off
  maxBytes?: number;                       // larger files are skipped (logged), not blocked
  tmpdir?: string;                         // OS temp dir: scratch/fixture files are not backed up
  historyDir?: (file: string) => string;   // injectable for tests
  done?: Set<string>;                      // one backup per (session, file)
};

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
// Protected configs keep the manual `bak` + pretool gate C1 (rules-pretool.mjs); never duplicate them here.
const PROTECTED = /\/\.claude\/|\/\.pi\/|\/(claude|agents)\.md$/i;
const SESSION_DONE = new Set<string>();

const digest = (value: string | Buffer) => crypto.createHash("sha256").update(value).digest("hex");
const norm = (p: string) => p.replace(/\\/g, "/");
const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);

/** Same lookup as tools/backup.mjs: nearest _历史版本/ within 6 levels, else create one beside the file. */
export function historyDirFor(file: string): string {
  let dir = path.dirname(file);
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "_历史版本");
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const local = path.join(path.dirname(file), "_历史版本");
  fs.mkdirSync(local, { recursive: true });
  return local;
}

/** Back up an existing file before its first mutation in this session. Throws on failure (caller must not write). */
export function autoBackup(abs: string, sessionKey: string, opts: BackupOptions = {}): Backup {
  if (opts.enabled === false) return { skipped: "disabled" };
  const done = opts.done ?? SESSION_DONE;
  const key = `${sessionKey}|${abs.toLowerCase()}`;
  if (done.has(key)) return { skipped: "already-backed-up" };
  let st: fs.Stats;
  try { st = fs.statSync(abs); } catch { return { skipped: "new-file" }; }
  if (!st.isFile()) return { skipped: "not-a-file" };
  const p = norm(abs);
  if (PROTECTED.test(p)) return { skipped: "protected-config-uses-manual-bak" };
  const tmp = norm(opts.tmpdir ?? os.tmpdir()).toLowerCase();
  if (p.toLowerCase().startsWith(`${tmp}/`)) return { skipped: "temp-dir" };
  if (p.split("/").some((seg) => seg === "node_modules" || seg === ".git" || seg === "_历史版本")) return { skipped: "excluded-dir" };
  if (st.size > (opts.maxBytes ?? DEFAULT_MAX_BYTES)) return { skipped: "too-large" };
  const dir = (opts.historyDir ?? historyDirFor)(abs);
  const base = `${path.basename(abs)}.bak-${stamp()}-auto`;
  let dest = path.join(dir, base);
  for (let n = 1; fs.existsSync(dest); n++) dest = path.join(dir, `${base}-${n}`);
  fs.copyFileSync(abs, dest, fs.constants.COPYFILE_EXCL);
  if (digest(fs.readFileSync(abs)) !== digest(fs.readFileSync(dest))) throw new Error("backup readback hash mismatch");
  done.add(key);
  return { dest };
}

/** Post-write readback done by the tool itself, so the model does not need an extra read round. */
export function receipt(abs: string, bk: Backup): string {
  try {
    const buf = fs.readFileSync(abs);
    const text = buf.toString("utf8");
    const lines = text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
    return `[auto-receipt] sha256=${digest(buf).slice(0, 12)} ${buf.length}B ${lines}L${bk.dest ? ` backup=${bk.dest}` : ""}`;
  } catch (error) {
    return `[auto-receipt] unavailable: ${String(error).slice(0, 80)}`;
  }
}
