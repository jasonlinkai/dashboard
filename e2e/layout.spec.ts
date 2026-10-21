// The layout system end to end: boards per orientation, hiding, adding, deleting, resetting,
// dragging and the phone's tabs. Data APIs are blocked, so the cards show errors; only layout counts.
import { type Page, expect, test } from "@playwright/test";

const WIDE = { width: 1280, height: 800 };
const TALL = { width: 820, height: 1180 };
const PHONE = { width: 390, height: 844 };
const KEY = "settings.v1";
/** layoutEdit.tsx MIN_PX (a pixel of rounding allowed). */
const MIN = { w: 279, h: 169 };

const PLACE = { name: "汐止", county: "新北市", town: "汐止區", townId: "6501100", latitude: 25.0629, longitude: 121.658 };
const place = (name: string) => ({ ...PLACE, name });
/** The smallest valid file; validate() fills in the news, names, layout and the rest. */
const BASE = { version: 1, weather: [PLACE], markets: ["^TWII"], bus: [], trains: [], news: {} };
/** settings.tsx SLOTS: the default boxes. */
const DEF = {
  wide: {
    markets: { x: 0, y: 0, w: 24, h: 6 },
    weather: { x: 0, y: 6, w: 9, h: 18 },
    bus: { x: 9, y: 6, w: 7, h: 9 },
    train: { x: 9, y: 15, w: 7, h: 9 },
    news: { x: 16, y: 6, w: 8, h: 18 },
  },
  tall: {
    markets: { x: 0, y: 0, w: 24, h: 7 },
    weather: { x: 0, y: 7, w: 24, h: 7 },
    bus: { x: 0, y: 14, w: 12, h: 5 },
    train: { x: 0, y: 19, w: 12, h: 5 },
    news: { x: 12, y: 14, w: 12, h: 10 },
  },
};
const swapped = (b: typeof DEF.wide | typeof DEF.tall) => ({ ...b, bus: b.train, train: b.bus });

type Stored = {
  absent: string[];
  extras: { id: string; type: string }[];
  weather: unknown[];
  bus: unknown[];
  todos: { text: string; done: boolean }[];
  layout: { wide: Record<string, { x: number; y: number; w: number; h: number }>; tall: Record<string, { x: number; y: number; w: number; h: number }>; hidden: { wide: string[]; tall: string[] } };
};

test.beforeEach(async ({ page }) => {
  await page.route(/\/api\/|open-meteo/, (r) => r.abort());
});

/** Open the board, with these settings stored first (once: a reload keeps what the page saved). */
async function open(page: Page, size: { width: number; height: number }, settings?: object) {
  await page.setViewportSize(size);
  if (settings)
    await page.addInitScript(
      ([k, v]) => {
        if (sessionStorage.getItem("seeded")) return;
        localStorage.setItem(k, v);
        sessionStorage.setItem("seeded", "1");
      },
      [KEY, JSON.stringify(settings)],
    );
  await page.goto("/");
}
/** What the page saved (null: still the defaults, which aren't stored). */
const stored = (page: Page): Promise<Stored | null> => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null"), KEY);
const card = (page: Page, id: string) => page.locator(`main.grid > .card[data-card="${id}"]`);
/** A phone tab by its label. */
const tab = (page: Page, label: string) => page.locator("nav.tabbar").getByRole("button", { name: label });
const bar = (page: Page) => page.getByRole("toolbar", { name: "調整版面" });
const startEditing = (page: Page) => page.getByRole("button", { name: "排版模式", exact: true }).click();
async function expectAtLeastMin(page: Page, id: string) {
  const b = (await card(page, id).boundingBox())!;
  expect(b.width).toBeGreaterThanOrEqual(MIN.w);
  expect(b.height).toBeGreaterThanOrEqual(MIN.h);
}

