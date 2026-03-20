export type ShowplanFormat = "all" | "xml" | "text" | "statistics_profile" | "statistics_xml";

export interface ShowplanSetResult {
  format: ShowplanFormat;
  enabled: boolean;
}

export interface ProcessStatementResult {
  /** True if this statement is a SET SHOWPLAN/STATISTICS PROFILE command */
  isShowplanSet: boolean;
  /** True if this statement should be executed under SHOWPLAN mode */
  isShowplan: boolean;
  /** The active format when this is an explain result, null otherwise */
  showplanFormat: ShowplanFormat | null;
  /** The wrapped SQL to send to backend, null if not wrapped */
  wrappedSql: string | null;
  /** Descriptive label for SET statements (e.g. "SHOWPLAN_ALL ON"), null for non-SET */
  label: string | null;
}

const SHOWPLAN_PATTERN =
  /^\s*SET\s+(SHOWPLAN_ALL|SHOWPLAN_XML|SHOWPLAN_TEXT|STATISTICS\s+PROFILE|STATISTICS\s+XML)\s+(ON|OFF)\s*$/i;

const FORMAT_MAP: Record<string, ShowplanFormat> = {
  SHOWPLAN_ALL: "all",
  SHOWPLAN_XML: "xml",
  SHOWPLAN_TEXT: "text",
};

export const SET_COMMAND_MAP: Record<ShowplanFormat, string> = {
  all: "SHOWPLAN_ALL",
  xml: "SHOWPLAN_XML",
  text: "SHOWPLAN_TEXT",
  statistics_profile: "STATISTICS PROFILE",
  statistics_xml: "STATISTICS XML",
};

export function parseShowplanSet(sql: string): ShowplanSetResult | null {
  const match = SHOWPLAN_PATTERN.exec(sql.trim());
  if (!match) return null;

  const rawFormat = match[1]!.toUpperCase();
  const enabled = match[2]!.toUpperCase() === "ON";

  let format: ShowplanFormat;
  if (rawFormat.includes("PROFILE")) {
    format = "statistics_profile";
  } else if (rawFormat.includes("XML") && rawFormat.startsWith("STATISTICS")) {
    format = "statistics_xml";
  } else {
    format = FORMAT_MAP[rawFormat] ?? "all";
  }

  return { format, enabled };
}

export function createShowplanTracker() {
  let activeFormat: ShowplanFormat | null = null;

  return {
    getState(): ShowplanFormat | null {
      return activeFormat;
    },

    processStatement(sql: string): ProcessStatementResult {
      const parsed = parseShowplanSet(sql);

      if (parsed) {
        if (parsed.enabled) {
          activeFormat = parsed.format;
        } else if (activeFormat === parsed.format || activeFormat === null) {
          activeFormat = null;
        }

        const setCommand = SET_COMMAND_MAP[parsed.format];
        return {
          isShowplanSet: true,
          isShowplan: false,
          showplanFormat: null,
          wrappedSql: null,
          label: `${setCommand} ${parsed.enabled ? "ON" : "OFF"}`,
        };
      }

      if (activeFormat) {
        const setCommand = SET_COMMAND_MAP[activeFormat];
        return {
          isShowplanSet: false,
          isShowplan: true,
          showplanFormat: activeFormat,
          wrappedSql: `SET ${setCommand} ON;\n${sql};\nSET ${setCommand} OFF;`,
          label: null,
        };
      }

      return {
        isShowplanSet: false,
        isShowplan: false,
        showplanFormat: null,
        wrappedSql: null,
        label: null,
      };
    },

    reset() {
      activeFormat = null;
    },
  };
}
