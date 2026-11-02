/*
 * Non-Lua trigger interpreter (V1 + V2 "block" triggers).
 *
 * Ported from RisuAI `src/ts/process/triggers.ts` (`runTrigger`), (c) kwaroran and
 * RisuAI contributors, licensed AGPL-3.0. This file is distributed under AGPL-3.0 as
 * part of this project. The RPN calculator at the bottom is ported from RisuAI
 * `src/ts/process/infunctions.ts` (`calcString`).
 *
 * The module is self-contained: every side effect goes through `TriggerHost`.
 *
 * Mapping from RisuAI:
 *   risuChatParser(x,{chara})  -> host.cbs(x)
 *   chat.scriptstate get/set   -> host.getVar / host.setVar
 *   getGlobalChatVar           -> host.getGlobal (used by v2Calculate `@name`)
 *   chat.message               -> host.chat (cloned while running, written back in place at the end)
 *   alertNormal/Error/Input/Select -> host.*
 *   char.desc / persona prompt / chat.note / char.replaceGlobalNote -> host.description /
 *       host.personaDescription / host.authorNote / host.replaceGlobalNote (+ optional setters)
 *   char.globalLore            -> host.lorebook (optional, mutated in place)
 *
 * Fully implemented effects
 *   V1: setvar, systemprompt, impersonate, stop, runtrigger, cutchat, modifychat,
 *       showAlert*, sendAIprompt*, extractRegex*  (* = needs trigger.lowLevelAccess, as in RisuAI)
 *   V2: v2Header, v2Comment, v2SetVar, v2DeclareLocalVar, v2If, v2IfAdvanced, v2Else,
 *       v2EndIndent, v2Loop, v2LoopNTimes, v2BreakLoop, v2RunTrigger, v2ConsoleLog,
 *       v2StopTrigger, v2StopPromptSending, v2CutChat, v2ModifyChat, v2SystemPrompt,
 *       v2Impersonate, v2SendAIprompt*, v2ShowAlert, v2ExtractRegex, v2RegexTest,
 *       v2ReplaceString, v2GetLastMessage, v2GetMessageAtIndex, v2GetMessageCount,
 *       v2GetLastUserMessage, v2GetLastCharMessage, v2GetFirstMessage, v2QuickSearchChat,
 *       v2Random, v2GetCharAt, v2GetCharCount, v2ToLowerCase, v2ToUpperCase, v2SetCharAt,
 *       v2SplitString, v2JoinArrayVar, v2ConcatString, v2MakeArrayVar, v2GetArrayVarLength,
 *       v2GetArrayVar, v2SetArrayVar, v2PushArrayVar, v2PopArrayVar, v2ShiftArrayVar,
 *       v2UnshiftArrayVar, v2SpliceArrayVar, v2SliceArrayVar, v2GetIndexOfValueInArrayVar,
 *       v2RemoveIndexFromArrayVar, v2MakeDictVar, v2GetDictVar, v2SetDictVar, v2DeleteDictKey,
 *       v2HasDictKey, v2ClearDict, v2GetDictSize, v2GetDictKeys, v2GetDictValues, v2Calculate,
 *       v2GetAlertInput, v2GetAlertSelect, v2GetDisplayState, v2SetDisplayState,
 *       v2GetRequestState, v2SetRequestState, v2GetRequestStateRole, v2SetRequestStateRole,
 *       v2GetRequestStateLength, v2UpdateGUI, v2UpdateChatAt (both -> result.reload), v2Wait,
 *       v2GetCharacterDesc, v2SetCharacterDesc, v2GetPersonaDesc, v2SetPersonaDesc,
 *       v2GetAuthorNote, v2SetAuthorNote, v2GetReplaceGlobalNote, v2SetReplaceGlobalNote
 *   Lorebook (operate on host.lorebook when given; otherwise read 'null'/'[]'/'0', writes no-op):
 *       v2GetAllLorebooks, v2GetLorebookByName, v2GetLorebookByIndex, v2CreateLorebook,
 *       v2ModifyLorebookByIndex, v2DeleteLorebookByIndex, v2GetLorebookCountNew,
 *       v2SetLorebookAlwaysActive, v2GetLorebookCount
 *   Legacy tuple-style lorebook effects (v2GetLorebook, v2GetLorebookEntry,
 *       v2GetLorebookIndexViaName, v2ModifyLorebook, v2SetLorebookActivation) index entries
 *       as `[name, content, active]` arrays, which never match RisuAI's object lore entries;
 *       we reproduce their effective result ('null' / '-1' / no-op).
 *
 * Host-callback / stubbed effects
 *   runLLM*, v2RunLLM*        -> host.runLLM(prompt, model) if given; else V1 writes
 *                                "Error: runLLM is not supported", V2 writes 'null'.
 *   checkSimilarity*, v2CheckSimilarity* -> host.similaritySearch if given; else ''.
 *   runImgGen*, v2ImgGen*     -> unsupported: V1 writes "Error: Image generation failed", V2 'null'.
 *   v2Tokenize                -> host.tokenize if given; else a rough ceil(chars/4) estimate.
 *   command, v2Command        -> host.runCommand if given; else no-op.
 *   triggerlua, triggercode   -> skipped (Lua is handled elsewhere). Like RisuAI, a trigger whose
 *                                first effect is Lua is selected regardless of mode/manualName.
 *   runAxLLM                  -> not handled by RisuAI's runTrigger either (no-op).
 *
 * Deliberate deviations (safety only)
 *   - A trigger aborts after MAX_LOOP_ITERATIONS loop-backs (RisuAI would spin forever).
 *   - runtrigger with lowLevelAccess bypasses the depth-10 limit (as RisuAI) but is hard-capped
 *     at MAX_LOWLEVEL_RECURSION.
 *   - V1 extractRegex with no match yields an empty substitution instead of throwing.
 *   - v2SetRequestState(Role) on a missing index is ignored instead of throwing.
 *   Other errors (e.g. an invalid regex in an `exists` condition) propagate like in RisuAI:
 *   callers should wrap runTriggers in try/catch.
 */

export interface TriggerChat { role: "user" | "char"; data: string; time?: number }

export interface TriggerLore {
  key?: string;
  comment?: string;
  content?: string;
  insertorder?: number;
  alwaysActive?: boolean;
  [k: string]: unknown;
}

export interface TriggerHost {
  chat: TriggerChat[];                       // mutable; caller reads it back after the run (excludes the first/greeting message, like RisuAI chat.message)
  getVar: (key: string) => string;           // returns "null" when missing (chat variables, already falls back to defaultVariables)
  setVar: (key: string, value: string) => void;
  getGlobal: (key: string) => string;        // "null" when missing
  cbs: (text: string) => string;             // CBS parser (stand-in for risuChatParser(text,{chara}))
  alertNormal: (m: string) => void;
  alertError: (m: string) => void;
  alertInput: (m: string) => Promise<string | null>;
  alertSelect: (options: string[]) => Promise<string | null>;
  firstMessage?: string;
  description?: string;
  personaDescription?: string;
  authorNote?: string;

