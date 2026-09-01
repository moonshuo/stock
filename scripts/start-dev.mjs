import { execFile, spawn } from "child_process";
import { once } from "events";
import path from "path";
import { fileURLToPath } from "url";

const port = 3000;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function listeningPids(targetPort) {
  const { stdout } = await run("netstat", ["-ano", "-p", "tcp"]);
  const expression = new RegExp(`^\\s*TCP\\s+[^\\s]+:${targetPort}\\s+[^\\s]+\\s+LISTENING\\s+(\\d+)\\s*$`, "im");
  return [...new Set(stdout.split(/\r?\n/).map((line) => line.match(expression)?.[1]).filter(Boolean))];
}

async function processName(pid) {
  const { stdout } = await run("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]);
  const [name] = stdout.trim().replace(/^"|"$/g, "").split('","');
  return String(name || "").toLowerCase();
}

async function releasePort() {
  const pids = await listeningPids(port);
  for (const pid of pids) {
    const name = await processName(pid);
    if (name !== "node.exe") {
      throw new Error(`端口 ${port} 正被 ${name || `进程 ${pid}`} 占用；为避免误杀，未自动结束该程序。`);
    }
    console.log(`端口 ${port} 被旧 Next.js 服务（PID ${pid}）占用，正在结束该服务…`);
    // Do not terminate the target's process tree: on Windows that tree can
    // include the invoking terminal/npm chain and close the new dev command.
    await run("taskkill", ["/PID", pid, "/F"]);
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!(await listeningPids(port)).length) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`端口 ${port} 的旧服务未能在 3 秒内退出，请手动关闭后重试。`);
}

await releasePort();
const nextCli = path.join(root, "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [nextCli, "dev", "-p", String(port)], { cwd: root, stdio: "inherit", windowsHide: false });
const [exitCode] = await once(child, "exit");
process.exitCode = exitCode ?? 1;
