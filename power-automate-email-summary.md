# Power Automate flow: weekday digest of Outlook project/demand updates

This guide builds a **scheduled weekday flow** that:

1. Pulls emails from a chosen Outlook folder.
2. Includes only emails from the current digest window:
   - Tue–Fri run: only same-day emails.
   - Mon run: includes Sat + Sun + Mon.
3. Sorts by received time.
4. Groups updates by project/demand key (best effort from subject/body).
5. Sends one summary email containing all grouped updates in chronological order.

## 1) Create the flow

Create a **Scheduled cloud flow**:

- Trigger: **Recurrence**
- Frequency: `Day`
- Interval: `1`
- Time zone: your local zone
- Advanced options → only run on weekdays (Mon–Fri)

## 2) Determine the digest start time (Mon includes weekend)

Add a **Compose** action called `Compose_DigestStartUtc` with this expression:

```text
if(
  equals(dayOfWeek(convertFromUtc(utcNow(), 'Eastern Standard Time')), 1),
  startOfDay(addDays(convertFromUtc(utcNow(), 'Eastern Standard Time'), -2)),
  startOfDay(convertFromUtc(utcNow(), 'Eastern Standard Time'))
)
```

Notes:
- `dayOfWeek(...) = 1` means Monday.
- On Monday it starts at Saturday 00:00 local.
- Otherwise starts at today 00:00 local.
- Replace `Eastern Standard Time` with your zone.

Add another **Compose** called `Compose_DigestStartUtc_Converted`:

```text
convertToUtc(outputs('Compose_DigestStartUtc'), 'Eastern Standard Time')
```

## 3) Get candidate messages from your “rule” folder

Add **Office 365 Outlook → List messages in folder (V3)**:

- Folder: the folder your inbox rule moves these updates into
- Include Attachments: No
- Top: high enough for your daily volume (for example, 200)

(Optional but recommended) If your emails have a clear sender or subject pattern, use a filter query to reduce noise.

## 4) Keep only emails in the digest window

Add **Filter array** on `value` from List messages.
Use Advanced mode:

```text
@greaterOrEquals(item()?['receivedDateTime'], outputs('Compose_DigestStartUtc_Converted'))
```

If needed, add additional conditions like sender/subject contains.

## 5) Sort by time so chronology is stable

Add **Data Operation → Compose** named `Compose_Sorted`:

```text
sort(body('Filter_array'), 'receivedDateTime')
```

## 6) Initialize variables for grouping and output

Initialize these variables:

- `varSummaryHtml` (String) = empty
- `varCurrentKey` (String) = empty
- `varCurrentBlock` (String) = empty

Because Power Automate doesn’t provide easy object-map grouping in all tenants, this pattern does a **single-pass grouped render** over sorted data.

## 7) Build a grouping key (project/demand id)

Inside **Apply to each** over `outputs('Compose_Sorted')`, create a **Compose** `Compose_ProjectKey`.

Use whichever identifier is reliably present. Common options:

- Parse from subject (best)
- Fallback to a token in body
- Fallback to full subject

Example expression (subject-based heuristic):

```text
if(
  contains(item()?['subject'], 'PRJ-'),
  first(split(last(split(item()?['subject'], 'PRJ-')), ' ')),
  item()?['subject']
)
```

Adapt this to your true naming convention (e.g., `DMND-12345`, `Project 7781`).

## 8) Render grouped sections in chronological order

Still inside the loop:

1. **Condition**: `equals(outputs('Compose_ProjectKey'), variables('varCurrentKey'))`

   - **If yes**: append current email entry to `varCurrentBlock`.
   - **If no**:
     - If `varCurrentBlock` not empty, append it to `varSummaryHtml`.
     - Reset `varCurrentKey` = new key.
     - Start new `varCurrentBlock` with a heading for that key + current email entry.

For each email entry, append something like:

```html
<div style="margin:8px 0;padding:8px;border-left:3px solid #888;">
  <div><b>Received:</b> @{item()?['receivedDateTime']}</div>
  <div><b>Subject:</b> @{item()?['subject']}</div>
  <div><b>From:</b> @{item()?['from']?['emailAddress']?['address']}</div>
  <div>@{item()?['bodyPreview']}</div>
</div>
```

If you need full email body instead of preview, add **Get email (V3)** by `Message Id` in the loop and use `Body`.

After loop completes, append the final `varCurrentBlock` to `varSummaryHtml`.

## 9) Skip send if no new emails

Add a condition before send:

```text
equals(length(body('Filter_array')), 0)
```

- If true: end flow (or log “no updates today”).
- If false: send summary.

## 10) Send the digest email

Add **Send an email (V2)**:

- To: you (or distribution list)
- Subject: `Daily Demand/Project Update Digest - @{formatDateTime(convertFromUtc(utcNow(), 'Eastern Standard Time'), 'yyyy-MM-dd')}`
- Body (HTML): `variables('varSummaryHtml')`
- Is HTML: Yes

---

## Practical improvements

- Add a dedupe key (`internetMessageId`) if connector paging can repeat messages.
- Cap total items and add “+N more…” guardrail for very high-volume days.
- Keep IDs linked to Outlook item URLs for quick drill-down.
- If subject parsing is weak, maintain a small lookup table (SharePoint/Excel/Dataverse) that maps known patterns to a normalized project key.