  // ---- optional extensions (all may be omitted) ----
  replaceGlobalNote?: string;
  setDescription?: (v: string) => void;
  setPersonaDescription?: (v: string) => void;
  setAuthorNote?: (v: string) => void;
  setReplaceGlobalNote?: (v: string) => void;
  /** Character lorebook; lorebook effects mutate this array in place and then call onLorebookChange. */
  lorebook?: TriggerLore[];
  onLorebookChange?: () => void;
  /** Raw prompt (may be ChatML, RisuAI parses it with parseChatML). Return null on failure. */
  runLLM?: (prompt: string, model: "model" | "submodel") => Promise<string | null>;
  similaritySearch?: (source: string, candidates: string[]) => Promise<string[]>;
  tokenize?: (text: string) => number | Promise<number>;
  runCommand?: (command: string) => void | Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  log?: (v: string) => void;
}

export interface RisuTrigger { comment?: string; type?: string; conditions?: any[]; effect?: any[]; lowLevelAccess?: boolean }

export interface TriggerResult {
  stop: boolean;                              // stop sending (V1 'stop', v2StopPromptSending)
  sendAIprompt: boolean;
  systemPrompt: { start: string; historyend: string; promptend: string }; // accumulated 'systemprompt' effects by location
  displayData?: string;                       // for mode 'display' (RisuAI arg.displayData / v2GetDisplayState/v2SetDisplayState)
  reload: boolean;                            // v2UpdateGUI etc.
}

type TriggerMode = "start" | "input" | "output" | "display" | "manual" | "request";
type SysPrompt = { start: string; historyend: string; promptend: string };

const MAX_LOOP_ITERATIONS = 100_000;
const MAX_LOWLEVEL_RECURSION = 50;

const safeSubset = [
  "v2SetVar", "v2If", "v2IfAdvanced", "v2Else", "v2EndIndent", "v2LoopNTimes", "v2BreakLoop",
  "v2ConsoleLog", "v2StopTrigger", "v2Random", "v2ExtractRegex", "v2RegexTest", "v2GetCharAt",
  "v2GetCharCount", "v2ToLowerCase", "v2ToUpperCase", "v2SetCharAt", "v2SplitString",
  "v2JoinArrayVar", "v2ConcatString", "v2MakeArrayVar", "v2GetArrayVarLength", "v2GetArrayVar",
  "v2SetArrayVar", "v2PushArrayVar", "v2PopArrayVar", "v2ShiftArrayVar", "v2UnshiftArrayVar",
  "v2SpliceArrayVar", "v2SliceArrayVar", "v2GetIndexOfValueInArrayVar", "v2RemoveIndexFromArrayVar",
  "v2Calculate", "v2Comment", "v2DeclareLocalVar",
];

export const displayAllowList = ["v2GetDisplayState", "v2SetDisplayState", ...safeSubset];

export const requestAllowList = [
  "v2GetRequestState", "v2SetRequestState", "v2GetRequestStateRole", "v2SetRequestStateRole",
  "v2GetRequestStateLength", ...safeSubset,
];

interface Flags { reload: boolean }

interface RunCtx {
  recursiveCount: number;
  sysPrompt: SysPrompt;
  stopSending: boolean;
  manualName?: string;
  displayMode: boolean;
  displayData?: string;
  chat: TriggerChat[];
  flags: Flags;
}

