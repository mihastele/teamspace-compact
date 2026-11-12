"use client";

import React, { useMemo, useState } from "react";
import styles from "./EmojiPicker.module.css";

type EmojiItem = [emoji: string, keywords: string];

type EmojiCategory = {
  id: string;
  label: string;
  tabIcon: string;
  items: EmojiItem[];
};

const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: "smileys",
    label: "Smileys & People",
    tabIcon: "😀",
    items: [
      ["😀", "grinning happy smile"], ["😃", "smiley happy"], ["😄", "smile laugh"], ["😁", "grin"],
      ["😅", "sweat smile"], ["😂", "joy laugh cry"], ["🤣", "rofl laugh"], ["😊", "blush smile"],
      ["😇", "innocent angel"], ["🙂", "slightly smiling"], ["😉", "wink"], ["😍", "heart eyes love"],
      ["🤩", "star struck"], ["😘", "kiss"], ["😋", "yum"], ["😜", "wink tongue"],
      ["🤔", "thinking hmm"], ["🤨", "raised eyebrow"], ["😐", "neutral"], ["🙄", "eye roll"],
      ["😴", "sleepy"], ["🤯", "mind blown"], ["🥳", "party celebrate"], ["😎", "cool sunglasses"],
      ["🤓", "nerd glasses"], ["🧐", "monocle"], ["😕", "confused"], ["😮", "open mouth"],
      ["😢", "cry sad"], ["😭", "sob cry"], ["😤", "triumph"], ["😡", "angry"],
      ["👍", "thumbs up ok like"], ["👎", "thumbs down"], ["👏", "clap"], ["🙌", "raise hands"],
      ["🤝", "handshake deal"], ["🙏", "pray thanks"], ["✌️", "peace victory"], ["🤞", "crossed fingers"],
      ["💪", "muscle strong"], ["🧠", "brain smart"], ["👀", "eyes look"], ["👋", "wave hello"],
    ],
  },
  {
    id: "nature",
    label: "Nature & Animals",
    tabIcon: "🌿",
    items: [
      ["🐶", "dog puppy"], ["🐱", "cat kitty"], ["🦊", "fox"], ["🐻", "bear"],
      ["🐼", "panda"], ["🦁", "lion"], ["🐸", "frog"], ["🐵", "monkey"],
      ["🦉", "owl"], ["🦅", "eagle"], ["🐝", "bee"], ["🦋", "butterfly"],
      ["🐢", "turtle"], ["🐙", "octopus"], ["🐳", "whale"], ["🐬", "dolphin"],
      ["🌱", "seedling sprout"], ["🌿", "herb leaf"], ["🍀", "clover luck"], ["🌲", "evergreen tree"],
      ["🌳", "tree"], ["🌴", "palm tree"], ["🌵", "cactus"], ["🌸", "cherry blossom flower"],
      ["🌻", "sunflower"], ["🌹", "rose"], ["🍄", "mushroom"], ["🌍", "earth globe world"],
      ["🌙", "moon"], ["☀️", "sun"], ["⭐", "star"], ["🌟", "glowing star"],
      ["⚡", "lightning zap fast"], ["🔥", "fire hot flame"], ["🌈", "rainbow"], ["❄️", "snowflake cold"],
      ["💧", "water drop"], ["🌊", "wave ocean"],
    ],
  },
  {
    id: "food",
    label: "Food & Drink",
    tabIcon: "🍕",
    items: [
      ["🍎", "apple"], ["🍊", "orange"], ["🍋", "lemon"], ["🍌", "banana"],
      ["🍉", "watermelon"], ["🍇", "grapes"], ["🍓", "strawberry"], ["🥑", "avocado"],
      ["🥕", "carrot"], ["🌽", "corn"], ["🍞", "bread"], ["🥐", "croissant"],
      ["🧀", "cheese"], ["🍕", "pizza"], ["🍔", "burger"], ["🌮", "taco"],
      ["🍣", "sushi"], ["🍜", "ramen noodles"], ["🍝", "pasta"], ["🥗", "salad"],
      ["🍰", "cake"], ["🍪", "cookie"], ["🍫", "chocolate"], ["🍩", "donut"],
      ["☕", "coffee"], ["🍵", "tea"], ["🍺", "beer"], ["🍷", "wine"],
      ["🥂", "champagne toast"], ["🥤", "drink cup"],
    ],
  },
  {
    id: "activities",
    label: "Activities & Sports",
    tabIcon: "🎯",
    items: [
      ["🎯", "target goal bullseye"], ["🏆", "trophy win award"], ["🥇", "gold medal first"], ["🎮", "game controller"],
      ["🎲", "dice"], ["🧩", "puzzle piece"], ["🎨", "art palette design"], ["🎬", "clapper movie video"],
      ["🎤", "mic microphone"], ["🎧", "headphones music"], ["🎸", "guitar"], ["🎹", "piano"],
      ["⚽", "soccer football"], ["🏀", "basketball"], ["🎾", "tennis"], ["🏊", "swim"],
      ["🚴", "cycle bike"], ["🏔️", "mountain"], ["🏕️", "camping"], ["🎉", "party confetti"],
      ["🎁", "gift present"], ["🎈", "balloon"],
    ],
  },
  {
    id: "travel",
    label: "Travel & Places",
    tabIcon: "🚀",
    items: [
      ["🚀", "rocket launch space"], ["✈️", "airplane flight"], ["🚗", "car"], ["🚲", "bicycle"],
      ["🚂", "train"], ["🚢", "ship"], ["🏠", "house home"], ["🏢", "office building"],
      ["🏫", "school"], ["🏥", "hospital"], ["🏰", "castle"], ["🗼", "tower"],
      ["🗺️", "map"], ["🧭", "compass"], ["⏱️", "stopwatch timer"], ["⏰", "alarm clock"],
      ["📅", "calendar date"], ["📆", "calendar"],
    ],
  },
  {
    id: "objects",
    label: "Objects & Work",
    tabIcon: "📄",
    items: [
      ["📄", "page document file"], ["📝", "memo note write"], ["📃", "page curl"], ["📑", "bookmark tabs"],
      ["📚", "books library wiki"], ["📖", "open book"], ["📓", "notebook"], ["📒", "ledger"],
      ["📁", "folder"], ["📂", "open folder"], ["🗂️", "card index dividers"], ["📌", "pin pushpin"],
      ["📍", "round pushpin"], ["📎", "paperclip attach"], ["✂️", "scissors"], ["📏", "ruler"],
      ["✏️", "pencil edit"], ["🖊️", "pen"], ["🖌️", "paintbrush"], ["🔍", "search magnifying glass"],
      ["🔑", "key"], ["🔒", "lock private"], ["🔓", "unlock"], ["🛠️", "tools wrench hammer"],
      ["⚙️", "gear settings"], ["💻", "laptop computer code"], ["🖥️", "desktop monitor"], ["📱", "phone mobile"],
      ["📷", "camera photo"], ["📹", "video camera"], ["🎥", "movie camera"], ["💡", "lightbulb idea"],
      ["🔔", "bell notification"], ["📢", "megaphone announce"], ["💬", "speech bubble comment"], ["💭", "thought bubble"],
      ["📧", "email mail"], ["📦", "package box"], ["🏷️", "label tag"], ["💰", "money bag"],
      ["💳", "credit card"], ["📊", "bar chart stats"], ["📈", "chart up growth"], ["📉", "chart down"],
      ["📋", "clipboard tasks"], ["🧪", "test tube experiment"], ["🔬", "microscope"], ["🔭", "telescope"],
    ],
  },
  {
    id: "symbols",
    label: "Symbols & Status",
    tabIcon: "✅",
    items: [
      ["✅", "check done complete"], ["☑️", "checkbox"], ["✔️", "check mark"], ["❌", "cross cancel no"],
      ["❓", "question"], ["❗", "exclamation warning"], ["⚠️", "warning alert"], ["🚫", "prohibited"],
      ["🔴", "red circle"], ["🟠", "orange circle"], ["🟡", "yellow circle"], ["🟢", "green circle"],
      ["🔵", "blue circle"], ["🟣", "purple circle"], ["⚫", "black circle"], ["⚪", "white circle"],
      ["🟥", "red square"], ["🟦", "blue square"], ["🟩", "green square"], ["🟨", "yellow square"],
      ["❤️", "red heart love"], ["🧡", "orange heart"], ["💛", "yellow heart"], ["💚", "green heart"],
      ["💙", "blue heart"], ["💜", "purple heart"], ["✨", "sparkles magic"], ["💯", "100"],
      ["♻️", "recycle"], ["🔗", "link chain"], ["➕", "plus add"], ["➖", "minus"],
      ["➡️", "arrow right"], ["⬅️", "arrow left"], ["⬆️", "arrow up"], ["⬇️", "arrow down"],
      ["🔄", "refresh sync"], ["♾️", "infinity"],
    ],
  },
  {
    id: "flags",
    label: "Flags",
    tabIcon: "🏁",
    items: [
      ["🏁", "checkered flag finish"], ["🚩", "red flag"], ["🏴", "black flag"], ["🏳️", "white flag"],
      ["🇸🇮", "slovenia si"], ["🇪🇺", "eu europe"], ["🇺🇸", "usa us"], ["🇬🇧", "uk gb"],
      ["🇩🇪", "germany de"], ["🇫🇷", "france fr"], ["🇮🇹", "italy it"], ["🇪🇸", "spain es"],
      ["🇯🇵", "japan jp"], ["🇨🇦", "canada ca"], ["🇦🇺", "australia au"], ["🇧🇷", "brazil br"],
    ],
  },
];

