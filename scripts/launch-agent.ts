/**
 * Install json-notes as a macOS LaunchAgent so it starts at login and stays up.
 *
 *   bun scripts/launch-agent.ts install [payload dirs/files ...]
 *   bun scripts/launch-agent.ts status
 *   bun scripts/launch-agent.ts logs
 *   bun scripts/launch-agent.ts uninstall
 *
 * Nothing here needs sudo — it is a per-user agent under ~/Library/LaunchAgents.
 */
import { homedir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

const LABEL = "dev.json-notes.server";
const REPO = resolve(import.meta.dir, "..");
const PLIST = join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const LOG_DIR = join(homedir(), "Library", "Logs");
const OUT_LOG = join(LOG_DIR, "json-notes.log");
const ERR_LOG = join(LOG_DIR, "json-notes.err.log");
const TARGET = `gui/${userInfo().uid}`;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function sh(cmd: string[], allowFail = false): Promise<string> {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
  ]);
  const code = await p.exited;
  if (code !== 0 && !allowFail) throw new Error(`${cmd.join(" ")} → ${code}\n${err || out}`);
  return (out + err).trim();
}

function plist(bun: string, port: string): string {
  // No payload paths — the server owns a workspace and files arrive by drag-and-drop,
  // so this plist never needs regenerating when you add a payload.
  const args = [bun, join(REPO, "server.ts")];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${esc(a)}</string>`).join("\n")}
  </array>
  <key>WorkingDirectory</key><string>${esc(REPO)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${esc(join(homedir(), ".bun/bin"))}:/usr/local/bin:/usr/bin:/bin</string>
    <key>PORT</key><string>${esc(port)}</string>
    <key>NODE_ENV</key><string>production</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${esc(OUT_LOG)}</string>
  <key>StandardErrorPath</key><string>${esc(ERR_LOG)}</string>
</dict>
</plist>
`;
}

const cmd = process.argv[2] ?? "status";
const rest = process.argv.slice(3);

if (cmd === "install") {
  const bun = process.execPath;
  const port = process.env.PORT ?? "5174";

  // Optional one-off seeding: any paths given are imported into the workspace now,
  // not baked into the plist.
  if (rest.length) {
    const paths = rest.map((s) => resolve(s));
    for (const p of paths) {
      if (!existsSync(p)) {
        console.error(`no such path: ${p}`);
        process.exit(1);
      }
    }
    console.log(await sh([bun, join(REPO, "server.ts"), "--import", ...paths], true));
  }

  mkdirSync(join(homedir(), "Library", "LaunchAgents"), { recursive: true });
  await Bun.write(PLIST, plist(bun, port));

  // bootout first so re-installing picks up a changed plist.
  await sh(["launchctl", "bootout", `${TARGET}/${LABEL}`], true);

  // launchd reports the service gone before it has finished tearing down, and
  // bootstrapping into that window fails with "Bootstrap failed: 5". Wait it out.
  for (let i = 0; i < 25; i++) {
    const still = await sh(["launchctl", "print", `${TARGET}/${LABEL}`], true);
    if (still.includes("Could not find service")) break;
    await Bun.sleep(200);
  }

  let bootstrapped = false;
  for (let i = 0; i < 5 && !bootstrapped; i++) {
    const out = await sh(["launchctl", "bootstrap", TARGET, PLIST], true);
    if (!/failed|Bad request|error/i.test(out)) bootstrapped = true;
    else await Bun.sleep(500);
  }
  if (!bootstrapped) {
    console.error(`could not bootstrap ${LABEL}. Try:`);
    console.error(`  launchctl bootout ${TARGET}/${LABEL}; launchctl bootstrap ${TARGET} ${PLIST}`);
    process.exit(1);
  }
  await sh(["launchctl", "enable", `${TARGET}/${LABEL}`], true);

  console.log(`installed ${LABEL}  [production build]`);
  console.log(`  plist      ${PLIST}`);
  console.log(`  workspace  ${process.env.JSON_NOTES_HOME ?? join(homedir(), ".json-notes")}`);
  console.log(`  url        http://localhost:${port}`);
  console.log(`  logs       ${OUT_LOG}`);
} else if (cmd === "uninstall") {
  await sh(["launchctl", "bootout", `${TARGET}/${LABEL}`], true);
  if (existsSync(PLIST)) await Bun.file(PLIST).delete();
  console.log(`removed ${LABEL}`);
} else if (cmd === "restart") {
  await sh(["launchctl", "kickstart", "-k", `${TARGET}/${LABEL}`]);
  console.log(`restarted ${LABEL}`);
} else if (cmd === "logs") {
  console.log(await sh(["tail", "-n", "40", OUT_LOG, ERR_LOG], true));
} else {
  console.log(existsSync(PLIST) ? `plist: ${PLIST}` : "not installed");
  console.log(await sh(["launchctl", "print", `${TARGET}/${LABEL}`], true).then((s) =>
    s.split("\n").filter((l) => /state|pid|last exit|program |path =/.test(l)).join("\n"),
  ));
}