interface RunOut {
  sysPrompt: SysPrompt;
  chat: TriggerChat[];
  stopSending: boolean;
  sendAIprompt: boolean;
  displayData?: string;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Thrown internally to emulate RisuAI's bare `return` (abort the whole run, result discarded). */
const ABORT = Symbol("abort");

export async function runTriggers(
  triggers: RisuTrigger[],
  mode: "start" | "input" | "output" | "display" | "manual" | "request",
  host: TriggerHost,
  arg?: { manualName?: string; displayData?: string; recursiveCount?: number },
): Promise<TriggerResult> {
  // RisuAI calls runTrigger with displayMode:true for both 'display' and 'request'.
  const displayMode = mode === "display" || mode === "request";
  const flags: Flags = { reload: false };
  const out = await runInternal(triggers, mode, host, {
    recursiveCount: arg?.recursiveCount ?? 0,
    sysPrompt: { start: "", historyend: "", promptend: "" },
    stopSending: false,
    manualName: arg?.manualName,
    displayMode,
    displayData: arg?.displayData,
    chat: host.chat,
    flags,
  });
  if (!out) {
    // RisuAI returns null/undefined here: callers discard everything (chat edits included).
    return {
      stop: false,
      sendAIprompt: false,
      systemPrompt: { start: "", historyend: "", promptend: "" },
      displayData: arg?.displayData,
      reload: flags.reload,
    };
  }
  if (!displayMode && out.chat !== host.chat) {
    host.chat.splice(0, host.chat.length, ...out.chat);
  }
  return {
    stop: out.stopSending,
    sendAIprompt: out.sendAIprompt,
    systemPrompt: out.sysPrompt,
    displayData: out.displayData,
    reload: flags.reload,
  };
}

async function runInternal(
  triggers: RisuTrigger[],
  mode: TriggerMode,
  host: TriggerHost,
  ctx: RunCtx,
): Promise<RunOut | null> {
  try {
    return await runBody(triggers, mode, host, ctx);
  } catch (e) {
    if (e === ABORT) return null;
    throw e;
  }
}

async function runBody(
  triggers: RisuTrigger[],
  mode: TriggerMode,
  host: TriggerHost,
  ctx: RunCtx,
): Promise<RunOut | null> {
  const displayMode = ctx.displayMode;
  let stopSending = ctx.stopSending;
  let sendAIprompt = false;
  let additonalSysPrompt = ctx.sysPrompt;
  let chat: TriggerChat[] = displayMode ? ctx.chat : ctx.chat.map((m) => ({ ...m }));
  let displayData = ctx.displayData;
  const sleep = host.sleep ?? defaultSleep;

  if (!triggers || triggers.length === 0) return null;

  const tempVarsDisplay: Record<string, string> = {};
  let localVarScopes: Record<number, Record<string, string>>[] = [{}];
  let currentIndent = 0;

  const cbs = (s: unknown): string => host.cbs(s === undefined || s === null ? "" : String(s));

  function getLocalVar(key: string): string | null {
    const scope = localVarScopes[localVarScopes.length - 1];
    if (!scope) return null;
    for (let indent = currentIndent; indent >= 0; indent--) {
      if (scope[indent] && scope[indent][key] !== undefined) return scope[indent][key];
    }
    return null;
  }

  function setLocalVar(key: string, value: string, indent: number): boolean {
    if (localVarScopes.length === 0) localVarScopes = [{}];
    const scope = localVarScopes[localVarScopes.length - 1];
    const finalValue = value === null || value === undefined ? "null" : value;
    let foundIndent = -1;
    for (let i = indent; i >= 0; i--) {
      if (scope[i] && scope[i][key] !== undefined) { foundIndent = i; break; }
    }
    const target = foundIndent !== -1 ? foundIndent : indent;
    if (!scope[target]) scope[target] = {};
    if (scope[target][key] === finalValue) return false;
    scope[target][key] = finalValue;
    return true;
  }

  function clearLocalVarsAtIndent(indent: number) {
    const scope = localVarScopes[localVarScopes.length - 1];
    if (!scope) return;
    for (const k of Object.keys(scope)) {
      if (Number(k) >= indent) delete scope[Number(k)];
    }
  }

  function getVar(key: string): string {
    const local = getLocalVar(key);
    if (local !== null) return local;
    const v = host.getVar(key);
    if ((v === "null" || v === undefined || v === null) && displayMode) {
      return tempVarsDisplay[key] ?? "null";
    }
    return v ?? "null";
  }

  function setVar(key: string, value: string | null | undefined) {
    const v = value === null || value === undefined ? "null" : String(value);
    if (displayMode) {
      tempVarsDisplay[key] = v;
      return;
    }
    if (getLocalVar(key) !== null) {
      setLocalVar(key, v, currentIndent);
      return;
    }
    if (host.getVar(key) !== v) ctx.flags.reload = true;
    host.setVar(key, v);
  }

  /** `type === 'value' ? cbs(x) : getVar(cbs(x))` — the ubiquitous V2 operand resolver. */
  const val = (x: unknown, type: unknown): string => (type === "value" ? cbs(x) : getVar(cbs(x)));
  const num = (x: unknown, type: unknown): number => Number(val(x, type));
  const out = (effect: any, value: string | null | undefined) => setVar(cbs(effect.outputVar), value);
  const lore = (): TriggerLore[] | null => host.lorebook ?? null;
  const loreChanged = () => host.onLorebookChange?.();

  for (const trigger of triggers) {
    const effects: any[] = trigger.effect ?? [];
    const conditions: any[] = trigger.conditions ?? [];
    const loopVars: Record<string, number> = {};

    if (effects[0]?.type === "triggercode" || effects[0]?.type === "triggerlua") {
      // Lua triggers bypass mode selection (their effects are skipped below).
    } else if (ctx.manualName) {
      if (trigger.comment !== ctx.manualName) continue;
    } else if (mode !== trigger.type) {
      continue;
    }

    let pass = true;
    for (const condition of conditions) {
      if (!condition) continue;
      if (condition.type === "var" || condition.type === "chatindex" || condition.type === "value") {
        let varValue: string | null =
          condition.type === "var" ? (getVar(condition.var) ?? "null")
            : condition.type === "chatindex" ? chat.length.toString()
              : condition.type === "value" ? condition.var : null;
        if (varValue === undefined || varValue === null) {
          pass = false;
          break;
        }
        const conditionValue = cbs(condition.value);
        varValue = cbs(varValue);
        switch (condition.operator) {
          case "true": if (varValue !== "true" && varValue !== "1") pass = false; break;
          case "=": if (varValue !== conditionValue) pass = false; break;
          case "!=": if (varValue === conditionValue) pass = false; break;
          case ">": if (Number(varValue) <= Number(conditionValue)) pass = false; break;
          case "<": if (Number(varValue) >= Number(conditionValue)) pass = false; break;
          case ">=": if (Number(varValue) < Number(conditionValue)) pass = false; break;
          case "<=": if (Number(varValue) > Number(conditionValue)) pass = false; break;
          case "null": if (varValue !== "null") pass = false; break;
        }
      } else if (condition.type === "exists") {
        const v = cbs(cbs(condition.value));
        const da = chat.slice(0 - condition.depth).map((m) => m.data).join(" ");
        if (condition.type2 === "strict") pass = da.split(" ").includes(v);
        else if (condition.type2 === "loose") pass = da.toLowerCase().includes(v.toLowerCase());
        else if (condition.type2 === "regex") pass = new RegExp(v).test(da);
      }
      if (!pass) break;
    }
    if (!pass) continue;

    for (let index = 0; index < effects.length; index++) {
      const effect = effects[index];
      if (!effect) { currentIndent = 0; continue; }
      if (mode === "display" && !displayAllowList.includes(effect.type)) continue;
      if (mode === "request" && !requestAllowList.includes(effect.type)) continue;

      if ("indent" in effect && typeof effect.indent === "number" && effect.indent >= 0) {
        currentIndent = effect.indent;
      } else if (!("indent" in effect)) {
        currentIndent = 0;
      }

      switch (effect.type) {
        // ---------------- V1 ----------------
        case "setvar": {
          const effectValue = cbs(effect.value);
          const varKey = cbs(effect.var);
          let originalVar = Number(getVar(varKey));
          if (Number.isNaN(originalVar)) originalVar = 0;
          let resultValue = "";
          switch (effect.operator) {
            case "=": resultValue = effectValue; break;
            case "+=": resultValue = (originalVar + Number(effectValue)).toString(); break;
            case "-=": resultValue = (originalVar - Number(effectValue)).toString(); break;
            case "*=": resultValue = (originalVar * Number(effectValue)).toString(); break;
            case "/=": resultValue = (originalVar / Number(effectValue)).toString(); break;
          }
          setVar(varKey, resultValue);
          break;
        }
        case "systemprompt": {
          const loc = effect.location as keyof SysPrompt;
          additonalSysPrompt[loc] = (additonalSysPrompt[loc] ?? "") + cbs(effect.value) + "\n\n";
          break;
        }
        case "impersonate": {
          const v = cbs(effect.value);
          if (effect.role === "user") chat.push({ role: "user", data: v });
          else if (effect.role === "char") chat.push({ role: "char", data: v });
          break;
        }
        case "command": {
          await host.runCommand?.(cbs(effect.value));
          break;
        }
        case "stop":
        case "v2StopPromptSending": {
          stopSending = true;
          break;
        }
        case "runtrigger":
        case "v2RunTrigger": {
          const name = effect.type === "runtrigger" ? effect.value : effect.target;
          const allowed = ctx.recursiveCount < 10
            || (trigger.lowLevelAccess && ctx.recursiveCount < MAX_LOWLEVEL_RECURSION);
          if (allowed) {
            ctx.recursiveCount++;
            const r = await runInternal(triggers, "manual", host, {
              recursiveCount: ctx.recursiveCount,
              sysPrompt: additonalSysPrompt,
              stopSending,
              manualName: name,
              displayMode: false,
              chat,
              flags: ctx.flags,
            });
            if (r) {
              additonalSysPrompt = r.sysPrompt;
              chat = r.chat;
              stopSending = r.stopSending;
              // NB: like RisuAI, the child's sendAIprompt is not propagated.
            }
          }
          break;
        }
        case "cutchat": {
          const start = Number(cbs(effect.start));
          const end = Number(cbs(effect.end));
          chat = chat.slice(start, end);
          break;
        }
        case "modifychat": {
          const i = Number(cbs(effect.index));
          const v = cbs(effect.value);
          if (chat[i]) chat[i].data = v;
          break;
        }
        case "showAlert": {
          if (!trigger.lowLevelAccess) break;
          if (displayMode) throw ABORT;
          const effectValue = cbs(effect.value);
          const inputVar = cbs(effect.inputVar);
          switch (effect.alertType) {
            case "normal": host.alertNormal(effectValue); break;
            case "error": host.alertError(effectValue); break;
            case "input": setVar(inputVar, await host.alertInput(effectValue)); break;
            case "select": setVar(inputVar, await host.alertSelect(effectValue.split("§"))); break;
          }
          break;
        }
        case "sendAIprompt":
        case "v2SendAIprompt": {
          if (!trigger.lowLevelAccess) break;
          sendAIprompt = true;
          break;
        }
        case "runLLM": {
          if (!trigger.lowLevelAccess) break;
          const v = cbs(effect.value);
          if (!host.runLLM) {
            setVar(effect.inputVar, "Error: runLLM is not supported");
            break;
          }
          let res: string | null = null;
          try { res = await host.runLLM(v, "model"); } catch (e) { res = null; }
          setVar(effect.inputVar, res === null ? "Error: runLLM failed" : res);
          break;
        }
        case "checkSimilarity": {
          if (!trigger.lowLevelAccess) break;
          const v = cbs(effect.value);
          const source = cbs(effect.source);
          const r = host.similaritySearch ? await host.similaritySearch(source, v.split("§")) : [];
          setVar(effect.inputVar, r.join("§"));
          break;
        }
        case "extractRegex": {
          if (!trigger.lowLevelAccess) break;
          const effectValue = cbs(effect.value);
          const regexResult = new RegExp(effect.regex, effect.flags).exec(effectValue);
          const result = String(effect.result ?? "")
            .replace(/\$[0-9]+/g, (m) => regexResult?.[Number(m.slice(1))] ?? "")
            .replace(/\$&/g, regexResult?.[0] ?? "")
            .replace(/\$\$/g, "$");
          setVar(effect.inputVar, result);
          break;
        }
        case "runImgGen": {
          if (!trigger.lowLevelAccess) break;
          setVar(effect.inputVar, "Error: Image generation failed");
          break;
        }
        case "triggerlua":
        case "triggercode":
        case "runAxLLM":
          break;

        // ---------------- V2 control flow ----------------
        case "v2Header":
        case "v2Comment":
        case "v2Loop":
        case "v2LoopNTimes":
          break;
        case "v2SetVar": {
          const effectValue = val(effect.value, effect.valueType);
          const varKey = cbs(effect.var);
          let originalVar = Number(getVar(varKey));
          if (Number.isNaN(originalVar)) originalVar = 0;
          let resultValue = "";
          switch (effect.operator) {
            case "=": resultValue = effectValue; break;
            case "+=": resultValue = (originalVar + Number(effectValue)).toString(); break;
            case "-=": resultValue = (originalVar - Number(effectValue)).toString(); break;
            case "*=": resultValue = (originalVar * Number(effectValue)).toString(); break;
            case "/=": resultValue = (originalVar / Number(effectValue)).toString(); break;
            case "%=": resultValue = (originalVar % Number(effectValue)).toString(); break;
          }
          setVar(varKey, resultValue);
          break;
        }
        case "v2DeclareLocalVar": {
          const v = val(effect.value, effect.valueType);
          setLocalVar(cbs(effect.var), v ?? "null", effect.indent);
          break;
        }
        case "v2If":
        case "v2IfAdvanced": {
          const sourceValue = effect.type === "v2If" || effect.sourceType === "var"
            ? getVar(cbs(effect.source)) : cbs(effect.source);
          const targetValue = val(effect.target, effect.targetType);
          const ok = compareV2(effect.condition, sourceValue, targetValue);
          if (!ok) {
            let indent = effect.indent + 1;
            for (; index < effects.length; index++) {
              const ef = effects[index];
              if (ef?.type === "v2EndIndent" && indent === ef.indent) {
                const next = effects[index + 1];
                indent--;
                if (next?.type === "v2Else" && next?.indent === indent) index++;
                break;
              }
            }
          }
          break;
        }
        case "v2Else": {
          // Reached only when the matching if-branch ran: skip the else body.
          const indent = effect.indent + 1;
          for (; index < effects.length; index++) {
            const ef = effects[index];
            if (ef?.type === "v2EndIndent" && indent === ef.indent) break;
          }
          break;
        }
        case "v2EndIndent": {
          if (effect.endOfLoop) {
            const indent = effect.indent - 1;
            const originalIndex = index;
            for (; index >= 0; index--) {
              const ef = effects[index];
              if ((ef?.type === "v2Loop" || ef?.type === "v2LoopNTimes") && indent === ef.indent) {
                if (ef.type === "v2LoopNTimes") {
                  let n = num(ef.value, ef.valueType);
                  if (Number.isNaN(n)) n = 0;
                  const key = index + "LoopNTimes";
                  // NB (RisuAI quirk): the counter is never reset, and the body always runs at least once.
                  loopVars[key] = (loopVars[key] ?? 0) + 1;
                  if (loopVars[key] >= n) index = originalIndex;
                  else break;
                }
                break;
              }
            }
            loopVars["loopTimes"] = (loopVars["loopTimes"] ?? 0) + 1;
            if (loopVars["loopTimes"] > 100) {
              await sleep(1);
              loopVars["loopTimes"] = 0;
            }
            loopVars["totalLoops"] = (loopVars["totalLoops"] ?? 0) + 1;
            if (loopVars["totalLoops"] > MAX_LOOP_ITERATIONS) {
              host.log?.(`[trigger] loop limit exceeded in "${trigger.comment ?? ""}"`);
              index = effects.length;
              break;
            }
          }
          clearLocalVarsAtIndent(effect.indent);
          break;
        }
        case "v2BreakLoop": {
          for (; index < effects.length; index++) {
            const ef = effects[index];
            if (ef?.type === "v2EndIndent" && ef.endOfLoop) break;
          }
          break;
        }
        case "v2ConsoleLog": {
          const v = val(effect.source, effect.sourceType);
          if (host.log) host.log(v);
          else console.log(v);
          break;
        }
        case "v2StopTrigger": {
          index = effects.length;
          break;
        }

        // ---------------- V2 chat ----------------
        case "v2CutChat": {
          let start = num(effect.start, effect.startType);
          let end = num(effect.end, effect.endType);
          if (Number.isNaN(start)) start = 0;
          if (Number.isNaN(end)) end = chat.length;
          chat = chat.slice(start, end);
          break;
        }
        case "v2ModifyChat": {
          const i = num(effect.index, effect.indexType);
          const v = val(effect.value, effect.valueType);
          if (chat[i]) chat[i].data = v;
          break;
        }
        case "v2SystemPrompt": {
          const loc = effect.location as keyof SysPrompt;
          additonalSysPrompt[loc] = (additonalSysPrompt[loc] ?? "") + val(effect.value, effect.valueType) + "\n\n";
          break;
        }
        case "v2Impersonate": {
          const v = val(effect.value, effect.valueType);
          if (effect.role === "user") chat.push({ role: "user", data: v });
          else if (effect.role === "char") chat.push({ role: "char", data: v });
          break;
        }
        case "v2Command": {
          await host.runCommand?.(val(effect.value, effect.valueType));
          break;
        }
        case "v2GetLastMessage":
          out(effect, chat[chat.length - 1]?.data ?? "null");
          break;
        case "v2GetMessageAtIndex":
          out(effect, chat[num(effect.index, effect.indexType)]?.data ?? "null");
          break;
        case "v2GetMessageCount":
          out(effect, chat.length.toString());
          break;
        case "v2GetLastUserMessage":
          out(effect, chat.slice().reverse().find((m) => m.role === "user")?.data ?? "null");
          break;
        case "v2GetLastCharMessage":
          out(effect, chat.slice().reverse().find((m) => m.role === "char")?.data ?? "null");
          break;
        case "v2GetFirstMessage":
          out(effect, host.firstMessage ?? "null");
          break;
        case "v2QuickSearchChat": {
          const v = val(effect.value, effect.valueType);
          const depth = num(effect.depth, effect.depthType);
          if (Number.isNaN(depth)) { out(effect, "0"); break; }
          const da = chat.slice(0 - depth).map((m) => m.data).join(" ");
          let ok = false;
          if (effect.condition === "strict") ok = da.split(" ").includes(v);
          else if (effect.condition === "loose") ok = da.toLowerCase().includes(v.toLowerCase());
          else if (effect.condition === "regex") ok = new RegExp(v).test(da);
          out(effect, ok ? "1" : "0");
          break;
        }

        // ---------------- V2 LLM / media (host callbacks or stubs) ----------------
        case "v2ImgGen": {
          if (!trigger.lowLevelAccess) break;
          out(effect, "null");
          break;
        }
        case "v2CheckSimilarity": {
          if (!trigger.lowLevelAccess) break;
          const source = val(effect.source, effect.sourceType);
          const v = val(effect.value, effect.valueType);
          const r = host.similaritySearch ? await host.similaritySearch(source, v.split("§")) : [];
          out(effect, r.join("§"));
          break;
        }
        case "v2RunLLM": {
          if (!trigger.lowLevelAccess) break;
          const v = val(effect.value, effect.valueType);
          let res: string | null = null;
          if (host.runLLM) {
            try { res = await host.runLLM(v, effect.model === "submodel" ? "submodel" : "model"); } catch (e) { res = null; }
          }
          out(effect, res ?? "null");
          break;
        }
        case "v2Tokenize": {
          const v = val(effect.value, effect.valueType);
          const n = host.tokenize ? await host.tokenize(v) : Math.ceil(v.length / 4);
          out(effect, n.toString());
          break;
        }

        // ---------------- V2 alerts / GUI ----------------
        case "v2ShowAlert": {
          if (displayMode) throw ABORT;
          host.alertNormal(val(effect.value, effect.valueType));
          break;
        }
        case "v2GetAlertInput": {
          if (displayMode) throw ABORT;
          out(effect, await host.alertInput(val(effect.display, effect.displayType)));
          break;
        }
        case "v2GetAlertSelect": {
          if (displayMode) throw ABORT;
          // RisuAI also passes `display` as the dialog title; TriggerHost.alertSelect takes options only.
          const options = val(effect.value, effect.valueType).split("|");
          out(effect, await host.alertSelect(options));
          break;
        }
        case "v2UpdateGUI":
        case "v2UpdateChatAt":
          ctx.flags.reload = true;
          break;
        case "v2Wait": {
          const v = num(effect.value, effect.valueType);
          await sleep(Number.isNaN(v) ? 0 : v * 1000);
          break;
        }

        // ---------------- V2 display / request state ----------------
        case "v2GetDisplayState": {
          if (!displayMode) throw ABORT;
          out(effect, displayData ?? "null");
          break;
        }
        case "v2SetDisplayState": {
          if (!displayMode) throw ABORT;
          displayData = val(effect.value, effect.valueType);
          break;
        }
        case "v2GetRequestState":
        case "v2GetRequestStateRole": {
          if (!displayMode) throw ABORT;
          const json = JSON.parse(displayData ?? "null") as { role?: string; content?: string }[] | null;
          const i = num(effect.index, effect.indexType);
          const item = json?.[i];
          out(effect, (effect.type === "v2GetRequestState" ? item?.content : item?.role) ?? "null");
          break;
        }
        case "v2SetRequestState":
        case "v2SetRequestStateRole": {
          if (!displayMode) throw ABORT;
          const json = JSON.parse(displayData ?? "null") as { role?: string; content?: string }[];
          const i = num(effect.index, effect.indexType);
          const v = val(effect.value, effect.valueType);
          if (json && json[i]) {
            if (effect.type === "v2SetRequestState") json[i].content = v;
            else if (v === "user" || v === "assistant" || v === "system") json[i].role = v;
          }
          displayData = JSON.stringify(json);
          break;
        }
        case "v2GetRequestStateLength": {
          if (!displayMode) throw ABORT;
          const json = JSON.parse(displayData ?? "null") as unknown[];
          out(effect, json.length.toString());
          break;
        }

        // ---------------- V2 regex / string ----------------
        case "v2ExtractRegex": {
          const v = val(effect.value, effect.valueType);
          const regex = new RegExp(val(effect.regex, effect.regexType), val(effect.flags, effect.flagsType));
          const regexResult = regex.exec(v);
          const fmt = val(effect.result, effect.resultType);
          let result: string;
          if (regexResult !== null) {
            result = fmt.replace(/\$[0-9]+/g, (m) => regexResult[Number(m.slice(1))] || "")
              .replace(/\$&/g, regexResult[0] || "").replace(/\$\$/g, "$");
          } else {
            result = fmt.replace(/\$[0-9]+/g, "").replace(/\$&/g, "").replace(/\$\$/g, "$");
          }
          out(effect, result);
          break;
        }
        case "v2RegexTest": {
          try {
            const v = val(effect.value, effect.valueType);
            const regex = new RegExp(val(effect.regex, effect.regexType), val(effect.flags, effect.flagsType));
            out(effect, regex.test(v) ? "1" : "0");
          } catch (e) {
            out(effect, "0");
          }
          break;
        }
        case "v2ReplaceString": {
          try {
            const source = val(effect.source, effect.sourceType);
            const pattern = val(effect.regex, effect.regexType);
            const resultFormat = val(effect.result, effect.resultType);
            const replacement = val(effect.replacement, effect.replacementType);
            const flags = val(effect.flags, effect.flagsType);
            const regex = new RegExp(pattern, flags);
            const result = source.replace(regex, (...args: any[]) => {
              const match: string = args[0];
              // drop (offset, string) and the named-groups object when present
              let tail = 2;
              if (typeof args[args.length - 1] === "object" && args[args.length - 1] !== null) tail = 3;
              const groups: (string | undefined)[] = args.slice(1, -tail);
              const target = resultFormat.match(/^\$(\d+)$/);
              if (target) {
                const ti = Number(target[1]);
                if (ti === 0) return replacement;
                const tg = groups[ti - 1];
                if (tg) return match.replace(tg, replacement);
              }
              return resultFormat.replace(/\$[0-9]+/g, (ph) => {
                const i = Number(ph.slice(1));
                return i === 0 ? match : (groups[i - 1] || "");
              }).replace(/\$&/g, match).replace(/\$\$/g, "$");
            });
            out(effect, result);
          } catch (e) {
            out(effect, val(effect.source, effect.sourceType));
          }
          break;
        }
        case "v2Random": {
          const min = num(effect.min, effect.minType);
          const max = num(effect.max, effect.maxType);
          out(effect, Math.floor(Math.random() * (max - min + 1) + min).toString());
          break;
        }
        case "v2GetCharAt": {
          const s = val(effect.source, effect.sourceType);
          out(effect, s[num(effect.index, effect.indexType)] ?? "null");
          break;
        }
        case "v2GetCharCount":
          out(effect, val(effect.source, effect.sourceType).length.toString());
          break;
        case "v2ToLowerCase":
          out(effect, val(effect.source, effect.sourceType).toLowerCase());
          break;
        case "v2ToUpperCase":
          out(effect, val(effect.source, effect.sourceType).toUpperCase());
          break;
        case "v2SetCharAt": {
          const s = val(effect.source, effect.sourceType);
          const i = num(effect.index, effect.indexType);
          const v = val(effect.value, effect.valueType);
          const arr = [...s];
          arr[i] = v;
          out(effect, arr.join(""));
          break;
        }
        case "v2SplitString": {
          const s = val(effect.source, effect.sourceType);
          const delimiter = effect.delimiterType === "var" ? getVar(cbs(effect.delimiter)) : cbs(effect.delimiter);
          let result: string[];
          if (effect.delimiterType === "regex") {
            try {
              const m = delimiter.match(/^\/(.+)\/([gimuy]*)$/);
              result = m ? s.split(new RegExp(m[1], m[2])) : s.split(new RegExp(delimiter));
            } catch (e) {
              result = [s];
            }
          } else {
            result = s.split(delimiter);
          }
          out(effect, JSON.stringify(result));
          break;
        }
        case "v2JoinArrayVar": {
          try {
            const arr = JSON.parse(val(effect.var, effect.varType));
            out(effect, arr.join(val(effect.delimiter, effect.delimiterType)));
          } catch (e) {
            out(effect, "");
          }
          break;
        }
        case "v2ConcatString":
          out(effect, val(effect.source1, effect.source1Type) + val(effect.source2, effect.source2Type));
          break;
        case "v2Calculate": {
          try {
            let expression = val(effect.expression, effect.expressionType);
            expression = expression.replace(/\$([a-zA-Z0-9_]+)/g, (_, name: string) => {
              const parsed = parseFloat(getVar(name));
              return Number.isNaN(parsed) ? "0" : parsed.toString();
            });
            out(effect, calcString(expression, (k) => host.getVar(k), (k) => host.getGlobal(k)).toString());
          } catch (e) {
            out(effect, "0");
          }
          break;
        }

        // ---------------- V2 arrays ----------------
        case "v2MakeArrayVar": {
          const name = cbs(effect.var);
          if (name.startsWith("[") && name.endsWith("]")) throw ABORT;
          setVar(name, "[]");
          break;
        }
        case "v2GetArrayVarLength": {
          try {
            out(effect, JSON.parse(getVar(cbs(effect.var))).length.toString());
          } catch (e) {
            out(effect, "0");
          }
          break;
        }
        case "v2GetArrayVar": {
          try {
            const arr = JSON.parse(getVar(cbs(effect.var)));
            out(effect, arr[num(effect.index, effect.indexType)] ?? "null");
          } catch (e) {
            out(effect, "null");
          }
          break;
        }
        case "v2SetArrayVar": {
          const v = val(effect.value, effect.valueType);
          const i = num(effect.index, effect.indexType);
          if (Number.isNaN(i)) break;
          try {
            const name = cbs(effect.var);
            const arr = JSON.parse(getVar(name));
            arr[i] = v;
            setVar(name, JSON.stringify(arr));
          } catch (e) { /* ignored, as in RisuAI */ }
          break;
        }
        case "v2PushArrayVar":
        case "v2UnshiftArrayVar": {
          const name = cbs(effect.var);
          try {
            const arr = JSON.parse(getVar(name));
            const v = val(effect.value, effect.valueType);
            if (effect.type === "v2PushArrayVar") arr.push(v);
            else arr.unshift(v);
            setVar(name, JSON.stringify(arr));
          } catch (e) {
            setVar(name, "[]");
          }
          break;
        }
        case "v2PopArrayVar":
        case "v2ShiftArrayVar": {
          const name = cbs(effect.var);
          try {
            const arr = JSON.parse(getVar(name));
            out(effect, (effect.type === "v2PopArrayVar" ? arr.pop() : arr.shift()) ?? "null");
            setVar(name, JSON.stringify(arr));
          } catch (e) {
            setVar(name, "[]");
            out(effect, "null");
          }
          break;
        }
        case "v2SpliceArrayVar": {
          const name = cbs(effect.var);
          try {
            const arr = JSON.parse(getVar(name));
            arr.splice(num(effect.start, effect.startType), 0, val(effect.item, effect.itemType));
            setVar(name, JSON.stringify(arr));
          } catch (e) {
            setVar(name, "[]");
          }
          break;
        }
        case "v2SliceArrayVar": {
          try {
            const arr = JSON.parse(getVar(cbs(effect.var)));
            out(effect, JSON.stringify(arr.slice(num(effect.start, effect.startType), num(effect.end, effect.endType))));
          } catch (e) {
            out(effect, "[]");
          }
          break;
        }
        case "v2GetIndexOfValueInArrayVar": {
          try {
            const arr = JSON.parse(getVar(cbs(effect.var)));
            out(effect, arr.indexOf(val(effect.value, effect.valueType)).toString());
          } catch (e) {
            out(effect, "-1");
          }
          break;
        }
        case "v2RemoveIndexFromArrayVar": {
          const name = cbs(effect.var);
          try {
            const arr = JSON.parse(getVar(name));
            arr.splice(num(effect.index, effect.indexType), 1);
            setVar(name, JSON.stringify(arr));
          } catch (e) {
            setVar(name, "[]");
          }
          break;
        }

        // ---------------- V2 dicts ----------------
        case "v2MakeDictVar":
        case "v2ClearDict": {
          const raw = String(effect.var ?? "");
          if (raw.startsWith("{") && raw.endsWith("}")) throw ABORT;
          setVar(cbs(effect.var), "{}");
          break;
        }
        case "v2GetDictVar": {
          try {
            const dict = JSON.parse(val(effect.var, effect.varType));
            out(effect, dict[val(effect.key, effect.keyType)] ?? "null");
          } catch (e) {
            out(effect, "null");
          }
          break;
        }
        case "v2SetDictVar": {
          const v = val(effect.value, effect.valueType);
          const key = val(effect.key, effect.keyType);
          if (effect.varType === "value") break;
          const name = cbs(effect.var);
          try {
            const dict = JSON.parse(getVar(name));
            dict[key] = v;
            setVar(name, JSON.stringify(dict));
          } catch (e) {
            if (effect.varType === "var") setVar(name, JSON.stringify({ [key]: v }));
          }
          break;
        }
        case "v2DeleteDictKey": {
          if (effect.varType === "value") break;
          const name = cbs(effect.var);
          try {
            const dict = JSON.parse(getVar(name));
            delete dict[val(effect.key, effect.keyType)];
            setVar(name, JSON.stringify(dict));
          } catch (e) {
            if (effect.varType === "var") setVar(name, "{}");
          }
          break;
        }
        case "v2HasDictKey": {
          try {
            const dict = JSON.parse(val(effect.var, effect.varType));
            out(effect, Object.prototype.hasOwnProperty.call(dict, val(effect.key, effect.keyType)) ? "1" : "0");
          } catch (e) {
            out(effect, "0");
          }
          break;
        }
        case "v2GetDictSize": {
          try {
            out(effect, Object.keys(JSON.parse(val(effect.var, effect.varType))).length.toString());
          } catch (e) {
            out(effect, "0");
          }
          break;
        }
        case "v2GetDictKeys":
        case "v2GetDictValues": {
          try {
            const dict = JSON.parse(val(effect.var, effect.varType));
            out(effect, JSON.stringify(effect.type === "v2GetDictKeys" ? Object.keys(dict) : Object.values(dict)));
          } catch (e) {
            out(effect, "[]");
          }
          break;
        }

        // ---------------- V2 character / persona / notes ----------------
        case "v2GetCharacterDesc":
          out(effect, host.description ?? "");
          break;
        case "v2SetCharacterDesc": {
          const v = val(effect.value, effect.valueType);
          host.description = v;
          host.setDescription?.(v);
          break;
        }
        case "v2GetPersonaDesc":
          out(effect, host.personaDescription ?? "");
          break;
        case "v2SetPersonaDesc": {
          const v = val(effect.value, effect.valueType);
          host.personaDescription = v;
          host.setPersonaDescription?.(v);
          break;
        }
        case "v2GetAuthorNote":
          out(effect, host.authorNote ?? "");
          break;
        case "v2SetAuthorNote": {
          const v = val(effect.value, effect.valueType);
          host.authorNote = v;
          host.setAuthorNote?.(v);
          break;
        }
        case "v2GetReplaceGlobalNote":
          out(effect, host.replaceGlobalNote ?? "");
          break;
        case "v2SetReplaceGlobalNote": {
          const v = val(effect.value, effect.valueType);
          host.replaceGlobalNote = v;
          host.setReplaceGlobalNote?.(v);
          break;
        }

        // ---------------- V2 lorebook ----------------
        case "v2GetLorebookCount":
        case "v2GetLorebookCountNew":
          out(effect, (lore()?.length ?? 0).toString());
          break;
        case "v2GetLorebook":
        case "v2GetLorebookEntry":
          // legacy tuple accessors: never match object entries in RisuAI
          out(effect, "null");
          break;
        case "v2GetLorebookIndexViaName":
          out(effect, "-1");
          break;
        case "v2ModifyLorebook":
        case "v2SetLorebookActivation":
          break;
        case "v2GetAllLorebooks": {
          const list = lore() ?? [];
          out(effect, JSON.stringify(list.filter((l) => l && l.content !== undefined).map((l) => l.content)));
          break;
        }
        case "v2GetLorebookByName": {
          const list = lore() ?? [];
          const regex = new RegExp(val(effect.name, effect.nameType), "i");
          const idx: number[] = [];
          list.forEach((l, i) => { if (l && l.comment !== undefined && regex.test(l.comment)) idx.push(i); });
          out(effect, JSON.stringify(idx));
          break;
        }
        case "v2GetLorebookByIndex": {
          const list = lore() ?? [];
          const i = num(effect.index, effect.indexType);
          const entry = Number.isNaN(i) || i < 0 || i >= list.length ? undefined : list[i];
          out(effect, entry && entry.content !== undefined ? entry.content : "null");
          break;
        }
        case "v2CreateLorebook": {
          const list = lore();
          if (!list) break;
          const insertOrder = num(effect.insertOrder, effect.insertOrderType);
          list.push({
            key: val(effect.key, effect.keyType),
            comment: val(effect.name, effect.nameType),
            content: val(effect.content, effect.contentType),
            mode: "normal",
            insertorder: Number.isNaN(insertOrder) ? 100 : insertOrder,
            alwaysActive: false,
            secondkey: "",
            selective: false,
          });
          loreChanged();
          break;
        }
        case "v2ModifyLorebookByIndex": {
          const list = lore();
          if (!list) break;
          const i = num(effect.index, effect.indexType);
          if (Number.isNaN(i) || i < 0 || i >= list.length || !list[i]) break;
          const cur = list[i];
          const name = val(effect.name, effect.nameType).replace(/{{slot}}/g, cur.comment || "");
          cur.comment = name;
          const key = val(effect.key, effect.keyType).replace(/{{slot}}/g, cur.key || "");
          cur.key = key;
          const content = val(effect.content, effect.contentType).replace(/{{slot}}/g, cur.content || "");
          cur.content = content;
          const io = Number(val(effect.insertOrder, effect.insertOrderType)
            .replace(/{{slot}}/g, (cur.insertorder || 100).toString()));
          if (!Number.isNaN(io)) cur.insertorder = io;
          loreChanged();
          break;
        }
        case "v2DeleteLorebookByIndex": {
          const list = lore();
          if (!list) break;
          const i = num(effect.index, effect.indexType);
          if (Number.isNaN(i) || i < 0 || i >= list.length || !list[i]) break;
          list.splice(i, 1);
          loreChanged();
          break;
        }
        case "v2SetLorebookAlwaysActive": {
          const list = lore();
          if (!list) break;
          const i = num(effect.index, effect.indexType);
          if (Number.isNaN(i) || i < 0 || i >= list.length || !list[i]) break;
          list[i].alwaysActive = effect.value;
          loreChanged();
          break;
        }
      }
    }
  }

  return { sysPrompt: additonalSysPrompt, chat, stopSending, sendAIprompt, displayData };
}

function compareV2(condition: string, sourceValue: string, targetValue: string): boolean {
  switch (condition) {
    case "=":
      if (!isNaN(Number(sourceValue)) && !isNaN(Number(targetValue))) return Number(sourceValue) === Number(targetValue);
      return sourceValue === targetValue;
    case "!=":
      if (!isNaN(Number(sourceValue)) && !isNaN(Number(targetValue))) return Number(sourceValue) !== Number(targetValue);
      return sourceValue !== targetValue;
    case ">": return Number(sourceValue) > Number(targetValue);
    case "<": return Number(sourceValue) < Number(targetValue);
    case ">=": return Number(sourceValue) >= Number(targetValue);
    case "<=": return Number(sourceValue) <= Number(targetValue);
    case "∈":
      try { return JSON.parse(targetValue).includes(sourceValue); } catch (e) { return false; }
    case "∋":
      try { return JSON.parse(sourceValue).includes(targetValue); } catch (e) { return false; }
    case "∉":
      try { return !JSON.parse(targetValue).includes(sourceValue); } catch (e) { return true; }
    case "∌":
      try { return !JSON.parse(sourceValue).includes(targetValue); } catch (e) { return true; }
    case "≒": {
      const n1 = Number(sourceValue);
      const n2 = Number(targetValue);
      if (Number.isNaN(n1) || Number.isNaN(n2)) {
        return sourceValue.toLocaleLowerCase().replace(/ /g, "") === targetValue.toLocaleLowerCase().replace(/ /g, "");
      }
      return Math.abs(n1 - n2) < 0.0001;
    }
    case "≡":
      if (targetValue === "true") return sourceValue === "true" || sourceValue === "1";
      if (targetValue === "false") return !(sourceValue === "true" || sourceValue === "1");
      return sourceValue === targetValue;
  }
  return false;
}

// ---------------------------------------------------------------------------
// RPN calculator (port of RisuAI infunctions.ts calcString), quirks preserved.
// ---------------------------------------------------------------------------

const OPERATORS: Record<string, { precedence: number; associativity: "Left" | "Right" }> = {
  "+": { precedence: 2, associativity: "Left" },
  "-": { precedence: 2, associativity: "Left" },
  "*": { precedence: 3, associativity: "Left" },
  "/": { precedence: 3, associativity: "Left" },
  "^": { precedence: 4, associativity: "Left" },
  "%": { precedence: 3, associativity: "Left" },
  "<": { precedence: 1, associativity: "Left" },
  ">": { precedence: 1, associativity: "Left" },
  "|": { precedence: 1, associativity: "Left" },
  "&": { precedence: 1, associativity: "Left" },
  "≤": { precedence: 1, associativity: "Left" },
  "≥": { precedence: 1, associativity: "Left" },
  "=": { precedence: 1, associativity: "Left" },
  "≠": { precedence: 1, associativity: "Left" },
  "!": { precedence: 5, associativity: "Right" },
};
const OPERATOR_KEYS = Object.keys(OPERATORS);

function toRPN(input: string): string {
  let outputQueue = "";
  const operatorStack: string[] = [];
  const expression = input.replace(/\s+/g, "");
  const tokens: string[] = [];
  let lastToken = "";
  for (let i = 0; i < expression.length; i++) {
    const ch = expression[i];
    if (ch === "-" && (i === 0 || OPERATOR_KEYS.includes(expression[i - 1]) || expression[i - 1] === "(")) {
      lastToken += ch;
    } else if (OPERATOR_KEYS.includes(ch)) {
      tokens.push(lastToken !== "" ? lastToken : "0");
      lastToken = "";
      tokens.push(ch);
    } else {
      lastToken += ch;
    }
  }
  tokens.push(lastToken !== "" ? lastToken : "0");

  for (const token of tokens) {
    if (parseFloat(token) || token === "0") {
      outputQueue += token + " ";
    } else if (OPERATOR_KEYS.includes(token)) {
      while (operatorStack.length > 0) {
        const top = OPERATORS[operatorStack[operatorStack.length - 1]];
        const op = OPERATORS[token];
        if ((op.associativity === "Left" && op.precedence <= top.precedence)
          || (op.associativity === "Right" && op.precedence < top.precedence)) {
          outputQueue += operatorStack.pop() + " ";
        } else break;
      }
      operatorStack.push(token);
    }
  }
  while (operatorStack.length > 0) outputQueue += operatorStack.pop() + " ";
  return outputQueue.trim();
}

function calculateRPN(expression: string): number {
  const stack: number[] = [];
  for (const token of expression.split(" ")) {
    if (parseFloat(token) || token === "0") {
      stack.push(parseFloat(token));
    } else {
      const b = stack.pop() as number;
      const a = stack.pop() as number;
      switch (token) {
        case "+": stack.push(a + b); break;
        case "-": stack.push(a - b); break;
        case "*": stack.push(a * b); break;
        case "/": stack.push(a / b); break;
        case "^": stack.push(a ** b); break;
        case "%": stack.push(a % b); break;
        case "<": stack.push(a < b ? 1 : 0); break;
        case ">": stack.push(a > b ? 1 : 0); break;
        case "|": stack.push(a || b); break;
        case "&": stack.push(a && b); break;
        case "≤": stack.push(a <= b ? 1 : 0); break;
        case "≥": stack.push(a >= b ? 1 : 0); break;
        case "=": stack.push(a === b ? 1 : 0); break;
        case "≠": stack.push(a !== b ? 1 : 0); break;
        case "!": stack.push(b ? 0 : 1); break;
      }
    }
  }
  if (stack.length === 0) return 0;
  return stack.pop() as number;
}

function executeRPNCalculation(text: string, getVar: (k: string) => string, getGlobal: (k: string) => string): number {
  const prepared = text
    .replace(/\$([a-zA-Z0-9_]+)/g, (_, p1: string) => {
      const parsed = parseFloat(getVar(p1));
      return Number.isNaN(parsed) ? "0" : parsed.toString();
    })
    .replace(/@([a-zA-Z0-9_]+)/g, (_, p1: string) => {
      const parsed = parseFloat(getGlobal(p1));
      return Number.isNaN(parsed) ? "0" : parsed.toString();
    })
    .replace(/&&/g, "&")
    .replace(/\|\|/g, "|")
    .replace(/<=/g, "≤")
    .replace(/>=/g, "≥")
    .replace(/==/g, "=")
    .replace(/!=/g, "≠")
    .replace(/null/gi, "0");
  return calculateRPN(toRPN(prepared));
}

function calcString(text: string, getVar: (k: string) => string, getGlobal: (k: string) => string): number {
  const depthText: string[] = [""];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") {
      depthText.push("");
    } else if (text[i] === ")" && depthText.length > 1) {
      const r = executeRPNCalculation(depthText.pop() as string, getVar, getGlobal);
      depthText[depthText.length - 1] += r;
    } else {
      depthText[depthText.length - 1] += text[i];
    }
  }
  return executeRPNCalculation(depthText.join(""), getVar, getGlobal);
}