export function EmojiPicker({
  onSelect,
  onRemove,
}: {
  onSelect: (emoji: string) => void;
  onRemove?: () => void;
}) {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("smileys");
  const [customEmoji, setCustomEmoji] = useState("");

  const filteredCategories = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) {
      return EMOJI_CATEGORIES.filter((c) => c.id === activeCategory);
    }
    return EMOJI_CATEGORIES.map((cat) => ({
      ...cat,
      items: cat.items.filter(
        ([emoji, keywords]) =>
          emoji.includes(q) ||
          keywords.includes(q) ||
          cat.label.toLowerCase().includes(q)
      ),
    })).filter((cat) => cat.items.length > 0);
  }, [search, activeCategory]);

  const handleApplyCustom = () => {
    const trimmed = customEmoji.trim();
    if (!trimmed) return;
    onSelect(trimmed);
  };

  return (
    <div className={styles.picker} onClick={(e) => e.stopPropagation()}>
      <div className={styles.topRow}>
        <input
          className={styles.searchInput}
          placeholder="Search emoji (e.g. rocket, check, book)..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
        {onRemove && (
          <button
            type="button"
            className={styles.removeBtn}
            onClick={onRemove}
          >
            Remove
          </button>
        )}
      </div>

      {!search.trim() && (
        <div className={styles.categoryTabs}>
          {EMOJI_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              title={cat.label}
              className={`${styles.categoryTab} ${activeCategory === cat.id ? styles.categoryTabActive : ""}`}
              onClick={() => setActiveCategory(cat.id)}
            >
              {cat.tabIcon}
            </button>
          ))}
        </div>
      )}

      <div className={styles.gridScroll}>
        {filteredCategories.length === 0 ? (
          <div className={styles.emptyMsg}>
            No matching emoji. Paste any emoji below!
          </div>
        ) : (
          filteredCategories.map((cat) => (
            <div key={cat.id}>
              <div className={styles.categoryLabel}>{cat.label}</div>
              <div className={styles.emojiGrid}>
                {cat.items.map(([emoji]) => (
                  <button
                    key={`${cat.id}-${emoji}`}
                    type="button"
                    className={styles.emojiBtn}
                    onClick={() => onSelect(emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      <div className={styles.customRow}>
        <input
          className={styles.customInput}
          placeholder="Or paste any emoji..."
          value={customEmoji}
          onChange={(e) => setCustomEmoji(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleApplyCustom();
            }
          }}
        />
        <button
          type="button"
          className={styles.applyBtn}
          onClick={handleApplyCustom}
        >
          Use
        </button>
      </div>
    </div>
  );
}