test.describe("tablet / desktop board", () => {
  test("defaults: the preset's five cards, no to-do, nothing stored", async ({ page }) => {
    await open(page, WIDE);
    for (const id of Object.keys(DEF.wide)) await expect(card(page, id)).toBeVisible();
    await expect(card(page, "todo")).toHaveCount(0);
    expect(await stored(page)).toBeNull();
  });

  test("Esc leaves layout mode", async ({ page }) => {
    await open(page, WIDE);
    await startEditing(page);
    await expect(bar(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(bar(page)).toBeHidden();
  });

  test("the help explains the system for this orientation; Esc closes only it", async ({ page }) => {
    await open(page, TALL);
    await startEditing(page);
    await bar(page).getByRole("button", { name: "排版說明" }).click();
    const help = page.getByRole("dialog", { name: "排版怎麼運作" });
    await expect(help).toBeVisible();
    await expect(help.locator("strong")).toHaveText("直向");
    await page.keyboard.press("Escape");
    await expect(help).toHaveCount(0);
    await expect(bar(page)).toBeVisible();
  });

  test("hide, then show again in its old box", async ({ page }) => {
    await open(page, WIDE);
    await startEditing(page);
    await card(page, "bus").getByRole("button", { name: "隱藏公車" }).click();
    await expect(card(page, "bus")).toHaveCount(0);
    await bar(page).getByRole("button", { name: "顯示公車" }).click();
    await expect(card(page, "bus")).toBeVisible();
    const s = await stored(page);
    expect(s?.layout.hidden.wide ?? []).toEqual([]);
    expect(s?.layout.wide.bus ?? DEF.wide.bus).toEqual(DEF.wide.bus);
  });

  test("a hidden card whose box is under the minimum comes back at least the minimum", async ({ page }) => {
    await open(page, WIDE, {
      ...BASE,
      absent: ["bus", "train", "news", "todo"],
      layout: { wide: { markets: DEF.wide.markets, weather: { x: 0, y: 6, w: 4, h: 3 } }, tall: DEF.tall, hidden: { wide: ["weather"], tall: [] } },
    });
    await startEditing(page);
    await bar(page).getByRole("button", { name: "顯示天氣" }).click();
    await expect(card(page, "weather")).toBeVisible();
    await expectAtLeastMin(page, "weather");
  });

  test("hiding is per orientation", async ({ page }) => {
    await open(page, WIDE);
    await startEditing(page);
    await card(page, "news").getByRole("button", { name: "隱藏新聞" }).click();
    await expect(card(page, "news")).toHaveCount(0);
    await page.setViewportSize(TALL);
    await expect(card(page, "news")).toBeVisible();
  });

  test("the last shown card can't be hidden", async ({ page }) => {
    await open(page, WIDE, { ...BASE, absent: ["weather", "bus", "train", "news", "todo"] });
    await startEditing(page);
    await card(page, "markets").getByRole("button", { name: "隱藏市場行情" }).click();
    await expect(card(page, "markets")).toBeVisible();
    await expect(page.getByText("至少要留一個板塊")).toBeVisible();
  });
});

test.describe("adding cards in layout mode", () => {
  const roomy = {
    ...BASE,
    absent: ["bus", "train", "news", "todo"],
    layout: { wide: { markets: DEF.wide.markets, weather: DEF.wide.weather }, tall: { markets: DEF.tall.markets, weather: DEF.tall.weather }, hidden: { wide: [], tall: [] } },
  };

  test("an absent type comes back with a little content, at the minimum size, without opening the settings", async ({ page }) => {
    await open(page, WIDE, roomy);
    await startEditing(page);
    await bar(page).getByRole("combobox", { name: "新增板塊" }).selectOption("bus");
    await expect(card(page, "bus")).toBeVisible();
    await expect(page.getByRole("dialog", { name: "設定" })).toHaveCount(0);
    await expectAtLeastMin(page, "bus");
    const s = (await stored(page))!;
    expect(s.absent).not.toContain("bus");
    expect(s.bus).toEqual([]); // no stops, as when adding from the settings
    // Inserted at the minimum, not bigger: one cell less either way would be under it.
    const box = s.layout.wide.bus;
    const step = await page.evaluate(() => {
      const g = document.querySelector("main.grid")!.getBoundingClientRect();
      const gap = parseFloat(getComputedStyle(document.querySelector("main.grid")!).columnGap) || 0;
      return { x: (g.width + gap) / 24, y: (g.height + gap) / 24, gap };
    });
    expect((box.w - 1) * step.x - step.gap).toBeLessThan(MIN.w + 1);
    expect((box.h - 1) * step.y - step.gap).toBeLessThan(MIN.h + 1);
    // The other orientation got a box too.
    expect(s.layout.tall.bus).toBeTruthy();
  });

  test("adding a type in layout mode starts with the same content as in the settings", async ({ page }) => {
    // Weather absent: its first card comes back. Before, it got all four default places here but
    // one place from the settings page (which added an extra card while weather was still there).
    await open(page, WIDE, { ...roomy, weather: [PLACE, place("南港"), place("內湖")], absent: ["weather", "bus", "train", "news", "todo"], layout: undefined });
    await startEditing(page);
    await bar(page).getByRole("combobox", { name: "新增板塊" }).selectOption("weather");
    const names = (list: unknown) => (list as { name: string }[]).map((p) => p.name);
    expect(names((await stored(page))!.weather)).toEqual(["汐止"]); // the defaults' first place
    await bar(page).getByRole("combobox", { name: "新增板塊" }).selectOption("weather");
    const s = (await stored(page))!;
    expect(names((s.extras[0] as unknown as { weather: unknown[] }).weather)).toEqual(["汐止"]); // the first card's first place
  });

  test("another card of a present type is an extra one", async ({ page }) => {
    await open(page, WIDE, roomy);
    await startEditing(page);
    await bar(page).getByRole("combobox", { name: "新增板塊" }).selectOption("weather");
    const s = (await stored(page))!;
    expect(s.extras).toHaveLength(1);
    expect(s.extras[0].type).toBe("weather");
    await expectAtLeastMin(page, s.extras[0].id);
  });

  test("no room: the new card waits hidden in the bar", async ({ page }) => {
    await open(page, WIDE);
    await startEditing(page);
    await bar(page).getByRole("combobox", { name: "新增板塊" }).selectOption("todo");
    await expect(page.getByText(/畫面上沒有空位/)).toBeVisible();
    await expect(bar(page).getByRole("button", { name: "顯示待辦事項" })).toBeVisible();
    expect((await stored(page))!.layout.hidden.wide).toContain("todo");
  });

  test("many hidden cards scroll in their own strip; the other buttons stay on screen", async ({ page }) => {
    await open(page, WIDE);
    await startEditing(page);
    const add = bar(page).getByRole("combobox", { name: "新增板塊" });
    for (const t of ["markets", "markets", "weather", "weather", "bus", "bus", "train", "train", "news", "news", "todo"]) await add.selectOption(t);
    // Each type at its maximum (3) can't be added again.
    await expect(add.locator('option[value="markets"]')).toBeDisabled();
    const chips = bar(page).locator(".layout-chips");
    expect(await chips.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    const finish = bar(page).getByRole("button", { name: "結束排版模式" });
    await expect(finish).toBeInViewport({ ratio: 1 });
    await expect(add).toBeInViewport({ ratio: 1 });
  });

  test("a to-do card keeps its items", async ({ page }) => {
    await open(page, WIDE, roomy);
    await startEditing(page);
    await bar(page).getByRole("combobox", { name: "新增板塊" }).selectOption("todo");
    await page.keyboard.press("Escape");
    const todo = card(page, "todo");
    await todo.getByRole("textbox", { name: "新增待辦事項" }).fill("買牛奶");
    await todo.getByRole("textbox", { name: "新增待辦事項" }).press("Enter");
    await todo.getByRole("checkbox").check();
    await page.reload();
    await expect(card(page, "todo").getByRole("checkbox")).toBeChecked();
    expect((await stored(page))!.todos).toEqual([{ text: "買牛奶", done: true }]);
  });
});

test.describe("reset", () => {
  const custom = { ...BASE, layout: { wide: swapped(DEF.wide), tall: swapped(DEF.tall), hidden: { wide: ["news"], tall: ["news"] } } };

  test("asks first; Esc / cancel change nothing and stay in layout mode", async ({ page }) => {
    await open(page, WIDE, custom);
    await startEditing(page);
    const before = await stored(page);
    await bar(page).getByRole("button", { name: "恢復預設" }).click();
    const dialog = page.getByRole("dialog", { name: "恢復預設版面？" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(bar(page)).toBeVisible();
    await bar(page).getByRole("button", { name: "恢復預設" }).click();
    await dialog.getByRole("button", { name: "取消" }).click();
    await expect(dialog).toHaveCount(0);
    expect(await stored(page)).toEqual(before);
  });

  for (const [mode, size, other] of [
    ["wide", WIDE, "tall"],
    ["tall", TALL, "wide"],
  ] as const)
    test(`resets only the ${mode} board`, async ({ page }) => {
      await open(page, size, custom);
      await startEditing(page);
      await bar(page).getByRole("button", { name: "恢復預設" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "恢復預設" }).click();
      await expect(card(page, "news")).toBeVisible();
      const s = (await stored(page))!;
      expect(s.layout[mode]).toEqual(DEF[mode]);
      expect(s.layout.hidden[mode]).toEqual([]);
      expect(s.layout[other]).toEqual(swapped(DEF[other]));
      expect(s.layout.hidden[other]).toEqual(["news"]);
    });

  test("brings back the preset's deleted types with default content; not the ones it leaves out", async ({ page }) => {
    await open(page, WIDE, {
      ...BASE,
      absent: ["weather", "news", "todo"],
      layout: {
        wide: { markets: DEF.wide.markets, bus: DEF.wide.bus, train: DEF.wide.train },
        tall: { markets: DEF.tall.markets, bus: DEF.tall.bus, train: DEF.tall.train },
        hidden: { wide: [], tall: [] },
      },
    });
    await startEditing(page);
    await bar(page).getByRole("button", { name: "恢復預設" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "恢復預設" }).click();
    await expect(card(page, "weather")).toBeVisible();
    await expect(card(page, "news")).toBeVisible();
    await expect(card(page, "todo")).toHaveCount(0);
    const s = (await stored(page))!;
    expect(s.absent).toEqual(["todo"]);
    expect(s.weather).toHaveLength(4); // the default places, not the deleted card's one
    expect(s.layout.wide).toEqual(DEF.wide);
    // The other board makes room for them too (their preset boxes are free there).
    expect(s.layout.tall.weather).toEqual(DEF.tall.weather);
    expect(s.layout.tall.news).toEqual(DEF.tall.news);
  });

  test("keeps extra cards, in free cells or hidden", async ({ page }) => {
    await open(page, WIDE, { ...BASE, extras: [{ id: "weather-aa", type: "weather" }] });
    await startEditing(page);
    await bar(page).getByRole("button", { name: "恢復預設" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "恢復預設" }).click();
    const s = (await stored(page))!;
    expect(s.extras.map((e) => e.id)).toEqual(["weather-aa"]);
    expect(s.layout.hidden.wide).toEqual(["weather-aa"]); // the default board is full
  });
});

test.describe("moving and resizing", () => {
  test("dragging a card onto another swaps them", async ({ page }) => {
    await open(page, WIDE);
    await startEditing(page);
    const from = (await card(page, "bus").boundingBox())!;
    const to = (await card(page, "train").boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 20, { steps: 3 });
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
    await page.mouse.up();
    await expect.poll(async () => (await stored(page))?.layout.wide.bus).toEqual(DEF.wide.train);
    expect((await stored(page))!.layout.wide.train).toEqual(DEF.wide.bus);
  });

  test("the keyboard can't shrink a card under the minimum", async ({ page }) => {
    await open(page, WIDE);
    await startEditing(page);
    const move = card(page, "bus").locator(".card-move");
    await move.focus();
    for (let i = 0; i < 8; i++) await move.press("Shift+ArrowLeft");
    for (let i = 0; i < 8; i++) await move.press("Shift+ArrowUp");
    await expectAtLeastMin(page, "bus");
  });

  test("dragging the corner can't shrink a card under the minimum", async ({ page }) => {
    await open(page, WIDE);
    await startEditing(page);
    const corner = (await card(page, "news").locator(".card-resize").boundingBox())!;
    await page.mouse.move(corner.x + 5, corner.y + 5);
    await page.mouse.down();
    await page.mouse.move(corner.x - 600, corner.y - 600, { steps: 15 });
    await page.mouse.up();
    await expectAtLeastMin(page, "news");
  });
});

test.describe("deleting everything", () => {
  test("the last card can be deleted; the board says so and settings offer to add per type", async ({ page }) => {
    await open(page, WIDE, { ...BASE, absent: ["weather", "bus", "train", "news", "todo"] });
    await page.getByRole("button", { name: "設定", exact: true }).click();
    await page.getByRole("tab", { name: "顯示內容" }).click();
    await page.locator(".ed-section").first().click();
    await page.getByRole("button", { name: "刪除板塊" }).click();
    await page.getByRole("button", { name: /再按一次確認刪除/ }).click();
    expect((await stored(page))!.absent.sort()).toEqual(["bus", "markets", "news", "todo", "train", "weather"]);
    // Every type's group is empty, each with its own add button.
    await expect(page.locator(".ed-group")).toHaveCount(6);
    await expect(page.getByText("看板上沒有這種板塊。")).toHaveCount(6);
    // Adding from the settings opens the new card's page.
    await page.getByRole("button", { name: "＋ 新增行情板塊" }).click();
    await expect(page.getByRole("dialog", { name: /市場行情/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(card(page, "markets")).toBeVisible();
  });

  test("a card can be deleted from the list itself (tap twice)", async ({ page }) => {
    await open(page, WIDE);
    await page.getByRole("button", { name: "設定", exact: true }).click();
    await page.getByRole("tab", { name: "顯示內容" }).click();
    await page.getByRole("button", { name: "刪除公車" }).click();
    expect(await stored(page)).toBeNull(); // the first tap only asks
    await page.getByRole("button", { name: "再按一次確認刪除公車" }).click();
    expect((await stored(page))!.absent).toContain("bus");
    await page.keyboard.press("Escape");
    await expect(card(page, "bus")).toHaveCount(0);
  });

  test("an empty board offers layout mode", async ({ page }) => {
    await open(page, WIDE, { ...BASE, absent: ["markets", "weather", "bus", "train", "news", "todo"] });
    await expect(page.getByText("看板上沒有板塊")).toBeVisible();
    await page.getByRole("button", { name: "進入排版模式新增或顯示板塊" }).click();
    await expect(bar(page)).toBeVisible();
  });

  test("every card hidden is a valid (empty) board", async ({ page }) => {
    await open(page, WIDE, { ...BASE, layout: { hidden: { wide: ["markets", "weather", "bus", "train", "news"], tall: [] } } });
    await expect(page.getByText("看板上沒有板塊")).toBeVisible();
    await page.setViewportSize(TALL);
    await expect(card(page, "markets")).toBeVisible();
  });

  test("an older file (no absent list) has every type of its time, without the to-do", async ({ page }) => {
    await open(page, WIDE, BASE);
    for (const id of Object.keys(DEF.wide)) await expect(card(page, id)).toBeVisible();
    await expect(card(page, "todo")).toHaveCount(0);
  });
});

test.describe("phone", () => {
  test("a tab without its type offers to add one (no settings popup)", async ({ page }) => {
    await open(page, PHONE, { ...BASE, absent: ["weather", "todo"] });
    await tab(page, "天氣").click();
    await expect(page.getByText("還沒有天氣板塊")).toBeVisible();
    await page.getByRole("button", { name: "＋ 新增天氣" }).click();
    await expect(card(page, "weather")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await stored(page))!.weather).toHaveLength(1); // one default place, not all four
  });

  test("several cards of a type: arrows switch, a long name is cut with …", async ({ page }) => {
    const long = "我家附近的天氣好長名稱";
    await open(page, PHONE, {
      ...BASE,
      extras: [
        { id: "weather-aa", type: "weather", weather: [place("南港")] },
        { id: "weather-bb", type: "weather", weather: [place("內湖")] },
      ],
      names: { weather: long },
    });
    await tab(page, "天氣").click();
    const c = page.locator("main.grid > .card.weather");
    await expect(c.locator(".card-switch h2")).toHaveText(long);
    await expect(c.getByText("1/3")).toBeVisible();
    await expect(c.getByRole("button", { name: "沒有上一個" })).toBeDisabled();
    // Cut, not pushing the rest of the title row out of the card.
    expect(await c.locator(".card-switch h2").evaluate((h) => h.scrollWidth > h.clientWidth)).toBe(true);
    expect(await c.locator(".card-head").evaluate((h) => h.scrollWidth <= h.clientWidth)).toBe(true);
    await c.getByRole("button", { name: /^下一個/ }).click();
    await expect(c.locator(".card-switch h2")).toHaveText("天氣 2");
    await c.getByRole("button", { name: /^下一個/ }).click();
    await expect(c.getByText("3/3")).toBeVisible();
    await expect(c.getByRole("button", { name: "沒有下一個" })).toBeDisabled();
  });

  test("a to-do tab", async ({ page }) => {
    await open(page, PHONE);
    await tab(page, "待辦").click();
    await page.getByRole("button", { name: "＋ 新增待辦事項" }).click();
    await expect(card(page, "todo")).toBeVisible();
  });
});

test.describe("card contents", () => {
  for (const [label, size] of [
    ["wide", WIDE],
    ["phone", PHONE],
  ] as const)
    test(`one market tile or one weather place isn't stretched over the card (${label})`, async ({ page }) => {
      await open(page, size, BASE);
      for (const [id, item, name] of [
        ["markets", ".tile", "行情"],
        ["weather", ".wx", "天氣"],
      ] as const) {
        if (size === PHONE) await tab(page, name).click();
        const c = card(page, id);
        const box = (await c.boundingBox())!;
        const one = (await c.locator(item).first().boundingBox())!;
        expect(one.height).toBeLessThanOrEqual(241);
        // A wide row lays out room for three tiles.
        if (id === "markets" && size === WIDE) expect(one.width).toBeLessThan(box.width * 0.4);
      }
    });

  test("hourly strips don't rubber-band", async ({ page }) => {
    await open(page, WIDE);
    // The strip only renders with a forecast; check the rule itself.
    const rule = await page.evaluate(() => {
      const el = document.createElement("div");
      el.className = "wx-strip";
      document.body.append(el);
      return getComputedStyle(el).overscrollBehaviorX;
    });
    expect(rule).toBe("none");
  });
});
