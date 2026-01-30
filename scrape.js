const { chromium } = require("playwright");

const WEBHOOK_URL = process.env.WEBHOOK_URL;
const SECRET = process.env.SECRET;

// From your working payload
const PAYLOAD_BASE = {
  tag: "mocomuseum",
  eventId: "4649",
  productEventId: "10072",
  ticketNumber: "1",
  "ticketNumbers[310895]": "1",
  timeslotsGroup: "",
  streetname: "default",
};

function sumPurchasable(timeslots) {
  let sum = 0;
  let count = 0;
  for (const k of Object.keys(timeslots || {})) {
    const t = timeslots[k];
    count += 1;
    if (!t.soldOut && !t.expired) sum += Number(t.availableTickets || 0);
  }
  return { sum, count };
}

(async () => {
  if (!WEBHOOK_URL || !SECRET) throw new Error("Missing WEBHOOK_URL or SECRET env vars.");
  const dates = (process.env.DATES || "").split(",").map(s => s.trim()).filter(Boolean);
  if (!dates.length) throw new Error("Missing DATES env var (comma-separated YYYY-MM-DD).");

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // This page load helps pass CF checks
  await page.goto("https://tickets.mocomuseum.com/en/date", { waitUntil: "domcontentloaded" });

  const rows = [];

  for (const ticketDate of dates) {
    const form = new URLSearchParams({ ...PAYLOAD_BASE, ticketDate });

    const resp = await page.request.post("https://tickets.mocomuseum.com/script/timeslots", {
      headers: {
        "accept": "application/json, text/javascript, */*; q=0.01",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest",
        "origin": "https://tickets.mocomuseum.com",
        "referer": "https://tickets.mocomuseum.com/en/date"
      },
      data: form.toString(),
    });

    if (!resp.ok()) {
      console.log(ticketDate, "FAILED", resp.status());
      continue;
    }

    const json = await resp.json();
    const { sum, count } = sumPurchasable(json.timeslots);

    rows.push({
      ticketDate,
      available_sum_purchasable: sum,
      slot_count: count,
    });
  }

  const hookResp = await page.request.post(WEBHOOK_URL, {
  headers: { "content-type": "application/json" },
  data: JSON.stringify({ secret: SECRET, rows }),
});

const hookText = await hookResp.text();
console.log("WEBHOOK_STATUS", hookResp.status());
console.log("WEBHOOK_BODY", hookText.slice(0, 200));


  await browser.close();
})();
