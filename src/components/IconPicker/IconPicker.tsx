"use client";

import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import {
  IconSearch,
  IconArrowsShuffle2,
  IconUpload,
  IconIcons,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

interface IconPickerProps {
  value: string;
  onChange: (emoji: string) => void;
  className?: string;
}

const EMOJI_CATEGORIES: Record<string, string[]> = {
  recent: [],
  people: [
    "😀",
    "😃",
    "😄",
    "😁",
    "😆",
    "😅",
    "🤣",
    "😂",
    "🙂",
    "🙃",
    "😉",
    "😊",
    "😇",
    "🥰",
    "😍",
    "🤩",
    "😘",
    "😗",
    "😚",
    "😙",
    "🥲",
    "😋",
    "😛",
    "😜",
    "🤪",
    "😝",
    "🤑",
    "🤗",
    "🤭",
    "🤫",
    "🤔",
    "🤐",
    "🤨",
    "😐",
    "😑",
    "😶",
    "😏",
    "😒",
    "🙄",
    "😬",
    "🤥",
    "😌",
    "😔",
    "😪",
    "🤤",
    "😴",
    "😷",
    "🤒",
    "🤕",
    "🤢",
    "🤮",
    "🤧",
    "🥵",
    "🥶",
    "🥴",
    "😵",
    "🤯",
    "🤠",
    "🥳",
    "🥸",
    "😎",
    "🤓",
    "🧐",
  ],
  nature: [
    "🐶",
    "🐱",
    "🐭",
    "🐹",
    "🐰",
    "🦊",
    "🐻",
    "🐼",
    "🐨",
    "🐯",
    "🦁",
    "🐮",
    "🐷",
    "🐸",
    "🐵",
    "🌸",
    "🌺",
    "🌻",
    "🌹",
    "🌷",
    "🌱",
    "🌲",
    "🌳",
    "🌴",
    "🌵",
    "🌾",
    "🌿",
    "🍀",
    "🍁",
    "🍂",
    "🍃",
    "🌍",
    "🌎",
    "🌏",
    "🌕",
    "🌖",
    "🌗",
    "🌘",
    "🌑",
    "🌒",
    "🌓",
    "🌔",
    "🌙",
    "⭐",
    "🌟",
    "✨",
    "⚡",
    "🔥",
    "🌈",
    "☀️",
    "🌤️",
    "⛅",
    "🌥️",
    "🌦️",
    "🌧️",
    "⛈️",
    "🌩️",
    "🌨️",
    "❄️",
    "☃️",
    "⛄",
    "🌬️",
    "💨",
    "🌊",
  ],
  food: [
    "🍎",
    "🍊",
    "🍋",
    "🍌",
    "🍉",
    "🍇",
    "🍓",
    "🫐",
    "🍈",
    "🍒",
    "🍑",
    "🥭",
    "🍍",
    "🥥",
    "🥝",
    "🍅",
    "🥑",
    "🍆",
    "🥒",
    "🌶️",
    "🫑",
    "🥕",
    "🧄",
    "🧅",
    "🥔",
    "🍠",
    "🥐",
    "🍞",
    "🥖",
    "🥨",
    "🧀",
    "🥚",
    "🍳",
    "🧈",
    "🥞",
    "🧇",
    "🥓",
    "🥩",
    "🍗",
    "🍖",
    "🦴",
    "🌭",
    "🍔",
    "🍟",
    "🍕",
    "🫓",
    "🥪",
    "🥙",
    "🧆",
    "🌮",
    "🌯",
    "🫔",
    "🥗",
    "🥘",
    "🫕",
    "🍝",
    "🍜",
    "🍲",
    "🍛",
    "🍣",
    "🍱",
    "🥟",
    "🦪",
    "🍤",
  ],
  activity: [
    "⚽",
    "🏀",
    "🏈",
    "⚾",
    "🥎",
    "🎾",
    "🏐",
    "🏉",
    "🥏",
    "🎱",
    "🪀",
    "🏓",
    "🏸",
    "🏒",
    "🏑",
    "🥍",
    "🏏",
    "🪃",
    "🥅",
    "⛳",
    "🪁",
    "🏹",
    "🎣",
    "🤿",
    "🥊",
    "🥋",
    "🎽",
    "🛹",
    "🛼",
    "🛷",
    "⛸️",
    "🥌",
    "🎿",
    "⛷️",
    "🏂",
    "🪂",
    "🏋️",
    "🤼",
    "🤸",
    "🤺",
    "⛹️",
    "🤾",
    "🏌️",
    "🏇",
    "🧘",
    "🏄",
    "🏊",
    "🤽",
    "🚣",
    "🧗",
    "🚴",
    "🚵",
    "🎬",
    "🎭",
    "🎨",
    "🎪",
    "🎤",
    "🎧",
    "🎼",
    "🎹",
    "🥁",
    "🪘",
    "🎷",
    "🎺",
    "🪗",
    "🎸",
    "🪕",
    "🎻",
  ],
  travel: [
    "🚗",
    "🚕",
    "🚙",
    "🚌",
    "🚎",
    "🏎️",
    "🚓",
    "🚑",
    "🚒",
    "🚐",
    "🛻",
    "🚚",
    "🚛",
    "🚜",
    "🏍️",
    "🛵",
    "🚲",
    "🛴",
    "🛹",
    "🚁",
    "✈️",
    "🛩️",
    "🚀",
    "🛸",
    "🚢",
    "⛵",
    "🚤",
    "🛥️",
    "🛳️",
    "⛴️",
    "🚂",
    "🚃",
    "🚄",
    "🚅",
    "🚆",
    "🚇",
    "🚈",
    "🚉",
    "🚊",
    "🚝",
    "🚞",
    "🚋",
    "🚃",
    "🏠",
    "🏡",
    "🏢",
    "🏣",
    "🏤",
    "🏥",
    "🏦",
    "🏨",
    "🏩",
    "🏪",
    "🏫",
    "🏬",
    "🏭",
    "🏯",
    "🏰",
    "💒",
    "🗼",
    "🗽",
    "⛪",
    "🕌",
    "🛕",
    "🕍",
    "⛩️",
    "🕋",
  ],
  objects: [
    "💼",
    "📁",
    "📂",
    "🗂️",
    "📅",
    "📆",
    "📇",
    "📈",
    "📉",
    "📊",
    "📋",
    "📌",
    "📍",
    "📎",
    "🖇️",
    "📏",
    "📐",
    "✂️",
    "🗃️",
    "🗄️",
    "🗑️",
    "🔒",
    "🔓",
    "🔏",
    "🔐",
    "🔑",
    "🗝️",
    "🔨",
    "🪓",
    "⛏️",
    "⚒️",
    "🛠️",
    "🗡️",
    "⚔️",
    "🔧",
    "🔩",
    "⚙️",
    "🗜️",
    "⚖️",
    "🦯",
    "🔗",
    "⛓️",
    "🪝",
    "🧰",
    "🧲",
    "🪜",
    "💡",
    "🔦",
    "🏮",
    "🪔",
    "📱",
    "📲",
    "💻",
    "🖥️",
    "🖨️",
    "⌨️",
    "🖱️",
    "🖲️",
    "💾",
    "💿",
    "📀",
    "🎥",
    "📷",
    "📸",
    "📹",
    "📼",
  ],
  symbols: [
    "❤️",
    "🧡",
    "💛",
    "💚",
    "💙",
    "💜",
    "🖤",
    "🤍",
    "🤎",
    "💔",
    "❣️",
    "💕",
    "💞",
    "💓",
    "💗",
    "💖",
    "💘",
    "💝",
    "✨",
    "⭐",
    "🌟",
    "💫",
    "✅",
    "❌",
    "❓",
    "❔",
    "❕",
    "❗",
    "💯",
    "🔴",
    "🟠",
    "🟡",
    "🟢",
    "🔵",
    "🟣",
    "🟤",
    "⚫",
    "⚪",
    "🔶",
    "🔷",
    "🔸",
    "🔹",
    "🔺",
    "🔻",
    "💠",
    "🔘",
    "🔳",
    "🔲",
    "🏁",
    "🚩",
    "🎌",
    "🏴",
    "🏳️",
    "➕",
    "➖",
    "➗",
    "✖️",
    "♾️",
    "💲",
    "💱",
    "™️",
    "©️",
    "®️",
    "〰️",
    "➰",
    "➿",
    "🔚",
    "🔙",
    "🔛",
    "🔝",
    "🔜",
  ],
  flags: [
    "🏳️",
    "🏴",
    "🏁",
    "🚩",
    "🎌",
    "🏴‍☠️",
    "🇺🇳",
    "🇦🇫",
    "🇦🇱",
    "🇩🇿",
    "🇦🇸",
    "🇦🇩",
    "🇦🇴",
    "🇦🇮",
    "🇦🇶",
    "🇦🇬",
    "🇦🇷",
    "🇦🇲",
    "🇦🇼",
    "🇦🇺",
    "🇦🇹",
    "🇦🇿",
    "🇧🇸",
    "🇧🇭",
    "🇧🇩",
    "🇧🇧",
    "🇧🇾",
    "🇧🇪",
    "🇧🇿",
    "🇧🇯",
    "🇧🇲",
    "🇧🇹",
    "🇧🇴",
    "🇧🇦",
    "🇧🇼",
    "🇧🇷",
    "🇮🇴",
    "🇻🇬",
    "🇧🇳",
    "🇧🇬",
    "🇧🇫",
    "🇧🇮",
    "🇰🇭",
    "🇨🇲",
    "🇨🇦",
    "🇮🇨",
    "🇨🇻",
    "🇧🇶",
    "🇰🇾",
    "🇨🇫",
    "🇹🇩",
    "🇨🇱",
    "🇨🇳",
    "🇨🇽",
    "🇨🇨",
    "🇨🇴",
    "🇰🇲",
    "🇨🇬",
    "🇨🇩",
    "🇨🇰",
    "🇨🇷",
    "🇨🇮",
    "🇭🇷",
    "🇨🇺",
    "🇨🇼",
  ],
};

const CATEGORY_ICONS: Record<string, string> = {
  recent: "🕐",
  people: "😀",
  nature: "🐾",
  food: "🍕",
  activity: "⚽",
  travel: "🚗",
  objects: "💡",
  symbols: "✅",
  flags: "🚩",
};

const IconPicker = ({ value, onChange, className }: IconPickerProps) => {
  const [activeTab, setActiveTab] = React.useState<
    "emoji" | "icons" | "upload"
  >("emoji");
  const [hoveredEmoji, setHoveredEmoji] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);

  const categoryRefs = React.useRef<Record<string, HTMLDivElement | null>>({});

  const scrollToCategory = (category: string) => {
    categoryRefs.current[category]?.scrollIntoView({ behavior: "smooth" });
  };

  const getRandomEmoji = () => {
    const availableCategories = Object.entries(EMOJI_CATEGORIES)
      .filter(([key, list]) => key !== "recent" && list.length > 0)
      .map(([_, list]) => list)
      .flat();

    if (availableCategories.length > 0) {
      const randomIndex = Math.floor(
        Math.random() * availableCategories.length,
      );
      const randomEmoji = availableCategories[randomIndex];
      if (randomEmoji) {
        onChange(randomEmoji);
        setOpen(false);
      }
    }
  };

  const handleRemove = () => {
    onChange("🚀");
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <div
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-md text-2xl cursor-pointer hover:bg-accent/50 transition-colors select-none",
              className,
            )}
          >
            {value}
          </div>
        }
      />
      <PopoverContent
        className="w-[350px] p-0 overflow-hidden border-border/40 shadow-xl"
        align="start"
      >
        <div className="flex items-center border-b px-2 pt-2 bg-muted/20">
          <button
            onClick={() => {
              setActiveTab("emoji");
            }}
            className={cn(
              "px-3 py-2 text-xs font-medium transition-colors border-b-2",
              activeTab === "emoji"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            Emoji
          </button>
          <button
            onClick={() => {
              setActiveTab("icons");
            }}
            className={cn(
              "px-3 py-2 text-xs font-medium transition-colors border-b-2",
              activeTab === "icons"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            Icons
          </button>
          <button
            onClick={() => {
              setActiveTab("upload");
            }}
            className={cn(
              "px-3 py-2 text-xs font-medium transition-colors border-b-2",
              activeTab === "upload"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            Upload
          </button>

          <div className="ml-auto pb-1">
            <button
              onClick={handleRemove}
              className="text-[10px] text-muted-foreground hover:text-destructive transition-colors px-2 py-1 rounded hover:bg-muted"
            >
              Remove
            </button>
          </div>
        </div>

        {activeTab === "emoji" ? (
          <Command className="w-full border-none rounded-none">
            <div className="flex items-center px-3 py-2 border-b gap-2">
              <IconSearch className="w-4 h-4 text-muted-foreground shrink-0" />
              <CommandPrimitive.Input
                placeholder="Filter..."
                className="flex-1 bg-transparent outline-none text-xs placeholder:text-muted-foreground"
              />

              <div className="flex items-center gap-1 border-l pl-2 ml-1">
                <button
                  onClick={getRandomEmoji}
                  className="p-1 hover:bg-accent rounded text-muted-foreground hover:text-foreground transition-colors"
                  title="Random emoji"
                >
                  <IconArrowsShuffle2 className="w-4 h-4" />
                </button>
                <div className="w-8 h-8 flex items-center justify-center text-2xl leading-none transition-all duration-200">
                  {hoveredEmoji || value}
                </div>
              </div>
            </div>

            <CommandList className="h-[280px] max-h-[280px] overflow-y-auto p-2 scroll-smooth">
              <CommandEmpty className="py-6 text-center text-xs text-muted-foreground">
                No emoji found.
              </CommandEmpty>

              {Object.entries(EMOJI_CATEGORIES).map(([category, emojis]) => {
                if (emojis.length === 0) return null;

                return (
                  <CommandGroup
                    key={category}
                    heading={
                      category.charAt(0).toUpperCase() + category.slice(1)
                    }
                    className="mb-2"
                  >
                    <div
                      ref={(el) => {
                        categoryRefs.current[category] = el;
                      }}
                      className="w-0 h-0"
                    />

                    <div className="flex flex-wrap gap-1 px-1">
                      {emojis.map((emoji) => (
                        <CommandItem
                          key={emoji}
                          value={`${emoji} ${category}`} // Allow searching by category name
                          onSelect={() => {
                            onChange(emoji);
                            setOpen(false);
                          }}
                          className="flex items-center justify-center w-8 h-8 p-0 rounded cursor-pointer hover:bg-accent data-[selected=true]:bg-accent transition-colors"
                          onMouseEnter={() => {
                            setHoveredEmoji(emoji);
                          }}
                          onMouseLeave={() => {
                            setHoveredEmoji(null);
                          }}
                        >
                          <span className="text-xl leading-none">{emoji}</span>
                        </CommandItem>
                      ))}
                    </div>
                  </CommandGroup>
                );
              })}
            </CommandList>

            <div className="flex items-center gap-1 p-2 border-t overflow-x-auto no-scrollbar scrollbar-none bg-muted/20">
              {Object.entries(CATEGORY_ICONS).map(([category, icon]) => (
                <button
                  key={category}
                  onClick={() => {
                    scrollToCategory(category);
                  }}
                  className="flex items-center justify-center w-7 h-7 rounded hover:bg-accent text-sm grayscale opacity-70 hover:grayscale-0 hover:opacity-100 transition-all shrink-0"
                  title={category}
                >
                  {icon}
                </button>
              ))}
            </div>
          </Command>
        ) : (
          <div className="h-[320px] flex flex-col items-center justify-center text-muted-foreground gap-2 p-4 text-center">
            {activeTab === "icons" ? (
              <IconIcons className="w-8 h-8 opacity-20" />
            ) : (
              <IconUpload className="w-8 h-8 opacity-20" />
            )}
            <p className="text-xs">
              {activeTab === "icons"
                ? "Icon library coming soon"
                : "Custom uploads coming soon"}
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};

export { IconPicker };
