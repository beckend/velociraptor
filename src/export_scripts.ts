import { ConfigData } from "./load_config.ts";
import { validateScript } from "./validate_script.ts";
import { isWindows, makeFileExecutable, OneOrMore } from "./util.ts";
import { normalizeScript } from "./normalize_script.ts";
import { CompoundCommandItem } from "./command.ts";
import { log } from "./logger.ts";
import { isParallel } from "./command.ts";
import { buildCommandString } from "./build_command_string.ts";
import { escape } from "./util.ts";
import { ensureDirSync, existsSync, moveSync, path } from "../deps.ts";
import { VR_MARK } from "./consts.ts";

export async function exportScripts(
  configData: ConfigData,
  scripts: string[],
  outDir: string = "bin",
) {
  const { cwd, config } = configData;
  const outDirPath = path.isAbsolute(outDir) ? outDir : path.join(cwd, outDir);
  ensureDirSync(outDirPath);
  if (!scripts || scripts.length < 1) {
    scripts = Object.keys(config.scripts);
  }
  await Promise.all(
    scripts.map(async (script) => {
      validateScript(script, config);
      const scriptDef = config.scripts[script];
      const { scripts, ...rootConfig } = config;
      const commands = normalizeScript(scriptDef, rootConfig);
      const content = generateExecutableFile(commands);
      if (content) {
        const filePath = path.join(outDirPath, script);
        if (
          existsSync(filePath) &&
          !Deno.readTextFileSync(filePath).includes(VR_MARK)
        ) {
          moveSync(filePath, `${filePath}.bkp`);
        }
        await Deno.writeTextFile(filePath, content);
        makeFileExecutable(filePath);
      }
    }),
  );
}

function generateExecutableFile(commands: CompoundCommandItem[]) {
  if (isWindows) {
    log.warning("Scripts exporting only supports sh.");
  }
  return `#!/bin/sh
# ${VR_MARK}

${exportCommands(commands)}
`;
}

function exportCommands(commands: CompoundCommandItem[]): string {
  const _exportCommands = (
    commands: OneOrMore<CompoundCommandItem>,
    doGroup: boolean = false,
  ): string => {
    if (!commands) return "";
    if (Array.isArray(commands)) {
      let res = commands.map((c) => _exportCommands(c, commands.length > 1))
        .join(" && ");
      if (doGroup) res = `( ${res} )`;
      return res;
    } else {
      if (isParallel(commands)) {
        return `( ${
          commands.pll.map((c) => _exportCommands(c, true)).join(" & ")
        }; wait )`;
      }
      const cmd = commands;
      let res = "";
      if (cmd.env) {
        const envVars = Object.entries(cmd.env);
        if (envVars.length > 0) {
          res += envVars
            .map(([key, val]) => `${key}="${escape(val, '"')}"`)
            .join(" ") + " ";
        }
      }
      res += buildCommandString(cmd) + ' "$@"';
      if (doGroup) res = `( ${res} )`;
      return res;
    }
  };
  return _exportCommands(commands);
}
