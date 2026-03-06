import {
  IconBolt,
  IconCode,
  IconEye,
  IconFileText,
  IconTable,
} from "@tabler/icons-react";

import type { MentionNodeData } from "./MentionNode";

const ICON_SIZE = 12;

const TYPE_STYLES: Record<
  MentionNodeData["mentionType"],
  { icon: React.ReactNode; color: string }
> = {
  table: {
    icon: <IconTable size={ICON_SIZE} />,
    color:
      "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-300",
  },
  view: {
    icon: <IconEye size={ICON_SIZE} />,
    color:
      "border-purple-300 bg-purple-50 text-purple-700 dark:border-purple-700 dark:bg-purple-950 dark:text-purple-300",
  },
  function: {
    icon: <IconCode size={ICON_SIZE} />,
    color:
      "border-green-300 bg-green-50 text-green-700 dark:border-green-700 dark:bg-green-950 dark:text-green-300",
  },
  tab: {
    icon: <IconFileText size={ICON_SIZE} />,
    color:
      "border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-700 dark:bg-orange-950 dark:text-orange-300",
  },
  connection: {
    icon: <IconBolt size={ICON_SIZE} />,
    color:
      "border-yellow-300 bg-yellow-50 text-yellow-700 dark:border-yellow-700 dark:bg-yellow-950 dark:text-yellow-300",
  },
};

interface MentionChipProps {
  data: MentionNodeData;
}

export function MentionChip({ data }: MentionChipProps) {
  const style = TYPE_STYLES[data.mentionType];

  return (
    <span
      className={`inline-flex select-none cursor-default items-center gap-0.5 rounded-md border px-1 py-px text-[11px] font-medium leading-tight ${style.color}`}
    >
      {style.icon}
      <span className="max-w-[160px] truncate">{data.displayLabel}</span>
    </span>
  );
}
