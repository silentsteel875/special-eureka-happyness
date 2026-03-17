diff --git a/README.md b/README.md
index 9f3b9eb589eb83e4d91cdc39e667fbe004a9871f..00259adf06a756e679dd2e638ed50f3f1325075f 100644
--- a/README.md
+++ b/README.md
@@ -3,25 +3,115 @@
 ## Files
 - `alfred-camera.user.js`: Adds UI and automation helpers, including:
   - `Refresh on Timeout` header toggle
   - post-refresh auto-camera navigation
   - keeps native DOWNLOAD behavior for clips
   - adds a separate `PLAY NOW` button to watch clips in-page
 - `meeting-launcher-autoclose.user.js`: Adds a 15-minute top-center countdown banner on Webex/Teams launcher pages with **Close now** and **Cancel auto-close** actions, then attempts to close the tab automatically when time expires.
 - `statejobsny-responsive.user.js`
   - Tampermonkey userscript for improving the layout on:
     - https://statejobsny.com/public/*
     - https://statejobsny.com/employees/*
   - 'What it changes'
     - Removes fixed-width constraints from the legacy wrapper elements (`#mainContent`, `#leftShadow`, `#rightShadow`) so content can use the full viewport.
     - Converts the old float-based `#nav` + `#content` structure into a responsive CSS grid layout that expands on desktop and stacks cleanly on smaller screens.
     - Keeps media and form controls from overflowing (`img`, `table`, `input`, `select`, `textarea`, etc.) and improves `#vacancyTable` sizing by centering the table and right-sizing narrow metadata columns so the Title column gets more room.
     - Centers the header and data cells for Item #, Grade, Posted, Deadline, and County columns; uses centered vertical alignment in the vacancy table.
     - Sets the vacancy results table entries-per-page default to `100` by setting the DataTables length select after initialization.
     - Adds a left-nav toggle (`Responsive layout`) under `Other State Listings` to turn all script changes on/off, default on, and remember preference via localStorage.
     - Adds a left-nav collapse button available at any viewport size that defaults open (`Collapse Left Navigation` when open, `☰ >` when collapsed/expandable), with a `#eee` background and responsive width so its right edge follows nav/helpful-links width on smaller viewports.
     - Keeps DataTables control rows laid out horizontally by not forcing width/min/max/box-sizing rules on `.dt-layout-row`.
     - Sets vacancy table body cell padding to `1px 3px`.
     - Lets the Agency column widen slightly when its cells wrap to 3+ lines, reducing excessive row height growth, and only applies Agency widening when it still fits without introducing table overflow.
     - Keeps vacancy table odd/even row striping in correct sequence after sorting/redraws.
     - On vacancy table Title-link hover, shows an overlay preview of the linked vacancy page with Job Specifics plus Basics content; the preview can be dragged by its header, closed with an `X` button or outside click, and keeps its position until moved.
     - In small viewports with collapsed left nav, reduces the vertical gap between the nav toggle box and the content heading area.
+
+
+## Power Automate: Weekly Project Status PPTX -> PDF
+
+Use this pattern to convert each project's weekly status slide deck to PDF every Tuesday, while keeping the original `.pptx` untouched and writing the `.pdf` into the same folder.
+
+### 1) Trigger and date variables
+1. **Trigger**: `Recurrence`
+   - Frequency: `Week`
+   - Interval: `1`
+   - On these days: `Tuesday`
+   - Time zone: your local business zone (for example, Eastern Time)
+   - Start time: Tuesday morning time you want conversion to run.
+2. Add **Initialize variable** `varYear` (String):
+   - Value: `formatDateTime(convertTimeZone(utcNow(),'UTC','Eastern Standard Time'),'yyyy')`
+3. Add **Initialize variable** `varMonthFolder` (String):
+   - Value: `formatDateTime(convertTimeZone(utcNow(),'UTC','Eastern Standard Time'),'MM MMMM')`
+   - Example output: `03 March`
+
+> If your tenant uses a different timezone label, adjust `Eastern Standard Time` accordingly.
+
+### 2) Get project folders under program parent
+Your library root is:
+- Site: `https://nysemail.sharepoint.com/sites/ITS3/PM`
+- Library: `Shared Documents`
+- Program parent folder: `HR Technical Upgrade Program`
+
+Add **List folder** (SharePoint):
+- Site Address: the PM site
+- List or Library: `Shared Documents`
+- Folder: `/HR Technical Upgrade Program`
+
+Add **Filter array** to keep only project folders:
+- From: `value` from List folder
+- Condition examples:
+  - `item()?['IsFolder']` is equal to `true`
+  - and `startsWith(item()?['Name'],'PRJ')` is equal to `true`
+
+### 3) For each project, target that month's report folder
+Add **Apply to each** over filtered project folders.
+
+Inside the loop, add **Compose** `ReportFolderPath`:
+
+```text
+concat(
+  '/HR Technical Upgrade Program/',
+  item()?['Name'],
+  '/01 Project Management/01 Reports/Weekly Status Report - Slides [LIMITED ACCESS]/',
+  variables('varYear'),
+  '/',
+  variables('varMonthFolder')
+)
+```
+
+Add **List folder** (SharePoint) for `ReportFolderPath`.
+
+> Some projects may not have that month folder yet. Put this `List folder` inside a **Scope**, and configure downstream scope `run after` so missing-folder failures do not stop the whole flow.
+
+### 4) Convert PPTX files and save PDFs beside originals
+Still inside the project loop, add a second **Apply to each** over the files returned from the report folder `List folder`.
+
+Use a condition to process only PowerPoint files:
+- `endsWith(toLower(item()?['Name']), '.pptx')`
+
+For each `.pptx`:
+1. **Convert file** (OneDrive for Business or SharePoint convert action in your tenant)
+   - Input file: current `.pptx` (by path or identifier, depending on connector)
+   - Target type: `PDF`
+2. **Compose** `PdfFileName`:
+   - `replace(item()?['Name'], '.pptx', '.pdf')`
+3. **Create file** (SharePoint)
+   - Folder path: `ReportFolderPath`
+   - File name: `PdfFileName`
+   - File content: PDF output from Convert file
+
+This preserves the source `.pptx` and creates a sibling `.pdf` in the same directory.
+
+### 5) Optional hardening (recommended)
+- Before **Create file**, check whether PDF already exists:
+  - `Get file metadata using path` on `concat(outputs('ReportFolderPath'),'/',outputs('PdfFileName'))`
+  - If exists, either delete then recreate, or skip.
+- Add failure notifications (Teams/email) for projects where conversion fails.
+- Add run history summary at the end (count converted, skipped, failed).
+
+### 6) Notes for future year/month rollover
+Because the folder path is built from:
+- `yyyy` (year), and
+- `MM MMMM` (month folder label),
+
+your flow automatically follows new folders as they are added each month/year, as long as each project keeps the same directory convention.
